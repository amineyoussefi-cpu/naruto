/**
 * Minimal RFC 6455 WebSocket server side on `node:http` upgrade (no extensions, no subprotocols).
 * Handles the handshake, masked client frames, text/binary messages with fragmentation, ping/pong (RTT),
 * the close handshake with status codes and a max message size.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Frame opcodes. */
export const OP = { cont: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;
/** Close status codes used here. */
export const CLOSE = { normal: 1000, goingAway: 1001, protocol: 1002, badData: 1007, tooBig: 1009 } as const;
/** Time allowed for the peer to answer our close frame before the socket is destroyed. */
const CLOSE_TIMEOUT_MS = 2000;

/** Sec-WebSocket-Accept for a Sec-WebSocket-Key. */
export const acceptKey = (key: string): string => createHash('sha1').update(key + GUID).digest('base64');

export class WsError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

/** Builds one frame. `mask` (4 bytes) is for client frames (tests); the server never masks. */
export function encodeFrame(opcode: number, payload: Uint8Array, opts: { fin?: boolean; mask?: Uint8Array } = {}): Buffer {
  const len = payload.length;
  const ext = len < 126 ? 0 : len < 65536 ? 2 : 8;
  const maskLen = opts.mask ? 4 : 0;
  const out = Buffer.alloc(2 + ext + maskLen + len);
  out[0] = (opts.fin === false ? 0 : 0x80) | opcode;
  out[1] = (opts.mask ? 0x80 : 0) | (ext === 0 ? len : ext === 2 ? 126 : 127);
  if (ext === 2) out.writeUInt16BE(len, 2);
  else if (ext === 8) out.writeBigUInt64BE(BigInt(len), 2);
  const at = 2 + ext + maskLen;
  if (opts.mask) {
    out.set(opts.mask, 2 + ext);
    for (let i = 0; i < len; i++) out[at + i] = payload[i] ^ opts.mask[i & 3];
  } else out.set(payload, at);
  return out;
}

export interface Frame { fin: boolean; opcode: number; payload: Buffer }

/** Incremental frame parser (client → server: frames must be masked). Throws WsError on protocol errors. */
export class FrameParser {
  private buf = Buffer.alloc(0);
  constructor(private readonly maxPayload: number) {}

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: Frame[] = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      if (b[0] & 0x70) throw new WsError(CLOSE.protocol, 'reserved bits set');
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      if (!masked) throw new WsError(CLOSE.protocol, 'unmasked client frame');
      if (![0, 1, 2, 8, 9, 10].includes(opcode)) throw new WsError(CLOSE.protocol, `bad opcode ${opcode}`);
      let len = b[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2); at = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) throw new WsError(CLOSE.tooBig, 'frame too big');
        len = Number(big); at = 10;
      }
      if (opcode >= 8 && (len > 125 || !fin)) throw new WsError(CLOSE.protocol, 'bad control frame');
      if (len > this.maxPayload) throw new WsError(CLOSE.tooBig, 'frame too big');
      if (b.length < at + 4 + len) break;
      const mask = b.subarray(at, at + 4);
      const payload = Buffer.from(b.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      frames.push({ fin, opcode, payload });
      this.buf = b.subarray(at + 4 + len);
    }
    return frames;
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** One accepted WebSocket. Set the callbacks right after creation. */
export class WebSocketConnection {
  /** Text messages arrive as strings, binary ones as Buffers. */
  onMessage: (data: string | Uint8Array) => void = () => {};
  /** Called once when the socket is gone (1006 = no close frame received). */
  onClose: (code: number, reason: string) => void = () => {};
  /** Last ping round-trip time (ms), 0 before the first pong. */
  rtt = 0;
  private readonly parser: FrameParser;
  private fragments: Buffer[] = [];
  private fragOpcode = 0;
  private fragSize = 0;
  private closeSent = false;
  private closeCode = 1006;
  private closeReason = '';
  private closed = false;

