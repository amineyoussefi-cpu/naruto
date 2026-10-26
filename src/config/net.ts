/** Networking (host server, snapshots, interpolation, prediction). Owner: net agent. Units: ms unless noted. */
export const NET = {
  /** HTTP + WebSocket port of `npm run host` (`--port` overrides). */
  port: 5180,
  /** WebSocket endpoint path. */
  wsPath: '/ws',
  /** Snapshots sent per second (the sim runs at 60 Hz). */
  snapshotRate: 30,
  /** A full (non-delta) snapshot is sent at least this often (s). */
  fullSnapshotInterval: 1,
  /** Remote actors are rendered this far in the past (interpolation buffer). */
  interpDelayMs: 100,
  /** EMA factor (0..1) of the server-clock offset estimate, per snapshot. */
  clockSmoothing: 0.1,
  /** Offset jumps larger than this reset the clock estimate instead of smoothing (tab was asleep, etc.). */
  clockResetMs: 500,
  /** Most snapshots kept in the interpolation buffer. */
  interpBufferMax: 32,
  /** Seconds a disconnected player keeps its slot; reconnecting with the same name gets it back. */
  reconnectGrace: 30,
  /** Lag compensation never rewinds targets further back than this. */
  lagCompMaxMs: 150,
  /** Inputs queued per client beyond this are merged (oldest dropped, `pressed` bits OR-ed). */
  inputQueueMax: 6,
  /** Inputs batched in one client packet (1 or 2). */
  inputsPerPacket: 2,
  /** Most sim steps the server runs in one loop iteration to catch up after a stall. */
  maxCatchUpSteps: 8,
  /** Server loop timer period (the accumulator decides the steps). */
  loopIntervalMs: 4,
  /** Ping period (client app-level ping and server WebSocket ping). */
  pingIntervalMs: 1000,
  /** Prediction error (m) above which the client rewinds and replays its pending inputs. */
  reconcileEpsilon: 0.05,
  /** Small corrections are smoothed out over this time. */
  smoothMs: 100,
  /** Corrections larger than this (m) snap instead of smoothing. */
  snapDistance: 2,
  /** Largest client → server WebSocket message (bytes); bigger frames close the connection (1009). */
  maxPayload: 64 * 1024,
  /** Player names are trimmed to this many characters. */
  nameMaxLength: 16,
  /** `NetClient.connect` gives up after this long without a welcome. */
  connectTimeoutMs: 15000,
} as const;
