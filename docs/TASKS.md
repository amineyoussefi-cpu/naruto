# Task tracker

| # | Area | Owner | Files | Depends on | Status |
|---|------|-------|-------|------------|--------|
| 0 | Architecture, contracts, loop, input, physics wrapper, Game integration | integration lead | `src/core/*`, `src/game/*`, `src/physics/*` (base), `src/main.ts`, `src/config/index.ts` | — | done |
| 1 | Movement: locomotion, jump, climb, respawn | agent-movement | `src/player/*`, `src/physics/*`, `src/config/movement.ts`, `tests/unit/movement*.test.ts` | 0 | done |
| 2 | Camera: orbit, collision, lock-on | agent-camera | `src/camera/*`, `src/config/camera.ts`, `tests/unit/camera*.test.ts` | 0 | done |
| 3 | Combat: fighter, hitboxes, projectiles, player actions | agent-combat | `src/combat/*`, `src/config/combat.ts`, `src/config/chakra.ts`, `tests/unit/{fighter,combat}*.test.ts` | 0 | done |
| 4 | Enemy AI + waves | agent-ai | `src/ai/*`, `src/config/enemies.ts`, `src/config/waves.ts`, `tests/unit/{ai,waves}*.test.ts` | 0, 3 (API) | done |
| 5 | Arena, ninja models/animations, VFX, audio | agent-visuals | `src/world/*`, `src/render/*`, `src/audio/*`, `public/*` (assets) | 0 | done |
| 6 | HUD, menus, pause, settings | agent-ui | `src/ui/*`, `src/config/settings.ts`, `index.html` (body only) | 0 | done |
| 7 | Tests e2e, Docker, docs | integration lead | `tests/e2e/*`, `Dockerfile`, `compose.yaml`, `README.md`, `docs/*` | 1–6 | done |

## Decisions
- **Physical-key bindings** (`KeyboardEvent.code`): one binding set works for QWERTY and AZERTY; only the help labels differ (auto-detected via Keyboard API / language, overridable in settings).
- **Kinematic character controller** (Rapier) for every ninja; arena is static colliders. Hit detection is analytic (sphere vs capsule), not physics contacts, for determinism and once-per-hit guarantees.
- **Fixed 60 Hz simulation** with accumulator and render interpolation; pause stops stepping and resets the accumulator (no time jump on resume).
- **Procedural audio** (WebAudio synthesis) and **procedural models/animations**: zero binary assets, no licensing questions.
- **Rasengan-style dash** as the chakra technique; **kunai** as the ranged attack (Q / A on AZERTY, or middle click).
- Dependencies pinned exactly; vite 7 / vitest 4 chosen to clear npm audit advisories in vite 6 / vitest 3.
- **Shared geometry** in NinjaModel: `dispose()` frees per-model materials only; shared geometries live for the page lifetime.
- **Distance-based shuriken spin** so projectiles visually freeze on pause.
- **Input buffering** for special/kunai (integration fix after playtest: presses mid-combo were dropped).
- **Combat owns yaw during forced moves** (integration fix: back-dodge spun the player).

## Integration log
| Step | Result |
|---|---|
| Skeleton + contracts, then 6 agents in parallel (movement, camera, combat, AI, visuals, UI) | all delivered, no file conflicts |
| Integration fixes | enemy `attackStart` emission, forced-move facing, special/kunai buffering, UI click sound via `GameApi.uiClick` |
| Validation | lint, typecheck, 62 unit tests, Playwright e2e, scripted visual playtest, Docker build + run, FPS measurement |
