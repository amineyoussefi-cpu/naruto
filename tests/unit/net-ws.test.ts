import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptKey, acceptUpgrade, CLOSE, encodeFrame, FrameParser, OP, WebSocketConnection } from '../../server/ws';

const MASK = new Uint8Array([0x37, 0xfa, 0x21, 0x3d]);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** In-memory socket: records written bytes, fires listeners. */
class FakeSocket {
  written: Buffer[] = [];
  ended = false;
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  on(ev: string, fn: (arg?: unknown) => void): this { (this.handlers[ev] ??= []).push(fn); return this; }
  emit(ev: string, arg?: unknown): void { for (const fn of this.handlers[ev] ?? []) fn(arg); }
  write(b: Buffer): boolean { this.written.push(b); return true; }
  end(b?: Buffer): this { if (b) this.written.push(b); this.ended = true; this.emit('close'); return this; }
  destroy(): this { this.emit('close'); return this; }
  /** Server frames (unmasked, short). */
  frames(): { opcode: number; payload: Buffer }[] {
    return this.written.map((b) => {
      const len = b[1] & 0x7f;
      const at = len === 126 ? 4 : 2;
      return { opcode: b[0] & 0x0f, payload: b.subarray(at) };
    });
  }
}

function open(maxPayload = 1024): { sock: FakeSocket; ws: WebSocketConnection; got: (string | Uint8Array)[]; closed: number[] } {
  const sock = new FakeSocket();
  const ws = new WebSocketConnection(sock as unknown as Duplex, '1.2.3.4', maxPayload);
  const got: (string | Uint8Array)[] = [];
  const closed: number[] = [];
  ws.onMessage = (d) => got.push(d);
  ws.onClose = (code) => closed.push(code);
  return { sock, ws, got, closed };
}

describe('websocket server', () => {
  it('computes the RFC 6455 accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('unmasks client frames, including 16-bit lengths and split chunks', () => {
    const big = new Uint8Array(300).map((_, i) => i & 0xff);
    const bytes = Buffer.concat([encodeFrame(OP.text, text('Hello'), { mask: MASK }), encodeFrame(OP.binary, big, { mask: MASK })]);
    const p = new FrameParser(1024);
    const frames = [...p.push(bytes.subarray(0, 5)), ...p.push(bytes.subarray(5, 20)), ...p.push(bytes.subarray(20))];
    expect(frames.map((f) => f.opcode)).toEqual([OP.text, OP.binary]);
    expect(frames[0].payload.toString('utf8')).toBe('Hello');
    expect([...frames[1].payload]).toEqual([...big]);
  });

  it('rejects unmasked client frames', () => {
    expect(() => new FrameParser(100).push(encodeFrame(OP.text, text('x')))).toThrow();
  });

  it('reassembles fragmented messages with an interleaved ping', () => {
    const { sock, ws, got } = open();
    ws.receive(encodeFrame(OP.text, text('Hel'), { fin: false, mask: MASK }));
    ws.receive(encodeFrame(OP.ping, text('p'), { mask: MASK }));
    ws.receive(encodeFrame(OP.cont, text('lo '), { fin: false, mask: MASK }));
    ws.receive(encodeFrame(OP.cont, text('world'), { mask: MASK }));
    expect(got).toEqual(['Hello world']);
    expect(sock.frames()[0]).toMatchObject({ opcode: OP.pong });
    expect(sock.frames()[0].payload.toString('utf8')).toBe('p');
  });

  it('answers a close frame with the same code and reports it', () => {
    const { sock, ws, closed } = open();
    const p = Buffer.alloc(2); p.writeUInt16BE(1000);
    ws.receive(encodeFrame(OP.close, p, { mask: MASK }));
    const f = sock.frames().at(-1)!;
    expect(f.opcode).toBe(OP.close);
    expect(f.payload.readUInt16BE(0)).toBe(1000);
    expect(sock.ended).toBe(true);
    expect(closed).toEqual([1000]);
    ws.send('late'); // ignored after close
    expect(sock.frames().length).toBe(1);
  });

  it('closes with 1009 on an oversized frame or message', () => {
    const a = open(10);
    a.ws.receive(encodeFrame(OP.binary, new Uint8Array(11), { mask: MASK }));
    expect(a.sock.frames()[0].payload.readUInt16BE(0)).toBe(CLOSE.tooBig);
    const b = open(10);
    b.ws.receive(encodeFrame(OP.binary, new Uint8Array(6), { fin: false, mask: MASK }));
    b.ws.receive(encodeFrame(OP.cont, new Uint8Array(6), { mask: MASK }));
    expect(b.got).toEqual([]);
    expect(b.sock.frames()[0].payload.readUInt16BE(0)).toBe(CLOSE.tooBig);
  });

  it('talks to a real WebSocket client over node:http', async () => {
    const server = createServer();
    server.on('upgrade', (req, socket, head) => {
      const ws = acceptUpgrade(req, socket, head, 1024);
      if (ws) ws.onMessage = (d) => ws.send(typeof d === 'string' ? `echo:${d}` : d);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.binaryType = 'arraybuffer';
    const replies: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      client.onerror = () => reject(new Error('ws error'));
      client.onopen = () => { client.send('hi'); client.send(new Uint8Array([1, 2, 3])); };
      client.onmessage = (ev) => { replies.push(ev.data); if (replies.length === 2) resolve(); };
    });
    expect(replies[0]).toBe('echo:hi');
    expect([...new Uint8Array(replies[1] as ArrayBuffer)]).toEqual([1, 2, 3]);
    const code = await new Promise<number>((r) => { client.onclose = (ev) => r(ev.code); client.close(1000); });
    expect(code).toBe(1000);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
