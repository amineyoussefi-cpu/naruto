# Assets and provenance

Shinobi Arena ships **no binary assets** (no images, models, fonts or audio files).

| What | Where | How it is made | License |
|------|-------|----------------|---------|
| Arena, props, sky | `src/world/Arena.ts` | Procedural Three.js primitives, toon materials, gradient-sphere sky shader | Original, project license |
| Ninja characters & animations | `src/render/NinjaModel.ts` | Procedural hierarchical primitives, pose functions per animation state | Original, project license |
| Projectiles (kunai, shuriken, chakra sphere) | `src/render/meshes.ts` | Procedural geometry | Original, project license |
| Particles / VFX | `src/render/Effects.ts` | Instanced primitives, additive blending | Original, project license |
| Sound effects & stingers | `src/audio/AudioSystem.ts` | WebAudio synthesis at runtime (oscillators + filtered noise) | Original, project license |

Designs are Naruto-*inspired* (headbands, ninja run, chakra sphere) but use no copyrighted logos,
characters, symbols or audio. The headband plates are blank metal.
