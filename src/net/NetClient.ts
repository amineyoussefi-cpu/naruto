/** Browser connection to `npm run host` over WebSocket (JSON control messages, binary inputs and snapshots). */
import { NET } from '../config/net';
import type { CharacterId } from '../core/types';
import { PROTOCOL_VERSION, type ClientMsg, type PlayerInput, type ServerMsg } from '../sim/protocol';
import type { Connection } from './connection';
import { encodeInputs, SnapshotDecoder } from './codec';

export type WelcomeMsg = Extract<ServerMsg, { t: 'welcome' }>;

export class NetClient implements Connection {
  readonly online = true;
  /** Last measured round-trip time (ms), 0 before the first pong. */
  rtt = 0;
  /** False once the socket has closed (server gone, kicked…). */
  connected = true;
  private inbox: ServerMsg[] = [];
  private batch: PlayerInput[] = [];
  private readonly decoder = new SnapshotDecoder();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(private readonly ws: WebSocket, readonly welcome: WelcomeMsg) {}

  /** `ws(s)://<page host>/ws`: the server serves the page and the socket on the same port. */
  static defaultUrl(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${NET.wsPath}`;
  }

  /** Opens the socket, says hello and resolves on `welcome` (which is also the first `poll()` message). Rejects in French. */
  static connect(url: string, name: string, character: CharacterId): Promise<NetClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { reject(new Error('Adresse du serveur invalide.')); return; }
      ws.binaryType = 'arraybuffer';
      let client: NetClient | null = null;
      const early: ServerMsg[] = [];
      const fail = (message: string): void => {
        clearTimeout(timeout);
        reject(new Error(message));
        ws.close();
      };
      const timeout = setTimeout(() => fail('Le serveur ne répond pas.'), NET.connectTimeoutMs);
      ws.onopen = () => {
        const hello: ClientMsg = { t: 'hello', version: PROTOCOL_VERSION, name, character };
        ws.send(JSON.stringify(hello));
      };
      ws.onerror = () => { if (!client) fail('Impossible de joindre le serveur.'); };
      ws.onclose = (ev: CloseEvent) => {
        if (client) client.onSocketClosed(ev.code, ev.reason);
        else fail('Connexion fermée par le serveur.');
      };
      ws.onmessage = (ev: MessageEvent) => {
        if (client) { client.receive(ev.data); return; }
        if (typeof ev.data !== 'string') return;
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === 'full') fail('Serveur plein (6 joueurs maximum).');
        else if (msg.t === 'version') fail(`Version différente du serveur (serveur ${msg.server}, client ${PROTOCOL_VERSION}). Rechargez la page.`);
        else if (msg.t === 'welcome') {
          clearTimeout(timeout);
          client = new NetClient(ws, msg);
          client.inbox.push(msg, ...early);
          client.startPing();
          resolve(client);
        } else early.push(msg);
      };
    });
  }

  poll(): ServerMsg[] {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  /** Batches `NET.inputsPerPacket` inputs per binary packet. */
  sendInput(input: PlayerInput): void {
    this.batch.push(input);
    if (this.batch.length < NET.inputsPerPacket) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeInputs(this.batch));
    this.batch = [];
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.stopPing();
    this.connected = false;
    this.ws.close(1000);
  }

  private receive(data: unknown): void {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as ServerMsg;
      if (msg.t === 'pong') this.rtt = performance.now() - msg.time;
      this.inbox.push(msg);
    } else if (data instanceof ArrayBuffer) {
      this.inbox.push({ t: 'snapshot', snap: this.decoder.decode(new Uint8Array(data)) });
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => this.send({ t: 'ping', time: performance.now() }), NET.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Close code / reason of the socket once it has closed (for the UI message). */
  closeInfo = '';

  private onSocketClosed(code: number, reason: string): void {
    this.stopPing();
    this.connected = false;
    this.closeInfo = `${code}${reason ? ` ${reason}` : ''}`;
    console.warn(`Connexion au serveur perdue (${this.closeInfo})`);
  }
}
