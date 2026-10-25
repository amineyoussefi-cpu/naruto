# Agent: combat v4

**You own:** `src/combat/*` (new files welcome, e.g. `grab.ts`, `aimAssist.ts`), `src/config/combat.ts`, `src/config/chakra.ts`,
`tests/unit/fighter*.test.ts`, `tests/unit/combat*.test.ts`, new `tests/unit/grab*.test.ts`, `tests/unit/aim*.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/30-update-v4.md`, all `src/combat/*`, `src/config/{combat,chakra,characters,input}.ts`,
`src/core/{types,events,input}.ts`, `src/game/{Actor,context,Game}.ts`, `src/camera/CameraRig.ts` (camera object for projection),
`src/physics/PhysicsWorld.ts` (raycast worldOnly).

Deliver (keep existing behaviour that isn't replaced; keep public APIs, extend only):
1. **Rasengan (Naruto, `CHARACTERS[ctx.character].special`)**: no cooldown. Hold `special` → `charge` anim, `setHandOrb(true,
   level, 'rasengan')`, emit `chargeStart`; release (or reaching a configurable max hold) → pay chakra (on release; `chakraFail`
   if short → cancel), emit `chargeRelease` + `technique` with `power`, dash + hitbox with damage/knockback/radius scaled by power.
   power = lerp(minPower 0.2, 1, clamp(hold / fullChargeTime 1.5 s)) — configurable. Charging can move slowly or not (choose,
   document). Hit/stun/death cancels a charge (no cost). `charge` getter returns `{ technique, level }` (level 0..1 = progress).
   Single hit per target per release (hitbox ids).
2. **Chidori (Kakashi)**: same charge flow (`'chidori'` style/technique), release → **piercing dash** (anim `chidori`) along the
   facing / lock-target direction for `dashDistance` × (0.6 + 0.4·power) metres at `dashSpeed`; every enemy whose capsule the
   path sweeps is damaged **once** per activation (damage × power, small knockback sideways, stun), the player passes through
   enemies (they don't stop the dash; use forcedVelocity and per-step sweep tests); **stop at world obstacles**: world raycast
   ahead each step (worldOnly), end dash before penetrating. Emit `technique` name `chidori`.
3. **Sharingan (Sasuke)**: press `special` → cost + cooldown (`COMBAT.sharingan`), `sharingan` anim for `castTime`, `setSharingan(true)`
   during cast + effect duration, then set `disoriented = duration` on every living enemy within `radius`, cancel their
   hitboxes (attacks interrupted), emit `genjutsu` + `technique` (name `sharingan`). AI side (wandering/no targeting) is the lead's.
4. **Grab + six-arrow sequence** (`ctx.pressed.has('grab')`): target = nearest living, non-grabbed enemy within `grab.range` in a
   `coneDeg` front cone (lock target preferred). Success → set `target.grabbedBy = player.id`, hold it in front of the player each
   step (teleport/position + face), player invulnerable and controls locked (`allowMove/allowJump=false`, animLocked), write
   `ctx.qte` (random 6 arrows, index 0, timeLeft = `grab.time`, result 'active', done false), emit `grabStart`. Each step consume
   `ctx.qteInputs` (then clear it): correct → `strike<Dir>` anim, progressive damage (`dealDamage` with stun, tiny knockback, kind
   `grabStrike`), `qteInput` event; wrong → result 'miss', end; timeout → 'timeout'; all six → finisher anim `grabFinisher` + big
   damage bonus + launch (kind `grabFinisher`), result 'complete'. On end: `done = true`, `grabEnd` event, release the enemy
   (`grabbedBy = null`, short stun), after `grab.outro` s set `ctx.qte = null`. **Always** clean up on: target death/removal, player
   death, `reset()`, `CombatSystem.clear()` ('interrupted'). Victim anim `grabbed` while held. Timer uses sim dt (pause-safe).
   No grab when no valid target (whiff: short `grabHold` anim, no qte). Normal attack/guard never fire from the chord (input already
   swallows them). Pure sequence logic in its own module with tests (order, wrong input, timeout, completion bonus, cleanup).
5. **Chakra ×3**: `COMBAT.player.maxChakra` 300; passive regen and concentration rates scaled so refills take about the same time as
   before; keep costs sensible so a fight allows several techniques (e.g. Rasengan 45, Chidori 50, Sharingan 80, chakra dash 12).
   All values in config with comments.
6. **Kunai aim assist**: pure function (in `src/combat/aimAssist.ts`) choosing the enemy closest to the screen centre within
   `aimAssist.screenRadius` (fraction of screen height, after projecting chest with `ctx.camera.camera`), within `range`, in front of
   the camera (projected z < 1, and in front of the player), with **line of sight** (world raycast from player chest to enemy chest
   unobstructed). Throw toward its chest; otherwise toward the normal aim point (camera forward). Lock target still wins if valid.
   Unit tests with a fake camera/raycast: picks the closest-to-centre, rejects behind / outside radius / out of range / occluded.
7. Update tests for all of the above (charge-to-damage scaling incl. min power instant release and cap at full; no cooldown;
   Chidori hits each enemy once and stops at a wall; Sharingan sets disoriented within radius only; grab cleanup paths).
Read pause rules: everything uses the step `dt`, never wall-clock.
