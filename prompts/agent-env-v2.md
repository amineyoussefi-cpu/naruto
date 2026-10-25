# Agent: environment v2 (hidden-village arena + anime sky)

**You own:** `src/world/*` (Arena.ts and new files under src/world/). Nothing else.
Read: `prompts/01-shared-rules.md`, `prompts/10-art-direction.md`, `src/world/Arena.ts`, `src/render/toon.ts`, `src/render/PostFX.ts` (glowMaterial).

**Keep gameplay intact:** same `buildArena` signature/`ArenaInfo`, same collider layout, climbable surfaces, spawn points,
chasm + bridge fall zone. You may restyle colliders' visuals freely and ADD decorative or colliding scenery outside or at the
edge of the playable area, but don't block spawn points, the bridge, or the centre.

Deliver:
1. **Anime sky**: replace the gradient with a sky shader: gradient + stylised cel clouds (fbm noise thresholded into 2 tones,
   slow drift with a `time` uniform — export a small `updateArena(dt)` hook only if needed, otherwise static is fine), plus a
   ring of big puffy 3D cloud clusters on the horizon (instanced spheres, white toon, no shadows).
2. **Hidden-village surroundings** (Shinobi Striker training-ground feel): beyond/on top of the cliff ring, a skyline of original
   village buildings — round towers with conical vermilion roofs, two-storey houses with curved/gabled roofs (terracotta/teal),
   a big original "academy" building, water tanks on stilts, wooden scaffolding, banners/noren with plain colours (no symbols),
   paper lanterns (glowMaterial, warm) on strings, power poles with wires. Instanced; far ones low-poly. Also a distant mountain
   range in cooler desaturated tones for depth (fog does aerial perspective).
3. **Arena dressing**: warmer, lighter cliffs (two-tone rock with large chunky facets/strata), stylised trees with big round
   cel foliage blobs (not cones), grass tufts in brighter greens, dirt paths, the torii in red lacquer, wooden training dummies,
   stone lanterns, fences. Keep props chunky (outlines!).
4. **Lighting**: warm sun `#fff1d6`, hemisphere sky `#bfe0ff` / ground `#6d8a4a` so cel shadows read cool; adjust intensities
   for the 2-band toon ramp (shadows should be clearly readable but not dark). Fog colour matching the horizon.
5. Respect the perf budget; `dispose()` frees everything you create.

Check with screenshots (several angles: menu view, centre looking at cliffs, looking toward the bridge) and iterate until it looks
good. Report what you built + screenshots you checked + draw-call/triangle estimate (`renderer.info` via
`window.__game.renderer.info.render` in the page).
