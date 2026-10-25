# Agent: effects v2 (manga impacts & chakra)

**You own:** `src/render/Effects.ts`, `src/render/meshes.ts`, new files under `src/render/fx/`. Nothing else.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `src/render/Effects.ts`, `src/render/meshes.ts`, `src/render/PostFX.ts`
(`glowMaterial`, bloom threshold 1.0), `src/core/events.ts`, `src/game/Actor.ts`.

Keep the public API (`Effects` constructor/update/clear/dispose/burst/liveParticles; `createProjectileMesh`, `disposeObject`).
Simulation-time only in `update(dt)` (effects freeze on pause). Pools, no per-hit allocations.

Deliver Shinobi Striker-style effects:
1. **Hit impacts**: anime impact star (camera-facing billboard, procedural canvas texture: white jagged starburst with an orange/yellow
   rim), short-lived, scaled up fast then popping out; heavier hits (combo3/special/kill) bigger + radial "impact lines" sprite; blocked =
   blue hexagonal shield flash. Keep sparks but make them glowing (HDR colour via vertex colour × intensity so they bloom).
2. **Chakra**: Rasengan technique burst = expanding glowing sphere shockwave + spiral wind streaks + ground crack ring decal; concentration =
   rising blue chakra flames/particles around the actor while `fighter.concentrating` (poll actors via `getActor` is not enough — you
   receive `concentrateStart`; then follow the actor each update while `actor.fighter.concentrating` is true).
3. **Telegraph**: red-orange glowing ground ring shrinking + a vertical glint at the enemy (keep reading `telegraph` events).
4. **Movement**: dodge = puff of white smoke (cel-shaded, 2-tone, not transparent mush) + log substitution flavour optional; landing dust as
   chunky cel puffs; sprint dust trail; jump = small wind ring.
5. **Projectiles** (`meshes.ts`): kunai with a glowing motion trail (short ribbon or stretched billboard), shuriken with a faint glow streak,
   enemy shuriken readable from distance (slight red glow).
6. **Death**: enemy vanishes in a big white smoke "poof" (ninja style) — emit at `death`; Game removes the corpse after
   `ENEMIES.corpseTime` (2.5 s); that's fine.
Respect the perf budget; reuse geometry/materials; textures generated once. Check with screenshots (the fight scenario captures a hit
and a Rasengan) and iterate. Report what you built.
