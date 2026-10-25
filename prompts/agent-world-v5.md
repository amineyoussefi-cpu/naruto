# Agent: world v5 (big seeded world: Konoha village, forest, lake/sea)

**You own:** `src/world/*` (client meshes; new files welcome), `src/sim/world/*` **except** `types.ts`, `src/config/world.ts` (new),
`tests/unit/world*.test.ts`, an optional dev-only viewer `preview-world.html` + `src/world/preview.ts`.
You may **add** methods to `src/sim/physics/PhysicsWorld.ts` (e.g. `addStaticHeightfield`, `addStaticCapsule`) — additions only.
**Do not delete** `src/world/Arena.ts` / `terrain.ts` (the lead still uses them until switching to your world; you may reuse code).
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `prompts/40-update-v5-online.md` (Phase 2), `src/sim/world/types.ts`
(**the contract**), all of `src/world/*`, `src/render/{toon,PostFX}.ts`, `src/sim/physics/PhysicsWorld.ts`, `ASSETS.md`.

## Deliver
1. `src/sim/world/generate.ts`: `generateWorld(seed: number): WorldData` — pure, deterministic, Node-safe (no DOM/canvas/WebGL;
   Three math OK), < 1.5 s in Node. Layout of Phase 2 (≈ 900 × 900 m playable, centred on the origin, north = −Z):
   village ≈ 260 m in the centre against a cliff on its north side, ring wall with a main gate (south) and two small gates,
   central round **HQ** with a red roof and a plaza south of it, dense districts, market street, training ground with posts,
   river with bridges, rooftop routes, climbable walls; forest ≈ 250 m deep all around (giant 30–40 m trees with climbable trunks
   and standable branches, clearings, dirt paths from each gate, rocks, streams, a ravine with a bridge, kill plane in the ravine);
   lake/sea on the south and east (beach, rocky shore, docks, a few islands reachable by water-walking, waterfall).
   Fan version: **no official logos/emblems** (headband plates blank, no leaf symbol anywhere).
2. Contract fields, exactly as in `types.ts`:
   - `squares`: `'coop-hq'` (kind coop, 10 m, on the HQ plaza), `'pvp-hq'` (kind pvp, next to the co-op square on the plaza),
     `'pvp-gate'` (kind pvp, just inside the main gate). Flat ground under each square, `board` 1–2 m beside it, `returnPoint` near it.
   - `arenas` (4): `training` "Terrain d'entraînement", `clearing` "Clairière", `lake` "Lac" (on the water), `rooftops` "Toits";
     radius 22–30 m, ≥ 3 red and ≥ 3 blue spawns on opposite sides, all on walkable surfaces.
   - `points` (feet positions on walkable ground, used by missions — **use exactly these names**): `village.market`,
     `village.training`, `village.river`, `village.rooftops`, `village.gate`, `forest.path`, `forest.clearing`, `forest.ravine`,
     `forest.deep`, `shore.docks`, `shore.beach`, `island.north`, `island.east`, `gate.main` (outside the main gate).
   - `spawns`: ≥ 6 player spawns on the HQ plaza. `labels`: French place names for the full map.
   - `zones`: minimap raster (≈ 1–2 m/px) with the `ZONE` codes; `heightfield` covering the playable area.
   - `colliders`: buildings as boxes, trees as capsules/cylinders (trunks climbable, branch platforms as boxes), rocks as
     trimesh, wall/cliff climbable, water surfaces flagged `water: true`, invisible boundary walls at `boundary`.
3. `src/sim/world/colliders.ts`: `buildWorldColliders(physics, data)` (terrain as a Rapier heightfield collider, climbable, plus
   every `ColliderDef`) and `colliderHash(data): string` (stable hash of the collider list + heightfield). Unit test: two
   `generateWorld(seed)` calls → equal hashes; different seeds → different; all `points`/spawns/squares are above ground and
   not inside a collider (raycast down hits ground within 1 m).
4. `src/world/WorldView.ts`: `buildWorldView(scene, data): { update(focus: Vector3, frameDt: number): void; dispose(): void }` —
   meshes only (the client calls `buildWorldColliders` separately). Keep the v3/v4 look (toon materials, ink outline via PostFX,
   sky, fog, toon water with shoreline foam, sun shadow following `focus`). Terrain and buildings in 64 m **chunks** with
   frustum culling and 2–3 LODs; instanced buildings from a few procedural house kits with colour variety; trees as instanced
   LODs, far trees as cards/impostors; fog hides LOD switches; several tree species / per-instance colour; light shafts or fog
   depth in the forest. Budget with 6 players + 40 enemies: ≤ 800 draw calls, ~≤ 1 M triangles, 60 FPS on an M-series Mac.
   Draw the start squares as part of the world: co-op = glowing blue outline on the ground; PvP = red half + blue half floor
   with banners; a mission/arena board at each `board` (blank, no text needed — the UI shows the choice). Free every GPU
   resource in `dispose()`.
5. `src/config/world.ts`: all layout/scatter numbers with one-line comments, incl. `ambientEnemies: false` and the default seed.

## Verify
`npx tsc --noEmit`, `npx eslint src/world src/sim/world src/config/world.ts`, `npx vitest run tests/unit/world*`. If you build the
viewer, take screenshots with Playwright of the HQ plaza with the squares, the forest and the lake, report draw calls / triangles
(`renderer.info`) and FPS. Final report per the shared rules (≤ 300 words), including any contract change request.
