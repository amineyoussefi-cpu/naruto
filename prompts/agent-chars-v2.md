# Agent: characters v2 (anime ninjas)

**You own:** `src/render/NinjaModel.ts`, `src/render/looks.ts`, `tests/unit/visuals.test.ts` (only to keep it passing / extend). Nothing else.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `src/render/NinjaModel.ts`, `src/render/looks.ts`, `src/render/toon.ts`,
`src/render/PostFX.ts` (glowMaterial), `src/core/types.ts` (AnimState), `src/game/Actor.ts` (how update is called).

Keep the public API of `NinjaModel` (constructor(look), update, setTelegraph, flash, setAura, setHandOrb, setGuard, dispose, root,
`computePose`/`CH`/`POSE_SIZE` exports if the test uses them) and every animation state distinct. Feet at origin, faces +Z, ~1.8 m tall
(capsule radius 0.4) — keep hit readability.

Deliver an anime look comparable to Shinobi Striker avatars (original designs):
1. **Proportions**: slightly larger head (~1/6.5 body), broader shoulders, tapered limbs (use capsules/lathe or scaled
   cylinders with different top/bottom radii), hands as small fists, sandals/shin wraps, so silhouettes are clean under the ink pass.
2. **Face**: anime eyes (white sclera + coloured iris + dark pupil + small highlight, as thin flat meshes on the face), brows, simple
   nose/mouth hints; masked enemies show eyes only. Whisker-like marks are NOT allowed (too derivative).
3. **Hair**: big spiky clumps (cones/tetrahedra clusters) with distinct styles per look (`hairStyle` field in NinjaLook:
   'spiky' | 'swept' | 'topknot' | 'long'), add to looks.
4. **Outfit**: jacket/flak vest with collar and pockets, sleeves rolled or wraps, belt/sash, leg pouch with kunai holster, scarf that
   trails (simple bone chain swaying with velocity/anim), headband cloth tails that flutter. Three looks: player (bright orange + navy,
   blond spiky hair, blue headband cloth), melee enemy (dark purple/charcoal + crimson scarf, masked, swept hair), ranged enemy
   (forest green + sand cloak, topknot, masked). Optionally a fourth palette variant picked randomly per enemy for variety (export
   `pickEnemyLook(kind, rng)` from looks.ts; Game will use it if you add it — say so in the report).
5. **Materials**: `toon(..., { rim: 0.6 })`; `flash` = brief white emissive; `setTelegraph` = red-orange glowMaterial edge on the attacking
   arm + floating "!" (keep), `setAura` = chakra flame shell using glowMaterial (additive, animated flicker / rising), `setHandOrb` =
   Rasengan: bright core (glowMaterial intensity ~4) + 2–3 swirling translucent shells rotating on different axes, `setGuard` keep.
6. **Animation polish**: ninja run (torso leaned forward ~35°, arms trailing straight back) for sprint; snappier attack keys with
   anticipation & follow-through; idle with subtle weight shift; dead lies flat.

Perf: ≤ 45 meshes per ninja, share geometries across instances, per-instance materials only where flash/emissive needs it. Use
screenshots (menu shows the player close-up; fight scenario shows enemies) and iterate. Report what changed and any API additions.