  constructor(private readonly socket: Duplex, readonly remoteAddress: string, private readonly maxPayload: number) {
    this.parser = new FrameParser(maxPayload);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', (e: Error) => { console.warn(`socket: ${e.message}`); socket.destroy(); });
    socket.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose(this.closeCode, this.closeReason);
    });
  }

  get isOpen(): boolean { return !this.closeSent && !this.closed; }

  send(data: string | Uint8Array): void {
    if (!this.isOpen) return;
    if (typeof data === 'string') this.socket.write(encodeFrame(OP.text, Buffer.from(data, 'utf8')));
    else this.socket.write(encodeFrame(OP.binary, data));
  }

  /** Sends a ping carrying the send time; the pong updates `rtt`. */
  ping(): void {
    if (!this.isOpen) return;
    const p = Buffer.alloc(8);
    p.writeDoubleBE(performance.now());
    this.socket.write(encodeFrame(OP.ping, p));
  }

  close(code: number = CLOSE.normal, reason = ''): void {
    if (this.closeSent || this.closed) return;
    this.closeSent = true;
    const r = Buffer.from(reason.slice(0, 100), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code);
    r.copy(p, 2);
    this.socket.write(encodeFrame(OP.close, p));
    const timer = setTimeout(() => this.socket.destroy(), CLOSE_TIMEOUT_MS);
    this.socket.on('close', () => clearTimeout(timer));
  }

  /** Feeds raw bytes (also used for the upgrade `head`). */
  receive(chunk: Buffer): void {
    if (this.closed) return;
    let frames: Frame[];
    try {
      frames = this.parser.push(chunk);
    } catch (e) {
      this.fail(e instanceof WsError ? e.code : CLOSE.protocol, (e as Error).message);
      return;
    }
    for (const f of frames) if (!this.handle(f)) return;
  }

  /** Returns false once the connection is failing/closing and further frames must be ignored. */
  private handle(f: Frame): boolean {
    switch (f.opcode) {
      case OP.ping:
        if (this.isOpen) this.socket.write(encodeFrame(OP.pong, f.payload));
        return true;
      case OP.pong:
        if (f.payload.length === 8) this.rtt = performance.now() - f.payload.readDoubleBE(0);
        return true;
      case OP.close: {
        this.closeCode = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
        this.closeReason = f.payload.length > 2 ? f.payload.subarray(2).toString('utf8') : '';
        if (this.closeSent) this.socket.destroy();
        else {
          this.closeSent = true;
          this.socket.end(encodeFrame(OP.close, f.payload.subarray(0, 2)));
        }
        return false;
      }
      case OP.cont:
        if (!this.fragOpcode) { this.fail(CLOSE.protocol, 'unexpected continuation'); return false; }
        break;
      default:
        if (this.fragOpcode) { this.fail(CLOSE.protocol, 'expected continuation'); return false; }
        this.fragOpcode = f.opcode;
    }
    this.fragSize += f.payload.length;
    if (this.fragSize > this.maxPayload) { this.fail(CLOSE.tooBig, 'message too big'); return false; }
    this.fragments.push(f.payload);
    if (!f.fin) return true;
    const data = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
    const opcode = this.fragOpcode;
    this.fragments = []; this.fragOpcode = 0; this.fragSize = 0;
    if (opcode === OP.text) {
      let text: string;
      try { text = utf8.decode(data); } catch { this.fail(CLOSE.badData, 'invalid utf-8'); return false; }
      this.onMessage(text);
    } else this.onMessage(data);
    return this.isOpen;
  }

  private fail(code: number, reason: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.close(code, reason);
  }
}

/**
 * Completes a WebSocket upgrade (call from the http server's 'upgrade' event after checking the path).
 * Returns null (and answers 400) when the request is not a valid version-13 WebSocket handshake.
 */
export function acceptUpgrade(
  req: IncomingMessage, socket: Duplex, head: Buffer, maxPayload: number, remoteAddress = req.socket.remoteAddress ?? '',
): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key'];
  const valid = req.method === 'GET'
    && String(req.headers.upgrade).toLowerCase() === 'websocket'
    && req.headers['sec-websocket-version'] === '13'
    && typeof key === 'string' && Buffer.from(key, 'base64').length === 16;
  if (!valid) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return null;
  }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  (socket as Socket).setNoDelay?.(true); // snapshots are small and latency-sensitive
  const ws = new WebSocketConnection(socket, remoteAddress, maxPayload);
  if (head.length) queueMicrotask(() => ws.receive(head));
  return ws;
}
