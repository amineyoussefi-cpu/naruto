import type { ClientMsg, PlayerInput, ServerMsg } from '../sim/protocol';

/**
 * What the client talks to: the in-process `LocalHost` (solo, offline) or `NetClient` (WebSocket to `npm run host`).
 * Owner: integration.
 */
export interface Connection {
  /** False for the in-process solo host (real pause, no prediction). */
  readonly online: boolean;
  /** Messages received since the previous call, in arrival order. */
  poll(): ServerMsg[];
  /** One input per client simulation step. Solo: runs one simulation step right away. */
  sendInput(input: PlayerInput): void;
  send(msg: ClientMsg): void;
  close(): void;
}
