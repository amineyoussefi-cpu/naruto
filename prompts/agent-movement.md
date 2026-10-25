# Agent: movement (locomotion, jump, collisions, climbing, respawn)

**You own:** `src/player/PlayerController.ts`, `src/physics/locomotion.ts`, `src/physics/PhysicsWorld.ts`,
`src/config/movement.ts`, new pure helpers under `src/player/`, tests `tests/unit/movement*.test.ts`.

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts`, `src/game/Actor.ts`, `src/game/context.ts`,
`src/core/input.ts`, `src/core/events.ts`, the current stubs you own.

## Deliver
`PlayerController.update(dt)` (runs after `PlayerCombat.update`, which has already written `actor.control`):
- Camera-relative movement from `ctx.input.moveAxes()` and `ctx.camera.yaw` (yaw 0 → +Z; forward=(sin,0,cos), right=(-cos,0,sin)… verify sign so D moves right on screen).
- Run by default, **sprint** while `sprint` held and grounded-moving; progressive acceleration/braking
  (`MOVEMENT.acceleration/deceleration`), reduced `airControl` in the air. Respect `control.allowMove`,
  `control.moveFactor`, `control.forcedVelocity`, `control.allowJump`.
- Facing: turn smoothly toward movement direction; when `ctx.camera.lockTarget` is set and not sprinting, face the target (strafe).
  Skip facing changes when `control.forcedVelocity` is set? No: face the forced direction unless combat set yaw itself — keep it simple and documented.
- **Jump** from `ctx.pressed.has('jump')` with height `MOVEMENT.jumpHeight` (v = √(2gh)), coyote time + jump buffer, reliable ground detection
  via `stepCharacter`'s grounded result. Emit `jump`, `land` (impact), `footstep` (cadence by speed, `sprint` flag).
- **Wall climbing**: pressing jump while airborne or grounded facing/moving into a wall whose collider is in `physics.climbable`
  (use `physics.raycast(chest, forward, MOVEMENT.climbProbeDistance, {worldOnly:true})` and `hit.climbable`) and with
  `fighter.chakra >= climbMinChakra` → `actor.climbing = true`. While climbing: stick to wall (face −normal),
  input forward/back = up/down, left/right = sideways along the wall, drain `climbChakraPerSecond*dt` via `fighter.trySpendChakra`
  (fails → fall off). **Top exit**: when the chest ray no longer hits but a lower ray does, hop up and forward onto the top.
  Jump while climbing = kick off the wall. Losing the wall = stop climbing. Emit `climbStart`.
  If climbing is blocked by lack of chakra emit `chakraFail` with action `'climb'`.
- Animations when `!control.animLocked`: `idle`, `run`, `sprint`, `jump` (rising), `fall`, `climb`. Use `actor.setAnim`.
- **Respawn**: remember last safe grounded position (only when grounded on stable ground, not climbing). If
  `position.y < MOVEMENT.killPlaneY` teleport there (`physics.teleport` + set position/prevPosition), zero velocity,
  `fighter.setInvulnerable(COMBAT.respawnInvulnerable)`, emit `respawn`.
- Dead player (`!actor.alive`): no input, still falls with gravity.
- `reset(feet)` restores everything (velocity, climbing, timers, safe position).
- `stepCharacter` is also used by enemy AI: keep its signature; improve it (deceleration vs acceleration, air control param via an optional options object is OK if backward compatible).

Tests (pure helpers): jump velocity from height, coyote/jump buffer, accel/decel approach is frame-rate independent enough
(same result for 60 Hz steps), climb chakra drain → stop at 0.
