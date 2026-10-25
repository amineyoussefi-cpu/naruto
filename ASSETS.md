# Assets and provenance

Shinobi Arena ships one binary asset: the player model `public/models/hero.glb`. Everything else is procedural.

| What | Where | How it is made | License |
|------|-------|----------------|---------|
| Arena, props, sky | `src/world/Arena.ts` | Procedural Three.js primitives, toon materials, gradient-sphere sky shader | Original, project license |
| Player model "Ren" (`public/models/hero.glb`) | `tools/blender/build_hero.py` | Generated in Blender by the script (open `art/hero.blend` to edit); animated by NinjaModel joints | Original, project license |
| Ninja characters & animations | `src/render/NinjaModel.ts` | Procedural hierarchical primitives, pose functions per animation state | Original, project license |
| Playable fan versions of Sasuke, Kakashi (and Naruto's procedural fallback) | `src/render/looks.ts` + `NinjaModel.ts` | Procedural: colour schemes, hair silhouettes, mask, slanted headband, whiskers, Sharingan eyes | Fan art, local non-commercial use only |
| Rasengan / Chidori / Sharingan / grab VFX | `src/render/Effects.ts`, `src/render/fx/shapes.ts` | Procedural lightning, comma-ring wave, pooled particles | Original shapes, project license |
| Projectiles (kunai, shuriken, chakra sphere) | `src/render/meshes.ts` | Procedural geometry | Original, project license |
| Particles / VFX | `src/render/Effects.ts` | Instanced primitives, additive blending | Original, project license |
| Sound effects & stingers | `src/audio/AudioSystem.ts` | WebAudio synthesis at runtime (oscillators + filtered noise) | Original, project license |

Enemies and the arena are Naruto-*inspired* originals. The three playable characters are recognisable
**fan versions** of Naruto, Sasuke and Kakashi, built procedurally for a local, non-commercial project; no official
logos, village emblems, textures, models or audio from the anime are used. Player headband plates are blank metal.
