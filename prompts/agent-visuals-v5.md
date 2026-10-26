# Agent: visuals v5 (barrier dome, team colours, name tags, downed pose)

**You own:** `src/render/*` (new `src/render/ModeVisuals.ts`), `tests/unit/visuals*.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `prompts/40-update-v5-online.md` (Phases 3–4),
`src/render/NinjaModel.ts`, `src/render/Effects.ts`, `src/game/ActorView.ts` (read-only: what the client knows per actor:
`team`, `name`, `kind`, `has(flag)`, `downed`, `model`), `src/sim/missions/types.ts`, `src/sim/world/types.ts` (`arenas`).

## Deliver
1. `ModeVisuals` with exactly: `constructor(scene: THREE.Scene)`, `update(frameDt: number, s: { mode: ModeState | null;
   world: WorldData | null; views: readonly ActorView[]; myActorId: number; camera: THREE.Camera }): void`, `dispose(): void`.
   The lead calls `update` every frame. It draws:
   - **Chakra barrier dome** over the PvP arena (`world.arenas` by `mode.pvp.arenaId`) while `mode.pvp.phase` is 'running' (and the
     3 s pre-round), translucent hex/fresnel toon look, fades in/out, cheap (one mesh).
   - **Name tags** above other players (sprite or canvas texture, ≤ 6, readable, hidden beyond ~40 m), coloured by team
     (co-op allies white/blue, PvP red/blue), not over the local player.
   - **Team colours**: a red/blue rim/outline tint on players' models in PvP (`view.team` 'red' | 'blue'), removed after.
   - **Downed** players: a ground ring with the revive progress (`mode.downed[].revive`).
2. `NinjaModel`: a distinct `'downed'` animation state (knocked out on the ground, slow crawl when speed > 0.2) — `AnimState`
   already includes `'downed'`.
3. Free every GPU resource in `dispose()`; unit tests in Node (dome visible only during a match, tags per player, team tint applied
   and removed, downed pose differs from idle/dead).

Verify: `npx tsc --noEmit`, `npx eslint src/render`, `npx vitest run tests/unit/visuals*`. Final report per the shared rules (≤ 300 words).
