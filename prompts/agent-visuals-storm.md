# Agent: visuals — Storm 3 animations & effects

**You own:** `src/render/NinjaModel.ts`, `src/render/Effects.ts`, `src/render/fx/*`, `src/render/meshes.ts`, `src/audio/AudioSystem.ts`,
`tests/unit/visuals.test.ts`.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `prompts/20-storm-feel.md`, your files, `src/core/{types,events}.ts`,
`src/game/Actor.ts`, `src/config/combat.ts` (timings; the combat agent is retuning it in parallel — read timings from config, don't hardcode).

Deliver:
1. **Poses** in `computePose` (distinct, snappy, anticipation + overshoot, keyed to `COMBAT.combo[i]` timings where relevant):
   `attack4` = flying knee or roundhouse; `attack5` = launcher (rising two-hand palm strike / uppercut, body lifting);
   `dash` = extreme chakra-dash lean (~60°), arms swept back, legs stretched in a glide; `launched` = airborne tumble (body
   rotating backward over the anim time, limbs flailing — use a direct-driven channel like dodge so blends don't unwind);
   `substitution` = quick crouched hand-seal reappear. Keep all existing states. Keep mesh budget test passing.
2. **Effects** (pooled, sim-time):
   - `chakraDash`: blue chakra burst at start + a glowing blue streak trail behind the actor while its anim is `dash`
     (follow via `getActor`), speed-line feel in world space (stretched glow quads).
   - `substitution`: big cel smoke poof at `from` + a **wooden log** (toon wood, ink outline friendly, short) appearing in the
     poof and dropping/rolling then fading after ~1.5 s (pool 2–3 logs); smaller poof at `to`.
   - `jump` with `air: true`: wind ring + small chakra puff under the feet.
   - Launcher (`damage` with kind `combo5`): heavy impact star + shock ring + upward dust; treat `combo5` (and `combo4` medium)
     as heavy wherever `combo3` was the heavy case.
3. **Audio**: whoosh for `chakraDash`, poof+wood "tok" for `substitution`, airy jump for `jump.air`, heavier impact for `combo5`.
Check with screenshots (the combat agent works in parallel; poses can be checked via a fake loop or the Playwright page by
forcing `actor.setAnim(...)` through `window.__game.debug().ctx.player`). Report what you built.
