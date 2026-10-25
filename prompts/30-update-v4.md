# Update v4 — shared brief (characters, charged techniques, grab sequence, assists)

User request (verbatim summary, FR/EN): Rasengan hold-to-charge without cooldown (20% power instant → 100% at 1.5 s,
configurable); left+right click grab → cinematic six-arrow clickable sequence; triple max chakra with adjusted regen;
fast automatic wall climbing; dynamic camera distance (sprint farther, combat closer); kunai aim assist with line of sight;
playable Sasuke (Sharingan genjutsu: enemies in radius disoriented) and Kakashi (charged Chidori piercing dash, each enemy
once, stops at walls). Preserve pause freezing (charging, projectiles, status effects, grab timers, cooldowns), restart, death.
Characters may now be recognizable fan versions (Naruto, Sasuke, Kakashi) — local, non-commercial project; still no
official logos/emblem textures copied from the anime.

## Contracts already in place (integration lead) — read them, don't change them
- `src/core/types.ts`: `CharacterId`, `ChargeTechnique`, `QteDir`, `QteState`; anim states `charge | chidori | sharingan | dazed |
  grabHold | strikeUp | strikeDown | strikeLeft | strikeRight | grabFinisher | grabbed`; attack kinds `chidori | grabStrike |
  grabFinisher`; `HudData.charge`, `HudData.qte`, `HudData.player.character`.
- `src/core/events.ts`: `technique.name` ∈ special|chidori|sharingan (+ `power`), `chargeStart`, `chargeRelease`, `genjutsu`,
  `grabStart`, `qteInput`, `grabEnd`.
- `src/core/input.ts` + `src/core/chord.ts`: synthetic action `'grab'` (left+right click within `INPUT.grabChordMs`; the clicks
  are swallowed). `isHeld('special')` for hold-to-charge.
- `src/game/context.ts`: `ctx.character`, `ctx.qte` (combat writes, null when none), `ctx.qteInputs` (UI clicks queued by Game,
  combat consumes each step). Game frees the cursor while `qte && !qte.done` and recaptures it when `done` becomes true.
- `src/game/Actor.ts`: `disoriented` (seconds, Game decrements in sim), `grabbedBy` (id or null), `model` swappable.
  `syncModel` calls `model.setDazed(disoriented > 0)`.
- `NinjaModel` stubs: `setHandOrb(on, charge = 1, style = 'rasengan')`, `setDazed(on)`, `setSharingan(on)`.
- `src/config/characters.ts` (`CHARACTERS[id].special` = rasengan | sharingan | chidori), `src/config/input.ts`,
  `COMBAT.chidori / sharingan / grab / aimAssist` skeletons in `src/config/combat.ts`.
- `PlayerCombat.charge` getter (HUD) — stub returning null.

## Integration lead does
Automatic fast climbing (movement), dynamic camera (camera), AI reaction to `disoriented` (interrupt + wander, cannot target)
and `grabbedBy` (AI fully suspended), docs/README/e2e.
