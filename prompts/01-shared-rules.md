# Shared rules for every agent

You are one agent in a team building **Shinobi Arena**, a 3D ninja fighter playable solo offline or online with up to
6 players on a private Tailscale network (host-authoritative Node server; TypeScript, Three.js 0.170, Rapier 0.14
compat, Vite 7, Vitest 4).
The integration lead owns the architecture and wrote the contracts you build against.

## Hard rules
1. **Only edit the files you own** (listed in your brief). Never edit another agent's files,
   `src/core/*`, `src/game/*`, `src/config/index.ts`, `package.json` or the lock file.
   If you need a contract change, implement around it and **report it** in your final message.
2. **Keep every public method/field signature** of the stub you replace. You may add new
   public members. Exported names must stay.
3. Gameplay numbers go in **your** config file under `src/config/` (add fields freely there,
   with a one-line comment each). No magic numbers in logic.
4. Simulation code receives a fixed `dt` (1/60 s). Never use `performance.now()` or frame time in
   gameplay logic. Render-only code (model animation, camera smoothing) may use frame dt.
5. Pure logic (no DOM, no WebGL) wherever practical so it can be unit-tested with Vitest in Node.
6. Free GPU resources you create (geometry/material/texture `.dispose()`) in `clear()`/`dispose()`.
7. No network/CDN at runtime, no new npm dependencies.
8. Before finishing run: `npx tsc --noEmit` and `npx eslint <your files>` and `npx vitest run <your tests>`.
   Errors in files you do not own caused by other agents working in parallel can be ignored, but
   report them.
9. Don't run git commands; the integration lead commits.
10. Final message: what you implemented, public API additions, events emitted/consumed,
    known limitations, and any contract change requests. Keep it under 300 words.

## Simulation / client split (v5)
11. Everything that decides game state lives in `src/sim/` and must run in Node: no `document`, `window`,
    `WebGLRenderer`, canvas, `requestAnimationFrame`, `performance.now()` or `Math.random()` without a seedable source
    where determinism matters. Three.js math classes (`Vector3`, `Quaternion`) are fine. A unit test imports every
    `src/sim/**` module in Node.
12. Gameplay reads player input only through `PlayerState.input` / `PlayerState.pressed` (`src/sim/protocol.ts`),
    never through the keyboard or the camera. Visual state goes through `actor.vis` and events, never models.
13. Hits, damage and spawning are decided by the simulation only (server online, `LocalHost` solo). Clients may play
    instant feedback for their own attack start, never damage.
14. Contracts shared between agents: `src/sim/protocol.ts`, `src/sim/context.ts`, `src/sim/world/types.ts`,
    `src/sim/missions/types.ts`, `src/net/connection.ts`. Integration owns them; request changes in your report.

## Architecture recap (v4, still valid for the client side)
- `src/game/Game.ts` — integration root: renderer, fixed-step loop, state machine (menu/playing/paused/victory/defeat),
  spawning/removal of actors, HUD snapshot. Read it to understand call order.
- Per simulation step order: `input.consumePressed()` → `actor.beginStep()` + `animTime += dt` →
  `camera.updateSim` → `playerCombat.update` → `playerController.update` → `ai.update` →
  `combat.update` (ticks fighters, hitboxes, projectiles) → `fx.update` → `waves.update` →
  corpse cleanup → `physics.step()`.
- Per render frame: `actor.syncModel(alpha, frameDt)` (calls `model.update`) → `camera.update(frameDt, alpha)` → render → `ui.update`.
- `src/game/context.ts` — `GameContext`, the object every system receives.
- `src/game/Actor.ts` — shared ninja state (position = feet, velocity, yaw, grounded, climbing,
  anim/animTime, `control` permissions written by combat each step, `knockback`).
- `src/core/events.ts` — typed `EventBus` and the `GameEvents` catalogue. Emit/listen only those events.
- `src/core/input.ts` — physical-key bindings (`KeyboardEvent.code`), `ctx.pressed` = edge-triggered actions
  for this step, `input.isHeld(action)`, `input.moveAxes()`, `input.consumeMouse()` (render frame).
- `src/physics/PhysicsWorld.ts` — Rapier wrapper: `moveCharacter`, `teleport`, `raycast(…, {worldOnly})`,
  `climbable` collider handle set, static box/cylinder helpers.
- Coordinates: Y up. `yaw` 0 faces +Z; forward = (sin yaw, 0, cos yaw).
