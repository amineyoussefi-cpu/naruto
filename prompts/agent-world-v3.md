# Agent: world v3 — 3× bigger natural map with mountains and water

User request (FR): « agrandis la map par le triple, ne fais pas des cubes et cylindres, fais des montagnes ; pour les couleurs
n'essaie pas de garder une seule couleur (ex. le vert : un mélange de variétés de verts) ; ajoute une partie avec de l'eau ».

**You own:** `src/world/*` (rewrite freely: Arena.ts, Sky.ts, Village.ts, Batcher.ts, new files), `tests/unit/visuals.test.ts`
(only the arena-related tests; keep the NinjaModel/Effects tests passing untouched).
Read first: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, the current `src/world/*`, `src/physics/PhysicsWorld.ts`
(NEW: `addStaticMesh(geometry, matrix?, {climbable, water})`, `water` set, `isWater`), `src/render/toon.ts`, `src/render/PostFX.ts`,
`src/game/Game.ts` (how ArenaInfo is used), `src/config/movement.ts` (killPlaneY −20, climb rules: climbable flag + |normal.y| ≤ 0.5).

## Contract (keep)
`buildArena(scene, physics): ArenaInfo` with `playerSpawn`, `enemySpawns`, NEW optional `update(focus, frameDt)` (called every
render frame by Game with the player position — use it to make the single shadow-casting sun + its shadow camera follow the
player, since one fixed shadow frustum cannot cover a 3× map), `dispose()` frees everything (meshes, materials, colliders).

## Deliver
1. **Size ×3**: playable valley ≈ 210 × 210 m (was ~70). Player spawn near the centre on flat-ish ground.
   **≥ 30 enemy spawn points** spread over walkable ground (not on water, not inside rocks, not on steep slopes — verify with raycasts
   in a unit test). Invisible boundary colliders (plain boxes are fine since they are NOT rendered) so the player cannot leave the
   world by climbing the outer mountains; the kill plane stays at y −20 (keep at least one place you can fall: e.g. a gorge/waterfall
   drop) so respawn still matters.
2. **No visible cubes/cylinders for nature**: a procedural **terrain** (noise-based heightfield → BufferGeometry, ~2 m grid, collider via
   `addStaticMesh`, `climbable: true` so its steep faces can be wall-walked) with rolling hills, a ring of real **mountains** around the
   valley (big sculpted peaks, steep cliff faces, snow/pale rock caps on the highest), **rock formations** inside the valley replacing
   the old pillars/training wall/terraces/crates (displaced icosahedra / extruded noisy shapes; climbable trimesh colliders; varied
   heights 4–20 m, some with flat-ish tops reachable by wall-walking). Man-made props (village buildings, torii, bridge, lanterns,
   training dummies) may stay geometric.
3. **Colour variety**: vertex colours on terrain blending several greens (yellow-green, emerald, olive, deep forest), dirt paths,
   sandy shores, rock greys/browns by slope; rocks with per-instance/per-vertex tint variation; trees in several species and shades
   (per-instance colour on InstancedMesh), flowers/bushes patches. Keep the toon look (toon material with vertexColors, rim small).
4. **Water**: a large **lake** (≈ 40–60 m) plus a **river** with a bridge and a waterfall from the mountains is ideal. Stylised animated
   toon water (vertex waves or scrolling normal-free bands, fresnel tint, white foam bands near shores using a shoreline distance
   baked into a vertex attribute or computed from terrain height), slightly transparent with a visible lake bed. **Ninjas walk on
   water** (chakra): create a flat invisible water collider at the water surface via `addStaticMesh(..., { water: true })` or
   `addStaticBox(..., { water: true })`. The integration lead handles foot chakra + ripples on water.
5. Keep the hidden-village vibe (move the village onto mountain slopes / a plateau at one side of the valley), the sky, clouds,
   lantern strings. Fog/aerial perspective tuned for the bigger scale.
6. Performance: still ≤ 600 draw calls and ~≤ 600k triangles per frame; instance everything repeated; terrain in a few chunks max.
   Measure with `window.__game.renderer.info` and 60 FPS check via the screenshot script.
Screenshot several views (spawn, lake, mountains, a rock you can climb, the village) and iterate. A dev server may already be on
port 5199; start one in the background only if nothing listens (`npx vite --port 5199 --strictPort`), never stop it.
