# Agent: third-person camera + lock-on

**You own:** `src/camera/*`, `src/config/camera.ts`, tests `tests/unit/camera*.test.ts`.

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts`, `src/game/Actor.ts`, `src/game/context.ts`, `src/core/input.ts`,
`src/physics/PhysicsWorld.ts`, the stub `src/camera/CameraRig.ts`.

## Deliver (keep the public API of `CameraRig`)
- `update(frameDt, alpha)` per render frame. If `frameDt === 0` (paused) do not change state; just keep the camera where it is.
  Otherwise: read `ctx.input.consumeMouse()` → yaw/pitch with `CAMERA.mouseRadPerPx * ctx.settings.sensitivity`, `ctx.settings.invertY`,
  pitch clamped. Follow the interpolated player model position (`ctx.player.model.root.position`) with exponential smoothing
  (frame-rate independent: `1 - exp(-sharpness*dt)`), orbit at `CAMERA.distance` with a slight shoulder offset.
- Avoid clipping through walls: `ctx.physics.raycast(pivot, dir, dist, {worldOnly:true})`, pull in with padding, min distance;
  smooth zoom back out.
- Lock-on (`updateSim(dt)`, fixed step): `ctx.pressed.has('lockOn')` toggles; acquire the best living enemy within
  `CAMERA.lockOnRange` (score by angle from camera forward and distance, prefer visible = no world hit between).
  `switchTarget` cycles to the next candidate (ordered by screen angle). If the target dies/is removed/goes out of range ×1.3,
  switch automatically to the next best target or release. Emit `lockOn` on every change. While locked, yaw/pitch ease
  toward framing player + target (mouse still nudges pitch a little). Expose `lockTarget` (Actor | null).
- `shake(intensity, duration)`: decaying, clamped to `CAMERA.maxShake`, applied as a small offset (render only).
- In the `menu` state the Game still calls `update`: a slow automatic orbit around the player is welcome when no mouse input
  arrives and `ctx.input.enabled === false`.
- Put target selection in a pure exported function and unit-test it (picks centre-most, ignores dead, cycles in order, out of range).
- Free nothing special; `reset()` restores defaults and releases the lock (emit `lockOn` null only if it was locked).
