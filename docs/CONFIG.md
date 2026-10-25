# Paramètres de gameplay

Toutes les valeurs réglables sont centralisées dans [`src/config/`](../src/config/). Chaque champ y est commenté ;
ce document résume où trouver quoi. Unités : mètres, secondes, radians, m/s.

| Fichier | Contenu | Valeurs clés |
|---|---|---|
| [`movement.ts`](../src/config/movement.ts) | Course, sprint, accélération/freinage, contrôle aérien, gravité, saut, escalade, réapparition | `runSpeed` 7.5, `sprintSpeed` 12, `gravity` 28, `jumpHeight` 2.4, `boostSpeed` 26 ; escalade auto `climbSpeed` 14, `climbAutoDot` 0.55, `climbReattachDelay` 0.4 s, `climbChakraPerSecond` 2.5 ; `killPlaneY` −20 |
| [`camera.ts`](../src/config/camera.ts) | Distance, hauteur, limites de tangage, sensibilité de base, collisions, verrouillage | `distance` 6 ; caméra dynamique `distanceSprint` 8.5 / `fovSprint` 68, `distanceCombat` 4.6 / `fovCombat` 58, `combatRange` 8 m, `combatHold` 1.2 s, vitesses de transition `distanceSharpness` / `fovSharpness` 3 ; `lockOnRange` 25 |
| [`combat.ts`](../src/config/combat.ts) | PV/chakra du joueur, combo (dégâts, fenêtres windup/active/recovery), kunai, Rasengan, garde, esquive, hit-stun, hit-stop, secousses | `player.maxHp` 200, `player.maxChakra` 300 ; Rasengan `special` (coût 45, pas de recharge, `minPower` 0.2 → 1 en `fullChargeTime` 1.5 s) ; `chidori` (coût 50, piercing) ; `sharingan` (coût 80, recharge 8 s, rayon 14 m, durée 5 s) ; `grab` (6 flèches, 4 s, dégâts progressifs + final) ; `aimAssist` (`screenRadius` 0.12 de la hauteur d'écran, `range` 40 m) |
| [`chakra.ts`](../src/config/chakra.ts) | Régénération passive, délai, concentration | `regenPerSecond` 12, `regenDelay` 2.5, `concentrateRegenPerSecond` 90, `concentrateStartup` 0.25 |
| [`enemies.ts`](../src/config/enemies.ts) | Archétypes mêlée / distance (PV, vitesse, portées, télégraphes, dégâts, recharge), attaquants simultanés max | `maxSimultaneousAttackers` 2 |
| [`waves.ts`](../src/config/waves.ts) | Composition des 5 vagues et multiplicateurs PV/dégâts, entracte | `WAVE_INTERMISSION` 3 |
| [`settings.ts`](../src/config/settings.ts) | Paramètres joueur par défaut (volume, sensibilité, inversion Y, disposition clavier, FPS) et bornes | clé `localStorage` `shinobi-arena.settings.v1` |
| [`characters.ts`](../src/config/characters.ts) | Personnages jouables et leur technique E | naruto → rasengan, sasuke → sharingan, kakashi → chidori |
| [`input.ts`](../src/config/input.ts) | Fenêtres d'entrée (temps réel) | `grabChordMs` 120 (clic gauche + droit), `doubleTapMs` 300 |
| [`index.ts`](../src/config/index.ts) | Pas de simulation fixe | `SIM_DT` = 1/60 s |

Les vitesses, la gravité, la hauteur de saut et les coûts de chakra se modifient dans ces fichiers ; `npm run dev`
recharge le jeu à chaud.
