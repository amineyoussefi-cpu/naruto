# Agent: arena, characters, animations, effects, audio

**You own:** `src/world/*`, `src/render/*` (`NinjaModel.ts`, `Effects.ts`, `meshes.ts`, new files), `src/audio/*`,
`public/` (only if you add assets — prefer none), `ASSETS.md` (provenance, create it).

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts`, `src/game/Actor.ts`, `src/core/events.ts`, `src/core/types.ts`,
`src/physics/PhysicsWorld.ts`, your stubs. Style: stylised, bold flat colours, toon shading (`MeshToonMaterial` +
a small gradient map), readable silhouettes, Naruto-inspired but **original** (no copyrighted logos/characters).
Performance target: 60 FPS on an ordinary laptop — instancing for repeated props, one shadow-casting directional light with tight
shadow camera bounds, shadow map ≤ 2048, low-poly geometry, shared materials.

## Arena (`buildArena`)
A ~70×70 m training-ground plateau: ground, outer **climbable** cliff/wall ring, several climbable rock pillars/walls of different
heights (4–12 m) with flat walkable tops, 2–3 platforms reachable by climbing or jumping, low obstacles (crates, logs, training posts),
trees/props for flavour (no colliders needed for tiny props). One side with an **open edge / gap** where the player can fall
(so the respawn logic is exercisable) — e.g. a bridge over a chasm. Sky (gradient sphere or background), light fog, hemisphere +
directional light. Keep ≥ 6 enemy spawn points spread around, player spawn near the centre. All colliders via the
`PhysicsWorld` helpers; climbable ones with `{ climbable: true }`. `dispose()` frees everything.

## NinjaModel (procedural, hierarchical: hips/torso/head/arms/legs with pivot groups)
Distinct, readable poses/motions for **every** `AnimState`: idle (breathing), run (arm swing), sprint (ninja run: torso forward,
arms back), jump, fall, climb (alternating reach), attack1/2/3 (distinct strikes: jab, hook, spinning kick/uppercut), throw,
special (palm forward with orb), guard (arms crossed), dodge (crouched roll/flip), hit (recoil), dead (collapse to ground),
concentrate (hand seal, crouched stance), telegraph (raised arm, glow). Use `animTime` for one-shot timing and blend toward target
poses with frame dt. Features: headband with metal plate, hair spikes/colour, optional mask, scarf/belt. `setTelegraph`
(emissive glow + small floating "!" sprite or ring), `flash`, `setAura` (translucent additive shell, pulsing), `setHandOrb`
(swirling blue sphere at right hand), `setGuard`. Use shared geometries/materials where possible but per-instance materials for
flash/emissive. `dispose()` frees per-instance resources.

## Effects (listens to events; `getActor(id)` gives you positions)
Pooled particles: hit sparks on `damage` (blue sparks if blocked, bigger burst if killed), dust on `land`/`footstep`(sprint),
dodge after-image or smoke puff (`dodge`), chakra burst + shockwave ring on `technique`, telegraph ring under enemies on
`telegraph`, projectile impact on `projectileHit`, respawn puff. Short-lived point-light flash allowed (pool 1–2 lights max).
`update(dt)` is simulation time (frozen while paused). `clear()` removes everything live.

## AudioSystem (WebAudio synthesis, no files)
Sounds from oscillators/noise buffers with envelopes: swing whoosh (`attackStart`), punch/impact (`damage`, lower when blocked = clang),
kunai throw, special charge + boom, jump, land, footstep, dodge, chakraFail buzz, concentrate hum (`concentrateStart`), telegraph
ping, wave start taiko hit, waveCleared/victory/defeat stingers, death. Optional subtle procedural taiko/flute ambience loop.
Master gain from `setVolume`; `setPaused(true)` suspends/mutes; `unlock()` resumes the AudioContext (user gesture). Limit
simultaneous voices. Never throw if WebAudio is unavailable.
Also export `playUiClick()` (method) for menus.

`meshes.ts`: kunai (blade + ring handle), shuriken (4-point star, spins — spinning can be done in Effects or by tagging
`userData.spin = true`; tell the integration lead which), chakra sphere.
