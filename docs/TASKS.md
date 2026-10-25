# Task tracker

| # | Area | Owner | Files | Depends on | Status |
|---|------|-------|-------|------------|--------|
| 0 | Architecture, contracts, loop, input, physics wrapper, Game integration | integration lead | `src/core/*`, `src/game/*`, `src/physics/*` (base), `src/main.ts`, `src/config/index.ts` | — | done (skeleton) |
| 1 | Movement: locomotion, jump, climb, respawn | agent-movement | `src/player/*`, `src/physics/*`, `src/config/movement.ts`, `tests/unit/movement*.test.ts` | 0 | in progress |
| 2 | Camera: orbit, collision, lock-on | agent-camera | `src/camera/*`, `src/config/camera.ts`, `tests/unit/camera*.test.ts` | 0 | in progress |
| 3 | Combat: fighter, hitboxes, projectiles, player actions | agent-combat | `src/combat/*`, `src/config/combat.ts`, `src/config/chakra.ts`, `tests/unit/{fighter,combat}*.test.ts` | 0 | in progress |
| 4 | Enemy AI + waves | agent-ai | `src/ai/*`, `src/config/enemies.ts`, `src/config/waves.ts`, `tests/unit/{ai,waves}*.test.ts` | 0, 3 (API) | in progress |
| 5 | Arena, ninja models/animations, VFX, audio | agent-visuals | `src/world/*`, `src/render/*`, `src/audio/*`, `public/*` (assets) | 0 | in progress |
| 6 | HUD, menus, pause, settings | agent-ui | `src/ui/*`, `src/config/settings.ts`, `index.html` (body only) | 0 | in progress |
| 7 | Tests e2e, Docker, docs | integration lead | `tests/e2e/*`, `Dockerfile`, `compose.yaml`, `README.md`, `docs/*` | 1–6 | todo |

## Decisions
- **Physical-key bindings** (`KeyboardEvent.code`): one binding set works for QWERTY and AZERTY; only the help labels differ (auto-detected via Keyboard API / language, overridable in settings).
- **Kinematic character controller** (Rapier) for every ninja; arena is static colliders. Hit detection is analytic (sphere vs capsule), not physics contacts, for determinism and once-per-hit guarantees.
- **Fixed 60 Hz simulation** with accumulator and render interpolation; pause stops stepping and resets the accumulator (no time jump on resume).
- **Procedural audio** (WebAudio synthesis) and **procedural models/animations**: zero binary assets, no licensing questions.
- **Rasengan-style dash** as the chakra technique; **kunai** as the ranged attack (Q / A on AZERTY, or middle click).
- Dependencies pinned exactly; vite 7 / vitest 4 chosen to clear npm audit advisories in vite 6 / vitest 3.
