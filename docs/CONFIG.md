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
| [`settings.ts`](../src/config/settings.ts) | Paramètres joueur par défaut (volume, sensibilité, inversion Y, disposition clavier, FPS) et bornes | clé `localStorage` `shinobi-arena.settings.v1` |
| [`characters.ts`](../src/config/characters.ts) | Personnages jouables et leur technique E | naruto → rasengan, sasuke → sharingan, kakashi → chidori |
| [`input.ts`](../src/config/input.ts) | Fenêtres d'entrée (temps réel) | `grabChordMs` 120 (clic gauche + droit), `doubleTapMs` 300 |
| [`world.ts`](../src/config/world.ts) | Monde v5 généré par graine : village, forêt, lac, carrés, arènes JcJ | `size` 900 m, `defaultSeed` 1337, `ambientEnemies` false, `killPlaneY` −15 |
| [`missions.ts`](../src/config/missions.ts) | Missions coopératives (groupes, points, vagues, limite de temps), réanimation, mise à l'échelle | `MISSION_RULES` (compte à rebours 5 s, à terre 30 s, relever 3 s → 40 % PV, résultats 10 s) |
| [`pvp.ts`](../src/config/pvp.ts) | Matchs JcJ : manches, chrono, dégâts, saisie, genjutsu, handicap | `damageScale` 0.7, `grabTime` 2.5, `genjutsuScale` 0.5, `handicapPerMissingPlayer` 0.25, 2 manches gagnantes, 120 s |
| [`net.ts`](../src/config/net.ts) | Serveur hôte et code réseau | port 5180, instantanés 30 Hz, interpolation 100 ms, reconnexion 30 s, compensation de latence ≤ 150 ms |
| [`minimap.ts`](../src/config/minimap.ts) | Minicarte et carte plein écran | `pvpRevealRadius` 35 m |
| [`index.ts`](../src/config/index.ts) | Pas de simulation fixe | `SIM_DT` = 1/60 s |

Les vitesses, la gravité, la hauteur de saut et les coûts de chakra se modifient dans ces fichiers ; `npm run dev`
recharge le jeu à chaud.
