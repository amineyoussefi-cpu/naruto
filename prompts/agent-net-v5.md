# Agent: net v5 (host server, WebSocket, binary codec, client connection, interpolation, reconciliation helpers)

**You own:** `server/*` (new), `src/net/*` **except** `connection.ts` and `LocalHost.ts`, `src/config/net.ts` (new),
`tests/unit/net*.test.ts`, `tsconfig.server.json` if you need one. **No new npm dependencies.**
Read: `prompts/01-shared-rules.md`, `prompts/40-update-v5-online.md` (Phase 0–1), the contracts `src/sim/protocol.ts`,
`src/net/connection.ts`, `src/sim/missions/types.ts`, `src/core/events.ts`, `src/core/types.ts`, `vite.config.ts`, `package.json`.

## The simulation you drive (the lead implements `src/sim/Sim.ts` with exactly this API, in parallel)
```ts
class Sim {
  static create(opts: { seed: number; online: boolean }): Promise<Sim>;
  readonly seed: number;
  get tick(): number;
  addPlayer(name: string, character: CharacterId): PlayerState;   // throws when MAX_PLAYERS reached
  removePlayer(id: PlayerId): void;
  setConnected(id: PlayerId, connected: boolean): void;            // disconnected players keep their actor (idle)
  setCharacter(id: PlayerId, character: CharacterId): void;
  setRtt(id: PlayerId, ms: number): void;
  setInput(id: PlayerId, input: PlayerInput): void;               // used by the next step()
  step(): void;                                                    // one SIM_DT (1/60 s) step
  takeEvents(): SimEvent[];                                        // events since the last call
  takeActorChanges(): { add: ActorInfo[]; remove: number[] };      // actors spawned/removed since the last call
  actorInfos(): ActorInfo[];                                       // all current actors (for welcome)
  snapshot(forPlayer: PlayerId | null, events: SimEvent[]): Snapshot;
  ackSeq(id: PlayerId): number;
}
```
Code against this (import the type from `../src/sim/Sim`; in unit tests use a fake implementing the same shape).

## Deliver
1. `server/ws.ts`: minimal RFC 6455 server on `node:http` upgrade + `node:crypto` (handshake with Sec-WebSocket-Accept, masked
   client frames, text/binary, fragmentation/continuation, ping/pong, close handshake with codes, max payload limit, no
   extensions). ≈ 150–250 lines. Unit tests: handshake key, masking, fragmented message reassembly, close, oversized frame.
2. `server/main.ts` (bundled by `vite build --ssr server/main.ts --outDir dist-server`, run with `node dist-server/main.js`):
   serves `dist/` (static, correct MIME types incl. `.wasm`/`.glb`, path-traversal safe, index.html fallback) and `/ws` on
   port 5180 (`--port`). **Bind to `127.0.0.1` and every Tailscale IPv4 (100.64.0.0/10 from `os.networkInterfaces()`) only**;
   `--lan` adds `0.0.0.0`. On start print the URLs to share (MagicDNS name from `tailscale status --json` via `child_process`
   if available, else the 100.x IP) in French + English. `--dev` = no static serving (Vite dev server proxies `/ws`).
3. `server/ServerHost.ts`: owns a `Sim`; fixed 60 Hz loop (accumulator on `process.hrtime`, catch-up capped); per-client input
   queue (apply one input per step; empty queue → repeat the last held bits with `pressed = 0`; queue > N → merge/drop oldest,
   OR-ing `pressed` bits); snapshots at 30 Hz (`net.snapshotRate`), each client gets `sim.snapshot(itsPlayer, events)` with
   the same events; actor add/remove as `{t:'actors'}` JSON; `hello` → `welcome` (or `full` for a 7th player, `version`
   mismatch); `isHost` = connection from 127.0.0.1/::1; `kick` from the host only; ping/pong RTT → `sim.setRtt`; disconnect →
   `setConnected(false)`, reconnect with the same name within 30 s (`net.reconnectGrace`) gets the same player back, else
   `removePlayer`.
4. `src/net/codec.ts` (shared by server and browser, Node-safe): binary `PlayerInput` (seq uint32, axes int8, angles uint16,
   bitmasks, aimDir int16×3, lockId uint16, qte uint8; 2 inputs per packet allowed) and binary `Snapshot` with a versioned
   header: actors quantized (position 1 mm int32 or chunk-relative int16 at 1/64 m — your choice, documented; velocity
   cm/s int16; yaw uint16; anim index uint8 over a fixed `ANIM_STATES` list you define; animTime, hp, chakra uint16/float16
   as appropriate; flags uint16; team uint8; orb + level; wall normal int8×2), projectiles, then a JSON tail for `events`,
   `players`, `markers`, `mode`, `you`. Delta: send unchanged actors as "same as previous" when simple (WebSocket is ordered and
   reliable, so delta vs the previous snapshot sent to that client is enough); full snapshot every 1 s. Tests: round-trip,
   quantization error bounds, delta + full.
5. `src/net/NetClient.ts` implements `Connection` (browser `WebSocket`, binary type arraybuffer): `connect(url, name,
   character): Promise<NetClient>` (rejects with a French message on `full`/`version`/unreachable), batches inputs 2 per
   packet, pings every second (exposes `rtt`), decodes snapshots to `{ t: 'snapshot', snap }`.
6. `src/net/interpolation.ts`: `SnapshotBuffer` — push(snapshot, arrivalTimeMs); `sample(nowMs)` returns the two snapshots
   bracketing `now − net.interpDelayMs` (default 100) and `t`, with clock-offset smoothing from `tick`; tests.
   `src/net/prediction.ts`: `InputHistory` — record(input, predictedState), `reconcile(ackSeq, serverState, replay)`:
   drops acked entries, returns whether the error exceeds `net.reconcileEpsilon`, and calls `replay(input)` for each pending input
   after resetting; plus `CorrectionSmoother` (offset decays over `net.smoothMs` 100 ms, snaps above `net.snapDistance`). Tests:
   replaying inputs converges to the server state.
7. `src/config/net.ts`: port 5180, snapshot rate, interp delay, reconnect grace 30 s, lag-compensation cap 150 ms, input queue
   max, epsilon, smoothing — one-line comments.

Do not edit `package.json` (the lead adds `host`/`host:dev` scripts: `vite build && vite build --ssr server/main.ts --outDir
dist-server && node dist-server/main.js`; tell the lead if Vite needs `ssr.noExternal`/`target` settings and give the exact config).
Verify with `npx tsc --noEmit`, `npx eslint server src/net src/config/net.ts`, `npx vitest run tests/unit/net*`.
Final report per the shared rules (≤ 300 words).
