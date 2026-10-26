# Agent: ui v5 (lobby, minimap, full map, mission/PvP HUD, results, downed prompts)

**You own:** `src/ui/*`, `src/config/minimap.ts` (keep `pvpRevealRadius`), `tests/unit/ui*.test.ts`, `tests/unit/minimap*.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/40-update-v5-online.md` (Phase 1 lobby, Phase 2 minimap, Phases 3–4 HUD), all of
`src/ui/*`, `src/game/Game.ts` (the `GameApi` interface and the public getters listed below), `src/sim/missions/types.ts`
(`ModeState`, `Marker`), `src/sim/protocol.ts` (`PlayerSummary`), `src/sim/world/types.ts` (`WorldData.zones`, `ZONE`, `labels`,
`squares`), `src/config/missions.ts`, `src/config/pvp.ts`, `src/core/types.ts` (`HudData`).

## Client API you use (`Game`, already implemented — request additions in your report, don't edit Game)
`state` ('menu' | 'playing' | 'paused'; 'victory'/'defeat' are no longer used: mission/match results come from `modeState()`),
`start()` (solo: free roam at the village), `pause()/resume()`, `quitToMenu()` (online: leaves the server), `online`,
`joinOnline(name, url?)` (rejects with a French message), `leaveOnline()`, `modeState(): ModeState | null`, `markers(): Marker[]`,
`players(): PlayerSummary[]`, `myPlayerId`, `isHost`, `kick(playerId)`, `world: WorldData | null`, `me(): ActorView | null`
(position, yaw), `getHudData()`, `events`, `settings`, `applySettings`, `selectCharacter`, `keyLabels` (`interact` = F).
Camera yaw for the rotating minimap: `game.debug().camera.yaw`.

## Deliver (French UI text, same look as the existing HUD)
1. **Menu**: "Solo" (character pick → `start()`) and "Multijoueur" (lobby). **Lobby**: name (saved in localStorage), character
   pick (Naruto/Ren, Sasuke, Kakashi; duplicates allowed), "Rejoindre" → `joinOnline(name)` (works when the page is served by
   `npm run host`; show the error otherwise), then the in-game players list with ping (Tab-free: a small panel in the pause menu)
   and, for the host (`isHost`), a "Exclure" button per player. Esc online opens the menu without pausing (say so: "La partie
   continue"). A 7th player sees "Serveur plein".
2. **Minimap** top-right: round ≈200 px, player-centred, rotates with the camera (setting "Minimap orientée nord" → north-up), background
   baked **once** per world into a canvas from `world.zones` (colours per ZONE), markers from `markers()`: you (arrow), teammates
   (coloured arrows + names), enemy groups (red skull + count, pulse when `fighting`), squares (blue = co-op, red/blue = PvP),
   objective (yellow), downed (cross), opponents. **M** toggles a full-screen north-up map with wheel zoom, labels from
   `world.labels`, closes with M/Esc (no pause online; solo may pause). Pure helpers (world→minimap transform, rotation,
   clamping markers to the rim) with unit tests.
3. **Mode HUD** from `modeState()`: in a square (use `world.squares` + `me().position`): board text (mission title / arena name,
   "F : changer"), "Mission dans 5…", PvP team counts and `pvp.blocked`; co-op running: objective "Groupes restants x/y",
   time left; downed prompts ("À terre — un allié peut vous relever (F)" with bleed-out timer; near a downed ally: "Maintenir F
   pour relever" + progress from `mode.downed`); co-op results screen (victoire/défaite, time, kills, revives per player, return
   countdown). PvP: team scores top centre, round timer, pre-round countdown, teammates' HP bars, kill feed; results (round wins,
   damage, KOs). Remove the v4 wave HUD and victory/defeat screens (or reuse their styling for the results).
4. Keep the v4 HUD (HP/chakra, cooldowns, charge meter, grab arrows, lock bar, enemy bars) working.

Verify: `npx tsc --noEmit`, `npx eslint src/ui`, `npx vitest run tests/unit/ui* tests/unit/minimap* tests/unit/qte-ui* tests/unit/settings*`.
Final report per the shared rules (≤ 300 words), with the DOM ids e2e tests can use (menu buttons, lobby fields, minimap,
mode banners, results).
