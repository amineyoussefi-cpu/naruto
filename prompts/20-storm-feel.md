# Storm 3 feel — shared brief

User request (FR→EN): "make the movements, dynamics and fighting styles just like in Naruto Storm 3, make them fast".
Target feel (Ultimate Ninja Storm 3): very fast ninja movement, **chakra dash** that rushes at the enemy, **mash combos
that home in** on the target and end with a **launcher** sending the enemy flying, **substitution jutsu** (log) to escape
a combo, double jump, snappy hit-stop and camera shake. Everything original (no Naruto names in code/UI except generic
"Rasengan" already present).

## Contracts already added by the integration lead (do not change, you may use)
- `AnimState` + `'attack4' | 'attack5' | 'dash' | 'launched' | 'substitution'`; `AttackKind` + `'combo4' | 'combo5'`.
- Events: `chakraDash { id, homing }`, `substitution { id, from, to }`, `jump { id, air? }` (air = double jump).
- `Fighter.substitution` (number, starts full) and `Fighter.maxSubstitution`; `COMBAT.substitution` config block.
- `HudData.player.substitution / maxSubstitution` (integration lead shows the gauge).
- Integration lead also does: faster locomotion + double jump (movement), faster/more aggressive enemies (AI), HUD gauge,
  audio for the new events.

## Controls (unchanged keys)
- Shift **tap** = chakra dash (homing if a target is available); Shift **hold** = ninja sprint (movement).
- Left click mash = 5-hit homing combo. C while being hit = substitution jutsu (C otherwise = dodge).
- Space in the air = double jump.
