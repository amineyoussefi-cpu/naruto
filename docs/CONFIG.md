# Paramètres de gameplay

Toutes les valeurs réglables sont centralisées dans [`src/config/`](../src/config/). Chaque champ y est commenté ;
ce document résume où trouver quoi. Unités : mètres, secondes, radians, m/s.

| Fichier | Contenu | Valeurs clés |
|---|---|---|
| [`movement.ts`](../src/config/movement.ts) | Course, sprint, accélération/freinage, contrôle aérien, gravité, saut, escalade, réapparition | `runSpeed` 7.5, `sprintSpeed` 12, `gravity` 28, `jumpHeight` 2.4, `climbChakraPerSecond` 2.5, `killPlaneY` −20 |
| [`camera.ts`](../src/config/camera.ts) | Distance, hauteur, limites de tangage, sensibilité de base, collisions, verrouillage | `distance` 6, `lockOnRange` 25, `maxShake` 0.4 |
| [`combat.ts`](../src/config/combat.ts) | PV/chakra du joueur, combo (dégâts, fenêtres windup/active/recovery), kunai, Rasengan, garde, esquive, hit-stun, hit-stop, secousses | `player.maxHp` 200, `special.chakraCost` 35, `special.cooldown` 6, `guardDamageFactor` 0.25, `dodge.invulnerable` 0.25 |
| [`chakra.ts`](../src/config/chakra.ts) | Régénération passive, délai, concentration | `regenPerSecond` 4, `regenDelay` 2.5, `concentrateRegenPerSecond` 30, `concentrateStartup` 0.25 |
| [`enemies.ts`](../src/config/enemies.ts) | Archétypes mêlée / distance (PV, vitesse, portées, télégraphes, dégâts, recharge), attaquants simultanés max | `maxSimultaneousAttackers` 2 |
| [`waves.ts`](../src/config/waves.ts) | Composition des 5 vagues et multiplicateurs PV/dégâts, entracte | `WAVE_INTERMISSION` 3 |
| [`settings.ts`](../src/config/settings.ts) | Paramètres joueur par défaut (volume, sensibilité, inversion Y, disposition clavier, FPS) et bornes | clé `localStorage` `shinobi-arena.settings.v1` |
| [`index.ts`](../src/config/index.ts) | Pas de simulation fixe | `SIM_DT` = 1/60 s |

Les vitesses, la gravité, la hauteur de saut et les coûts de chakra se modifient dans ces fichiers ; `npm run dev`
recharge le jeu à chaud.
