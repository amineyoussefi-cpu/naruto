# Agent: combat — Storm 3 fighting

**You own:** `src/combat/*`, `src/config/combat.ts`, `src/config/chakra.ts`, `tests/unit/fighter*.test.ts`, `tests/unit/combat*.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/20-storm-feel.md`, all of `src/combat/*`, `src/config/combat.ts`, `src/game/Actor.ts`,
`src/game/context.ts`, `src/core/{types,events,input}.ts`, `src/physics/{locomotion,PhysicsWorld}.ts` (API only),
`src/camera/CameraRig.ts` (`lockTarget`, `yaw`). Keep existing public APIs (add params only as optional).

Deliver:
1. **5-hit mash combo** (`combo1..5`, anims `attack1..5`). Fast: windups ~0.05–0.09 s, actives ~0.08–0.1 s, short recoveries,
   generous input buffer so mashing chains reliably. **Hit stun on enemies must exceed the gap to the next hit** so the chain
   connects (ENEMIES.hitStun is AI-owned: pass a per-hit `stun` override through dealDamage/hitbox instead).
   **Homing**: each hit picks the lock target, else the nearest living enemy within `homingRange` (~7 m) inside a ~110° cone
   in front of the camera/player; during windup the player is pulled toward it (forcedVelocity up to ~20 m/s) stopping at
   ~1.2 m, facing it. Hits 1–4 small knockback; **hit 5 = launcher**: big knockback + vertical launch (~9 m/s), long stun
   (until it lands + ~0.4 s), `kind: 'combo5'` heavy (hit-stop ~0.12 s, strong shake).
2. **Launch support** in `CombatSystem`: optional `launch` and `stun` on `HitboxSpec` and as optional trailing params of
   `dealDamage` (keep the 6-param call working). Launch sets `target.velocity.y`, clears grounded, anim `launched`
   (keep `launched` while the target is airborne and stunned; switch to `hit` on landing — do this in `CombatSystem.update`
   for every actor). Guarded hits never launch.
3. **Chakra dash** (`ctx.pressed.has('sprint')` edge = Shift tap): costs `chakraDash.cost` (~8) chakra (`chakraFail` with action
   `'dash'` if short). With a target within `chakraDash.range` (~25 m, lock target or best enemy in front): homing rush at
   ~26 m/s straight at it, ending ~1.6 m away (max duration so it can't run forever), anim `dash`, brief invulnerability to
   projectiles is NOT needed. Without a target: forward burst 0.3 s. Emit `chakraDash`. Attack pressed during/just after a dash
   starts the combo immediately (dash-cancel). Cooldown ~0.35 s. Works in the air (air dash, no gravity during it is fine:
   keep `velocity.y` at 0 while dashing).
4. **Substitution jutsu**: `dodge` pressed while the player is stunned/launched and `fighter.substitution >= cost`:
   spend cost, teleport (`ctx.physics.teleport` + position/prevPosition) to `distanceBehind` m behind the last attacker
   (track who last damaged the player), facing it, clear stun & launch, invulnerable `substitution.invulnerable`, anim
   `substitution` briefly, emit `substitution { from, to }`. If the spot behind is blocked (world raycast), try left/right/front.
   Gauge regenerates `regenPerSecond` in `Fighter.tick` (alive only). Not usable when not stunned (then C = dodge as before).
5. Faster player kit overall: kunai windup shorter; dodge speed ~20; special dash speed ~24. Keep Rasengan cost/cooldown.
6. Update tests: 5-hit chain with mash, homing pulls toward target and stops at range, single hit per target per swing,
   launcher sets upward velocity and `launched`, chakra dash cost + stop distance + no-target burst, substitution spends
   gauge / teleports behind attacker / clears stun / refuses when gauge low or not stunned, gauge regen.
