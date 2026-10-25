# Agent: enemy AI + waves

**You own:** `src/ai/*` (`EnemyAI.ts`, `WaveManager.ts`, new files), `src/config/enemies.ts`, `src/config/waves.ts`,
tests `tests/unit/ai*.test.ts`, `tests/unit/waves*.test.ts`.

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts`, `src/game/Actor.ts`, `src/game/context.ts`, `src/core/events.ts`,
`src/combat/CombatSystem.ts` (API: `spawnHitbox`, `spawnProjectile`), `src/combat/Fighter.ts` (API), `src/physics/locomotion.ts`
(`stepCharacter` — use it to move enemies, it handles gravity, knockback and collisions), `src/physics/PhysicsWorld.ts` (raycast).
The combat agent is implementing CombatSystem in parallel: rely only on the stub's signatures.

## Deliver
- Explicit state machine per enemy: `idle → detect → chase → attack(telegraph → active) → recover`, plus `hurt` (while
  `fighter.stunned`) and `dead`. Ranged also `reposition`.
- **Melee ninja**: approaches, telegraphs (`model.setTelegraph(true)`, anim `telegraph`, emit `telegraph`), then a hitbox via
  `ctx.combat.spawnHitbox` (kind `'enemyMelee'`, damage × `ctx.modifiers(actor).dmgMul`), recovery; sometimes backs off or side-steps
  (dodge chance after being hit / when the player attacks — `attackStart` events from the player).
- **Ranged ninja**: keeps `preferredRange`, retreats under `minRange`, strafes, telegraphs, throws via `ctx.combat.spawnProjectile`
  (visual `'shuriken'`, kind `'enemyRanged'`) aimed at the player chest with mild lead.
- **Director / attack tokens**: at most `ENEMIES.maxSimultaneousAttackers` enemies in telegraph/active at once; others circle at
  a distance (orbit/strafe) so the player can react. Stagger attack starts.
- Obstacles: movement goes through `stepCharacter` (collision). Add simple steering: if a world raycast toward the desired
  direction hits within ~1.5 m, try ±45°/±90° alternatives. Separation from other enemies.
- Respect ranges & cooldowns; facing smoothing; animations `idle/run/telegraph/attack1/throw/hit/dead` (only set anims when not
  hurt/dead — combat sets `hit`/`dead`). Dead enemies do nothing (Game removes corpses after `ENEMIES.corpseTime`).
- Enemies stop attacking when the player is dead.
- `isTelegraphing(actor)` and `stateOf(actor)`.
- **WaveManager**: `start()` begins wave 1 after a short delay; spawns `WAVES[i]` melee/ranged counts with `hpMul/dmgMul` via
  `ctx.spawnEnemy`, at `ctx.spawns.enemies` far from the player (stagger spawns slightly), registers them with `EnemyAI`.
  Emits `waveStart`, `enemiesRemaining` (when count changes), `waveCleared`, then after `WAVE_INTERMISSION` the next wave;
  after the last wave `victory`. `intermission` getter counts down. `reset()` returns to a clean pre-start state.
- Inject an RNG (`() => number`, default Math.random) for testability.

Tests: state transitions (melee: chase→attack→recover in range; ranged keeps distance), token cap, wave progression to
victory with a fake ctx (plain objects, no WebGL/Rapier).
