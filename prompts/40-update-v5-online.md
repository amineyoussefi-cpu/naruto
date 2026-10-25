# Update v5 — shared brief (online co-op & PvP over Tailscale, big world, minimap, mission squares)

You are the **integration lead**. Read `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `prompts/30-update-v4.md`,
`design.txt`, `README.md`, `ASSETS.md` and the whole of `src/` before planning. This update turns Shinobi Arena from a local
single-player game into a **host-authoritative online game for up to 6 players** on a private Tailscale network, in a much bigger
world, with a **minimap**, **co-op missions** and **PvP matches** started from squares in the village.

User request (summary): "Make the world multiplayer over Tailscale, 6 players max on the field. A big world: the Konoha village,
a big forest outside the village, then a big lake or sea after the forest, with a minimap at the top right. Co-op against enemies,
inside or outside the village, with the enemy groups marked on the minimap; missions start when all players stand in a square next
to the Konoha HQ. PvP 3v3, 2v2 or 1v1 (uneven like 2v1 allowed, players can change sides); matches start when all players stand in
a square next to the HQ or the gate."

Fan project, local and non-commercial: recognizable fan versions of the places are fine, but **no official logos or emblem textures**
(the headband plates stay blank, no leaf symbol on buildings). Keep Naruto using the Blender hero (`CHARACTER_LOOKS.naruto.model = 'hero'`,
`public/models/hero.glb`): every player who picks Naruto gets that model.

Do the work in the **phases** below, in order. Each phase ends with green `tsc`, `eslint`, `vitest` and its e2e check, and a commit.
Write one brief per agent (`prompts/agent-<area>-v5.md`, same format as the v4 briefs) after you have written the contracts of
phase 0. Update `01-shared-rules.md` (the game is no longer single-player; the server and shared-sim rules below).

---

## Phase 0 — split simulation from rendering (integration lead, before any agent starts)

The server must run the exact same gameplay code as the browser, in Node, with no DOM and no WebGL.

1. Move everything that decides game state into `src/sim/` (pure, Node-safe): actors, movement, physics (Rapier compat runs in Node),
   combat, AI, waves/missions, world **collision** generation. `src/game/Game.ts` becomes the **client**: renderer, camera, model sync,
   UI, input capture, networking. No `three` renderer, `document` or `window` imports anywhere under `src/sim/` (add a unit test that
   imports every `src/sim/**` module in Node).
2. The world is generated from a **seed** by pure functions that return data (heightfield, zone map, building footprints, tree and rock
   placements, water areas, collider list). The server builds only colliders from that data; the client builds meshes and colliders
   from the same data. Same seed → identical colliders on both sides (unit test: hash of collider list equal across two builds).
3. One player = one `PlayerInput` per sim step: `{ seq, moveX, moveZ, camYaw, camPitch, held: bitmask, pressed: bitmask, aimDir? }`.
   All gameplay reads input only through this struct (no direct keyboard access in sim code). Local input is converted to it on the
   client.
4. `GameContext` holds **N players** (`ctx.players: Map<PlayerId, PlayerState>`), not one. `PlayerState` = actor + character +
   team + mode status + per-player combat state (charge, grab/QTE, chakra, cooldowns). Remove every "the player" singleton
   (`ctx.player`, `ctx.character`, `ctx.qte` move into `PlayerState`). Enemies target the nearest valid player.
5. **Solo still works offline**: the client can run the sim in-process (a `LocalHost` that implements the same interface as the
   network connection). Everything below must also work solo (a mission can be started alone; PvP needs ≥ 2 players).
6. Pause: no global pause online. Esc opens the local menu only; the sim keeps running for everyone. Solo keeps the real pause.

## Phase 1 — networking (agent `net`)

**Topology:** one machine is the **host** and runs `npm run host` (Node server). Everyone, host player included, plays in a browser
at `http://<host-tailscale-name>:5180`. The server serves the built client (`dist/`) **and** the WebSocket endpoint `/ws` on the same
port. Max **6** connected players; a 7th gets a "server full" screen.

**No new npm dependencies** (rule 7 stays): the WebSocket server is a small hand-written RFC 6455 implementation on `node:http` +
`node:crypto` (handshake, binary frames, ping/pong, close; ≈ 150 lines, unit-tested); browsers use the built-in `WebSocket`.
The server is bundled with the existing Vite: `vite build --ssr server/main.ts --outDir dist-server`. Scripts to add:
`"host": "vite build && vite build --ssr server/main.ts --outDir dist-server && node dist-server/main.js"`, and `host:dev` for
development (server + Vite dev server proxying `/ws`).

**Security:** by default the server binds to **localhost and the Tailscale interface only** (100.64.0.0/10 address found with
`os.networkInterfaces()`), never `0.0.0.0`, so it is not exposed on a café or school Wi-Fi. A `--lan` flag allows the local network.
On start it prints the URLs to share (MagicDNS name if `tailscale status --json` is available, else the 100.x IP).

**Netcode (host-authoritative):**
- Server sim at fixed 60 Hz. Clients send `PlayerInput` every sim step (batched 2 per packet is fine), with `seq`.
- Server sends **snapshots at 30 Hz**: all actors (position, velocity, yaw, anim, animTime, hp, chakra, status flags), projectiles,
  mission/match state, minimap markers. **Binary** (`DataView`, quantized: position mm in int32 or 1/64 m in int16 relative to chunk,
  angles in uint16, versioned header). Delta against the last acked snapshot when it is simple; full snapshot every 1 s.
- **Own player: client-side prediction** of movement (run, sprint, jump, climb, dash, water-walk) with reconciliation: on each snapshot,
  rewind to the server state for the last acked `seq` and replay pending inputs; smooth small corrections over ~100 ms, snap large ones.
- **Other actors: interpolation** with a ~100 ms buffer (configurable). Animations come from the snapshot anim state + animTime.
- **Hits are decided by the server only** (combat runs only there). The client may play instant local feedback for its own attack
  start (swing anim, whoosh), never damage. Lag compensation for kunai/attacks against players: rewind target positions by the
  attacker's measured latency, capped at 150 ms (config).
- Events (`hit`, `technique`, `grabStart`, …) are sent in the snapshot stream so every client plays the same FX and sounds.
- Join mid-session, leave, reconnect (same name within 30 s gets its player back), host-side kick from the host's menu.
- Lobby screen on connect: player name (saved in localStorage), character pick (Naruto/Ren, Sasuke, Kakashi; duplicates allowed),
  connected players list with ping. New players spawn at the village spawn.

**Grab / QTE online:** the six-arrow sequence is shown only to the grabbing player; arrow inputs travel as `PlayerInput` and the
server validates them. Against a player in PvP the victim cannot act but sees a "grabbed" banner (config `pvp.allowGrab`, default true,
`pvp.grabTime` shorter than co-op).
**Sharingan on players (PvP):** disoriented players get their movement input rotated by a random angle that changes every 0.7 s and
cannot lock on; duration × `pvp.genjutsuScale` (default 0.5).

**Tailscale docs** (`README.md`, French + English like the rest): host installs Tailscale, invites friends to the tailnet (the free
Personal plan allows up to 6 users, enough for 6 players), friends install Tailscale and accept; check with `tailscale ping <host>`
that the link is direct (relayed = more lag); macOS firewall prompt on first `npm run host`; optional HTTPS with `tailscale serve` if a
browser feature needs a secure context.

**Tests:** serialization round-trip, quantization error bounds, prediction + reconciliation (replaying inputs converges to the server
state), interpolation buffer, WebSocket framing (masking, fragmentation, close). **e2e:** start the server, open 3 headless pages,
all join, they see each other move, one hits an enemy and the others see the HP change.

## Phase 2 — big world + minimap (agents `world` and `ui`)

**Layout** (seeded, ≈ 900 m × 900 m playable, the sea beyond is visual only past an invisible boundary):
1. **The village (Konoha, fan version)**, ≈ 260 m across, in the centre, on gentle terraces against a cliff on its north side:
   ring wall with a big **main gate** (south) and two small gates; a central **HQ** (large round building with a red roof and a plaza
   in front); dense districts of houses with tiled roofs, shops with awnings, lantern strings, streets and alleys, a market street,
   training grounds with wooden posts, a river crossing with bridges, rooftops you can run and jump across (ninja rooftop routes),
   walls climbable by wall-walking. Instanced buildings from a few procedural house kits with colour variety.
2. **The big forest** outside the walls, ≈ 250 m deep all around: giant trees (some 30–40 m, trunks climbable, wide branches you can
   stand on), undergrowth, clearings, dirt paths from each gate, rocks, streams, a ravine with a bridge. Several tree species and shades
   (per-instance colour), light shafts / fog for depth.
3. **The lake / sea** beyond the forest on the south and east: beach and rocky shore, wooden docks, a few small islands you reach by
   **water-walking**, a waterfall where the river leaves the forest. Same stylised toon water as v3, bigger, with shoreline foam.
4. Kill plane and falls still exist (ravine, cliffs). Invisible outer boundary.

**Performance budget** (6 players + up to 40 enemies on screen): ≤ 60 FPS on the host Mac, ≤ 800 draw calls, ~≤ 1 M triangles per
frame. Terrain and buildings in **chunks** (64 m) with frustum culling and 2–3 LOD levels; trees as instanced LODs (far trees as
cards/impostors); shadow sun follows the local player (keep `update(focus, frameDt)`); fog hides the far LOD switch. Server side:
colliders only, trees as simple capsules, buildings as boxes/convex hulls, terrain as heightfield collider.

**Minimap** (top-right, French labels, like the rest of the HUD):
- Round, ≈ 200 px, player-centred, **rotates with the camera** (a setting switches to north-up). `M` opens a **full-screen map**
  (whole world, north-up, zoom with the wheel, closes with `M`/Esc; doesn't pause online).
- Background baked **once** at load from the world data (zones: village streets/buildings, forest, water, beach, cliffs) into a canvas
  texture; no per-frame 3D render.
- Markers: you (arrow), teammates (coloured arrows + names), **enemy groups** during co-op (red skull icon + enemy count, position =
  group centre, pulses when fighting), mission **start squares** (blue = co-op, red/blue split = PvP) always shown, current objective
  (yellow), downed teammates (cross). PvP opponents only when within `minimap.pvpRevealRadius` (default 35 m) or in line of sight.
- Markers come from the server (snapshot `markers` list), so everyone sees the same thing.

## Phase 3 — co-op missions (agents `missions` and `ai`)

**Start square:** a **10 × 10 m** marked square on the plaza in front of the HQ (glowing blue outline on the ground, a mission board
next to it). Free roam has no enemies (config `world.ambientEnemies`, default off). When **all connected players** stand inside the
square → a **5 s countdown** shown to everyone ("Mission dans 5…"); anyone leaving cancels it. Solo works (1 player = all players).
Before the countdown, the board shows the mission that will start (players cycle it with an interact key `F` while inside the square;
the server keeps one choice for everyone).

**Missions** (data-driven list in `src/config/missions.ts`, at least 5 at launch, e.g. "Intrus dans le village", "Embuscade en forêt",
"Bandits sur les quais", "Île des déserteurs", "Défense de la porte"): each defines 2–5 **enemy groups** placed at named points
inside the village, in the forest or on the shore/islands, the enemy kinds per group (reuse the existing melee/ranged kinds and
`pickEnemyLook`), optional waves per group, and an optional time limit. The objective is defeating every group; groups appear on
the minimap when the mission starts, and the marker disappears when the group is wiped. Enemy count and HP scale with the number of
players (`missions.scalePerPlayer` in config). Groups stay idle until a player comes within `aggroRadius`, then fight as a group (AI
agent: shared target selection across the group, flanking for ranged).

**Down & revive:** at 0 HP a player is **downed** (crawl slowly, can't attack) for 30 s; a teammate holding `F` near them for 3 s
revives them at 40 % HP. Bleed-out → spectate a teammate until the mission ends. All players downed → defeat.
**End:** victory or defeat screen for everyone (time, kills per player, revives), 10 s later everyone is back in free roam at the
HQ plaza, full HP/chakra. Players who join during a mission wait in the village (they see the markers) and join the next one.

## Phase 4 — PvP matches (agents `missions`, `combat`, `ui`)

**Start squares:** two **PvP squares**, one on the HQ plaza next to the co-op square, one just inside the main gate. Each square is
split into a **red half** and a **blue half** (coloured floor, banners). Standing on a half = joining that team; walking to the other
half **changes sides** at any time before the countdown. When **all connected players** stand in the same PvP square, **both teams
have at least 1 player**, and no team has more than 3 → **5 s countdown**. Any 1v1, 2v1, 2v2, 3v2, 3v3 etc. is valid (≤ 6 players).
Uneven teams: the smaller team gets an HP/damage bonus (`pvp.handicapPerMissingPlayer`, default +25 % HP each, documented).

**Arena:** the board next to each square chooses the battleground (cycle with `F`): "Terrain d'entraînement" (village training
ground), "Clairière" (forest clearing), "Lac" (on the water), "Toits" (village rooftops). At start, both teams are teleported to their
spawn side of that arena, which is closed by a visible chakra barrier dome for the match. No AI enemies in PvP.

**Rules:** best of 3 rounds; a round ends when one team has no player standing, or after 120 s (then the team with the higher
total HP % wins the round). No respawn inside a round; full HP/chakra between rounds; 3 s countdown before each round. Friendly fire
off. Every technique works on players with `pvp.damageScale` (default 0.7) so fights last longer. Combat targeting: hitboxes,
lock-on, aim assist, Chidori sweep and Sharingan radius consider **players of the other team** (and enemies in co-op only).
**HUD:** team scores at the top centre, round timer, team members' HP bars, kill feed. **End:** results screen (round wins, damage
dealt, KOs), then everyone returns to free roam at the square they started from.

## Rules for every phase
- All new gameplay numbers in `src/config/` with one-line comments: `net.ts`, `world.ts`, `minimap.ts`, `missions.ts`, `pvp.ts`.
- Sim code: fixed `dt`, no wall-clock, pure where possible (unit tests in Node). Missions/PvP state machines are pure modules
  (states: idle → countdown → running → results → idle) with tests: start only when all players are inside the square, cancel on
  leave, team validation (both teams non-empty, max 3, side switching), round end by elimination and by timer with HP %, scaling
  per player count, revive timing, late joiner handling, disconnect during a mission/match (removed from team; match ends if a team
  becomes empty).
- Keep everything from v4 working (charged Rasengan, Chidori, Sharingan, grab QTE, wall climbing, water-walking, dynamic camera,
  Blender hero) in solo **and** online.
- UI text in French, consistent with the existing HUD.
- e2e (Playwright, several pages against `npm run host`): join 2–4 players; all enter the co-op square → countdown → enemy group
  markers on the minimap; 2 players on opposite halves of a PvP square → match starts, one KO ends the round; changing sides before
  the countdown works; a 7th connection gets "server full".
- Screenshots for the user at the end: the village with the HQ plaza and squares, the forest, the lake, the minimap during a co-op
  mission, a 2v2 match HUD.

## Suggested agents (you write their briefs; adjust if needed)
| Agent | Owns |
|-------|------|
| `net` | `server/*`, `src/net/*`, `src/config/net.ts`, net tests |
| `world` | `src/world/*`, `src/config/world.ts`, world tests (data + meshes + colliders from the seed) |
| `missions` | `src/sim/missions/*` (co-op + PvP state machines, squares, teams, rounds), `src/config/{missions,pvp}.ts`, tests |
| `ai` | `src/ai/*` (group behaviour, multi-player targeting) |
| `combat` | `src/combat/*` (multi-player, teams, PvP scaling, lag-compensated hits) |
| `ui` | `src/ui/*` (lobby, minimap + full map, countdowns, PvP HUD, results, downed/revive prompts), `src/config/minimap.ts` |
| `visuals` | `src/render/*` (square markings, barrier dome, team colours/outlines on players, name tags) |
Integration lead keeps `src/core/*`, `src/game/*`, `src/sim/` skeleton and contracts, `package.json`, docs, e2e.

Final report to the user (under 300 words): what works, how to host and join over Tailscale step by step, known limitations
(e.g. expected feel with relayed connections), and the screenshots.
