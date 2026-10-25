# Agent: combat, damage, chakra, techniques

**You own:** `src/combat/*` (`Fighter.ts`, `CombatSystem.ts`, `PlayerCombat.ts`, new files), `src/config/combat.ts`,
`src/config/chakra.ts`, tests `tests/unit/fighter*.test.ts`, `tests/unit/combat*.test.ts`.

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts`, `src/game/Actor.ts`, `src/game/context.ts`, `src/core/events.ts`,
`src/core/input.ts`, `src/render/NinjaModel.ts` (API only), `src/render/meshes.ts` (API only), your stubs.

## Fighter (pure, fully tested)
health, chakra, cooldowns, guard, invulnerability, stun, **concentration**: when `concentrating` is true, after
`CHAKRA.concentrateStartup` regen at `concentrateRegenPerSecond`; otherwise passive regen `regenPerSecond` only after `regenDelay`
since last spend. A landed hit (not ignored) cancels concentration. Death at 0 HP; nothing changes after death.
Keep the stub's public API; add what you need.

## CombatSystem
- **Hitboxes**: sphere following its owner (`forwardOffset`, `heightOffset`), alive `duration`, test vs living actors of the
  other team (sphere vs capsule: horizontal distance ≤ r + actor.radius and vertical overlap). Each hitbox keeps a `Set` of
  actor ids already hit → **a hit never damages the same target twice**. Hitbox dies with its owner's stun/death (cancelled attack).
- **Projectiles**: mesh from `createProjectileMesh(visual)` added to `ctx.scene`, straight flight, stop on world geometry
  (`physics.raycast` segment per step, worldOnly) or max range, hit test vs other team; emit `projectileHit`. Dispose meshes.
- `dealDamage`: `fighter.applyHit`; if not ignored: emit `damage`; knockback on `target.knockback` away from the source;
  stun (`COMBAT.hitStun` for player / `ENEMIES.hitStun` for enemies — read from config), `target.setAnim('hit', true)`, `model.flash`;
  guard blocks show reduced knockback and no stun. Kill → `setAnim('dead', true)`, emit `death`. Hits involving the player emit
  `hitStop` and a measured `cameraShake` (bigger for combo finisher/special).
- `update(dt)`: tick all fighters, hitboxes, projectiles. `clear()`/`dispose()` remove everything.

## PlayerCombat (runs first each step; must call `actor.resetControl()` first)
- **3-hit combo** on `attack` presses with input buffering; combo resets after `comboResetTime`; each hit: windup → active hitbox
  → recovery, small forward lunge via `control.forcedVelocity`, anims `attack1/2/3`, emit `attackStart`. Auto-face lock target / nearest
  enemy within ~3 m.
- **Kunai** (`kunai`): cooldown, `throw` anim, projectile toward lock target chest or camera forward.
- **Special / Rasengan** (`special`): needs `COMBAT.special.chakraCost` and cooldown; else emit `chakraFail` (action `'special'`).
  Windup with `model.setHandOrb(true)` + `special` anim, then dash (forcedVelocity) with a large hitbox; emit `technique`.
- **Guard** (held `guard`, grounded): `fighter.guarding`, `control.moveFactor = COMBAT.guardMoveFactor`, `guard` anim, `model.setGuard`.
- **Dodge** (`dodge`): cooldown, short invulnerability, forcedVelocity in input direction (camera-relative) or backward, `dodge` anim, emit `dodge`.
- **Concentrate** (held `concentrate`, grounded): immobile (`allowMove=false`, `allowJump=false`), `fighter.concentrating`, `concentrate` anim,
  `model.setAura(true)`, emit `concentrateStart` once. Getting hit interrupts (must re-press/hold again).
- **Cooldowns** prevent spam (keys `'special' | 'kunai' | 'dodge'` are shown by the HUD). Stun cancels the current action.
- Climbing (`actor.climbing`) → no combat actions. Dead → everything locked, `dead` anim.
- Set `control.animLocked` whenever combat owns the animation.

Tests: chakra consume/regen delay/concentration rate & interruption; guard factor; invulnerability; death; cooldowns;
hitbox single-hit-per-target (use a fake ctx with plain objects — no WebGL needed); pause = no tick (Fighter only changes in tick).
