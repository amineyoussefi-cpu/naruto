# Art direction v2 — "Shinobi Striker" look

User request (FR): « améliore le graphique du jeu, inspire-toi de Naruto Shinobi Striker ».
Goal: make the game read like an anime-styled ninja action game: bold cel shading, black ink outlines,
saturated but harmonious colours, glowing chakra, a lively hidden-village setting. **Original designs only**:
no Naruto characters, faces, clan symbols, village emblems or logos (headband plates stay blank or use an
original simple mark like a swirl-free leaf-less wave line). "Inspired by", never copied.

## Already in place (integration lead, do not edit)
- `src/render/PostFX.ts`: ink outlines (screen-space, depth based: any geometric silhouette/crease gets a dark line),
  bloom on HDR values > 1.0 only, colour grade, vignette, speed lines. Use `glowMaterial(color, intensity)` from
  `PostFX.ts` for anything that should glow (chakra, Rasengan, lanterns, telegraph). Normal lit materials never bloom.
- `src/render/toon.ts`: `toon(color, { rim })` = MeshToonMaterial with a hard 2-band ramp + fresnel rim light.
  Use it for every lit surface. Characters: `rim: 0.6`; scenery: default `0.35` or `0` for ground/large flats.
- Renderer: Neutral tone mapping, sRGB output, PCF soft shadows, one shadow-casting sun.

## Palette (Shinobi Striker-like, warm afternoon)
- Sky: saturated cerulean top `#3d8be0` → pale cyan horizon `#bfe6f5`; puffy white cel clouds with lilac shadow `#c9c3e6`.
- Foliage: fresh greens `#5fae3f` / `#7cc24a`, dark leaf `#3b7d33`. Ground: warm sand `#d9b77a`, grass `#79b84a`.
- Village: terracotta / vermilion roofs `#c8452f` `#d9622b`, teal accent roofs `#2f8f8a`, cream plaster walls `#efe2c4`,
  dark timber `#5a3a26`, red lacquer `#c8372d`, stone `#a39a8a` / cliff `#b49a7a` (warmer, lighter than now).
- Chakra: blue `#4fb8ff` core `#e6f8ff`; danger/telegraph: red-orange `#ff3b1f`.
Avoid muddy browns and pure black fills — the outline provides the darks.

## Shapes
Chunky, slightly exaggerated, low-poly but smooth enough for clean outlines (silhouettes matter more than detail).
Big readable forms > many tiny props (tiny props make noisy outlines). Bevel-free boxes are fine.

## Performance budget (whole scene)
≤ 600 draw calls, ≤ 400k triangles. Instance anything repeated. One shadow light only. No new textures from files:
procedural canvas textures (small, ≤ 512²) are OK. 60 FPS at 1080p on a laptop iGPU is the target.

## Verification
Agents may run the game headless to look at it: the integration lead keeps a dev server on http://localhost:5199
(do not start/stop servers). Screenshot script: `/private/tmp/claude-503/-Users-Amine-Desktop-naruto/3eeb0c30-94cf-4e65-aa42-d2c12f6fcb1f/scratchpad/shots.mjs`
— copy it into the project root under a unique name (e.g. `shots-<agent>.tmp.mjs`), run
`S=<your output dir> node shots-<agent>.tmp.mjs <prefix>`, read the PNGs, then delete the copy. It uses the real GPU (Metal).
Other agents edit files in parallel, so a transient error from their files may appear; retry once.
