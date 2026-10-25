# Agent: visuals & audio v4 (characters, charge, lightning, genjutsu, grab)

**You own:** `src/render/NinjaModel.ts`, `src/render/looks.ts`, `src/render/Effects.ts`, `src/render/fx/*`, `src/render/meshes.ts`,
`src/audio/AudioSystem.ts`, `tests/unit/visuals.test.ts` (NinjaModel/Effects parts only — don't touch the arena tests), `ASSETS.md`.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `prompts/30-update-v4.md`, your files, `src/core/{types,events}.ts`,
`src/game/Actor.ts`, `src/config/{combat,characters}.ts` (timings/values: read them, the combat agent tunes them in parallel).

Deliver:
1. **Looks** (`CHARACTER_LOOKS` in looks.ts; extend `NinjaLook` as needed, keep the mesh budget test ≤ 45 meshes):
   - Naruto: orange jumpsuit with black shoulders/upper jacket, spiky blond hair, blue headband with plain plate, whisker marks allowed.
   - Sasuke: dark blue-black spiky hair swept back (duck-tail volume at the back, bangs framing face), white high-collar/open shirt,
     dark navy pants, purple rope belt; `setSharingan(on)` = glowing red irises (glowMaterial) with black pupil marks.
   - Kakashi: tall spiky silver hair leaning to one side, dark navy mask covering nose and mouth, headband tilted over the left eye,
     green flak vest over navy long sleeves and pants.
   Each must be recognizable at gameplay distance (silhouette + palette).
2. **Poses** (distinct, readable) for the new anim states: `charge` (crouched, hand held low/forward gripping the orb, slight shake
   increasing with time), `chidori` (Kakashi lunge-dash, lightning arm forward or trailing low), `sharingan` (hand raised near eye,
   stance), `dazed` (wobbly, unsteady, head lolling), `grabHold` (clinch/hold the enemy in front), `strikeUp` (uppercut),
   `strikeDown` (axe kick/stomp), `strikeLeft` / `strikeRight` (hooks/kicks to each side), `grabFinisher` (big launcher strike),
   `grabbed` (victim limp, arms loose, slightly lifted).
3. **Hand orb**: `setHandOrb(on, charge 0..1, style)`. Rasengan: size and brightness grow with charge, swirl speeds up, glow ramps.
   Chidori: crackling lightning in hand — several jagged bright blue-white bolts regenerated every few frames (render clock is fine
   for the flicker), size/intensity with charge, little arcs to the ground at high charge. `setDazed(on)`: spinning swirl/star ring
   over the head (purple-red). Keep geometry shared; per-instance materials only when needed.
4. **Effects** (pooled, sim time): `chargeStart` → converging chakra particles + ground ring while charging (follow actor until
   `chargeRelease`/death); `technique` special with `power` → burst scaled by power; `chidori` → lightning trail along the dash +
   branching bolts + sparks, impact flashes on each hit; `sharingan`/`genjutsu` → expanding red ring wave with three comma-shaped
   marks rotating (original shape), red flash on each affected enemy; grab: `grabStart` flash, `qteInput` correct → impact per strike,
   `grabEnd` complete → big finisher impact.
5. **Audio**: charge hum whose pitch/volume rises until full charge (`fullTime` from `chargeStart`) and stops on `chargeRelease`,
   death or pause; Chidori crackling/chirping while charging and a sizzling dash; Sharingan cast (dark whoosh + bell); grab strikes;
   correct arrow tick / wrong buzz (`qteInput.correct`); finisher boom. Never throw without WebAudio.
6. Update `ASSETS.md` (fan versions of Naruto/Sasuke/Kakashi built procedurally, non-commercial).
Verify with screenshots (force anims/looks through `window.__game.debug().ctx.player` and `window.__game.selectCharacter(...)` in
the menu). A dev server may be running on 5199; start one in the background only if nothing listens, never stop it.
