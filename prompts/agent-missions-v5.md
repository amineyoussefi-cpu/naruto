# Agent: missions v5 (co-op missions, down & revive, PvP matches)

**You own:** `src/sim/missions/*` **except** `types.ts`, `src/config/missions.ts` and `src/config/pvp.ts` (new),
`tests/unit/missions*.test.ts`, `tests/unit/pvp*.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/40-update-v5-online.md` (Phases 3–4 and "Rules for every phase"), the contracts
`src/sim/missions/types.ts`, `src/sim/context.ts`, `src/sim/protocol.ts`, `src/sim/world/types.ts`, and `src/sim/Actor.ts`,
`src/sim/combat/Fighter.ts`, `src/sim/physics/PhysicsWorld.ts` (`teleport`), `src/core/events.ts`, `src/config/minimap.ts`.
The lead is refactoring the rest of `src/sim/` in parallel: code only against the contracts above; if you need something
from another module, write it against an interface/callback and report it.

## Deliver
1. `src/sim/missions/ModeDirector.ts`: `export class ModeDirector` with
   `constructor(ctx: SimContext)`, `update(dt: number): void` (called once per step after combat), `state(): ModeState`,
   `markers(forPlayer: PlayerId): Marker[]`, `onPlayerJoin(p: PlayerState): void`, `onPlayerLeave(p: PlayerState): void`,
   `reset(): void`. It reads squares/arenas/points from `ctx.world` (may be null in unit tests → no squares, nothing starts),
   players from `ctx.players` (`p.actor.position`, `p.pressed.has('interact')` to cycle the board, `hasBit(p.input.held,
   'interact')` to revive), and spawns with `ctx.spawnEnemy` / `ctx.removeActor`.
2. **Pure state machines** (no ctx) for the testable rules, e.g. `coopFlow.ts`, `pvpFlow.ts`, `squares.ts` (point-in-rotated-
   square, red/blue half), phases idle → countdown → running → results → idle. Tests (Vitest, Node) for everything listed in
   the brief: start only when **all connected** players are inside the square (solo = 1 player), 5 s countdown, cancel on leave,
   board cycling with interact (one shared choice), team validation (both teams ≥ 1, max 3, side switching before the
   countdown), round end by elimination and by 120 s timer with total HP %, best of 3, 3 s pre-round countdown, scaling per player
   count, revive timing (hold 3 s near a downed teammate → 40 % HP), 30 s bleed-out, all downed → defeat, late joiner waits,
   disconnect during a mission/match (removed; match ends if a team becomes empty).
3. **Co-op**: `src/config/missions.ts` with ≥ 5 missions ("Intrus dans le village", "Embuscade en forêt", "Bandits sur les quais",
   "Île des déserteurs", "Défense de la porte") using the world point names (`village.market`, `village.training`,
   `village.river`, `village.rooftops`, `village.gate`, `forest.path`, `forest.clearing`, `forest.ravine`, `forest.deep`,
   `shore.docks`, `shore.beach`, `island.north`, `island.east`, `gate.main`); 2–5 groups each (kinds `melee`/`ranged`, counts,
   optional waves), optional time limit, `scalePerPlayer`, `aggroRadius`. Spawned enemies get `actor.groupId` and
   `actor.dormant = true` until a participant comes within `aggroRadius` of the group (then the whole group wakes:
   `dormant = false`). Group marker = centre of its living members, `fighting` when awake; removed when wiped.
   Downed: when a participant's actor dies during a running mission (`death` event, `kind === 'player'`) set
   `actor.downed = bleedTime`; tick it; revive by a teammate holding interact within `reviveRadius` for `reviveTime` →
   `fighter.hp = 40 % maxHp`, `downed = 0`, `setAnim('idle', true)`. Track kills (`damage` events with `killed`), revives, time.
   End → results 10 s → teleport everyone back to the square's `returnPoint` (spread out), `fighter.reset()`, remove leftovers.
   Use the existing `pickEnemyLook` only indirectly (spawning is `ctx.spawnEnemy`).
4. **PvP**: two squares (`pvp-hq`, `pvp-gate`); standing on the red/blue half = team; countdown when all connected players stand
   in the same PvP square with valid teams; board cycles the arena (`ctx.world.arenas`). Start: set `actor.team = 'red' | 'blue'`,
   teleport to the arena spawns, `fighter.reset()`, smaller team gets `+handicapPerMissingPlayer` HP each (`fighter.stats.maxHp`,
   restore after), keep players inside the dome radius (clamp/teleport back). Rounds, KO feed, damage dealt/KOs per player
   (`damage` events), results then everyone back to `team = 'player'` at the square's `returnPoint`, stats restored.
   Players are frozen during the 3 s pre-round countdown (`actor.control.allowMove = allowJump = false` each step and expose
   `frozen(actorId): boolean` so combat can skip them). `src/config/pvp.ts`: `damageScale 0.7`, `allowGrab true`, `grabTime`
   (shorter than co-op), `genjutsuScale 0.5`, `handicapPerMissingPlayer 0.25`, round time, rounds to win, countdowns.
5. Markers per recipient: squares always, groups (co-op), objective, downed teammates, teammates as `player` markers, PvP
   opponents only within `MINIMAP.pvpRevealRadius` (line of sight via `ctx.physics.raycast(..., { worldOnly: true })`).

Emit nothing new on the EventBus unless you add it to your report as a request (the UI reads `ModeState`).
Verify with `npx tsc --noEmit`, `npx eslint src/sim/missions src/config/missions.ts src/config/pvp.ts`, `npx vitest run tests/unit/missions* tests/unit/pvp*`.
Final report per the shared rules (≤ 300 words).
