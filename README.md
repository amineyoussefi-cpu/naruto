# Shinobi Arena

Jeu de combat de ninjas en 3D, solo, à la troisième personne, jouable dans le navigateur et entièrement local.
Inspiré par la mobilité et le rythme de *Kizuna Drive*, *Shinobi Striker* et *Ultimate Ninja Storm 3*,
avec des personnages, une arène et des sons 100 % originaux et procéduraux (voir [ASSETS.md](ASSETS.md)).

Survivez à 5 vagues de ninjas (mêlée et distance) dans une grande vallée côtière (~210 m : prairies, rivières
turquoise et îlots où l'on marche sur l'eau grâce au chakra, rochers, falaise marine, mer à l'horizon), avec un rythme inspiré de *Storm 3* :
ruée de chakra vers l'ennemi, combos de 5 coups qui foncent sur la cible et projettent l'adversaire, permutation pour
fuir un enchaînement, double saut, marche sur les murs au chakra, kunaï et Rasengan.

## Prérequis

| Outil | Version |
|---|---|
| Node.js | ≥ 20.19 (testé avec 24.14) |
| npm | ≥ 10 (testé avec 11.11) |
| Navigateur | Chrome/Edge, Firefox ou Safari récents avec WebGL 2 |
| Docker (optionnel) | Docker Engine 24+ avec Compose v2 (testé avec 29.6) |

Aucun service cloud, compte ou clé d'API. Tous les fichiers sont servis localement (aucun CDN).

## Installation et démarrage

```bash
npm ci            # installe les versions exactes du package-lock.json
npm run dev       # http://localhost:5173
```

Compilation et aperçu de production :

```bash
npm run build     # vérification TypeScript + bundle dans dist/
npm run preview   # http://localhost:4173
```

Ces commandes sont identiques sous macOS, Windows et Linux.

## Docker

```bash
docker compose up --build        # http://localhost:8080
docker compose down              # arrêt
```

Image multiétape : compilation dans `node:22-alpine`, puis service des fichiers statiques par `nginx-unprivileged`
sur le port 8080. Le port hôte se change avec `GAME_PORT` (voir [.env.example](.env.example)), par ex.
`GAME_PORT=9000 docker compose up --build`.

## Tests et qualité

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest : logique (chakra, dégâts, garde, invulnérabilité, cooldowns, coups uniques, IA, vagues, réglages…)
npx playwright install chromium   # une seule fois
npm run test:e2e    # Playwright : menu → combat → pause figée → victoire → recommencer → défaite → menu
```

## Commandes

Les touches sont liées à la **position physique** : ZQSD sur AZERTY et WASD sur QWERTY sont les mêmes touches.
L'aide affiche les libellés adaptés (détection automatique, modifiable dans Paramètres).

| Action | QWERTY | AZERTY |
|---|---|---|
| Déplacement | W A S D | Z Q S D |
| Caméra | Souris | Souris |
| Course ultra-rapide | W W (double appui, maintenir) | Z Z (double appui, maintenir) |
| Ruée de chakra vers la cible (appui) / course ninja (maintenu) | Maj | Maj |
| Saut, double saut en l'air (contre un mur : se détacher) | Espace | Espace |
| Escalade automatique : courir vers un mur escaladable ; s'éloigner du mur pour lâcher | (déplacement) | (déplacement) |
| Combo 5 coups à tête chercheuse, le 5ᵉ projette l'ennemi | Clic gauche (marteler) | Clic gauche (marteler) |
| Garde | Clic droit (maintenir) | Clic droit (maintenir) |
| Kunaï (visée assistée autour du réticule) | Q ou clic molette | A ou clic molette |
| Technique du personnage : maintenir pour charger, relâcher (Rasengan / Chidori) ; appui (Sharingan) | E | E |
| Saisie, puis cliquer les 6 flèches dans l'ordre | Clic gauche + droit ensemble | Clic gauche + droit ensemble |
| Concentration (recharge chakra) | R (maintenir) | R (maintenir) |
| Esquive ; quand vous êtes touché : permutation (jauge de 4) | C | C |
| Verrouiller / libérer la cible | F | F |
| Changer de cible | Tab / molette | Tab / molette |
| Pause | Échap / P | Échap / P |

Cliquer dans le jeu capture la souris. Perdre le focus ou la capture met le jeu en pause.

## Personnages

Choisis dans le menu (et depuis les écrans de victoire/défaite), mémorisés dans les paramètres :

| Personnage | Technique (E) | Détail |
|---|---|---|
| Naruto (modèle Blender « Ren ») | Rasengan chargé | Sans recharge. Relâché tout de suite : 20 % de puissance ; 100 % après 1,5 s de charge. Dégâts, recul, rayon et effets suivent la charge. 45 chakra. |
| Sasuke | Sharingan | Genjutsu : tous les ennemis dans un rayon de 14 m sont désorientés 5 s (attaques interrompues, ne ciblent plus le joueur). 80 chakra, recharge 8 s. |
| Kakashi | Chidori chargé | Même charge que le Rasengan, puis ruée qui traverse les ennemis : chacun n'est touché qu'une fois, la ruée s'arrête devant les obstacles. 50 chakra. |

**Saisie** (tous) : clic gauche + droit à moins de 120 ms d'intervalle. Si un ennemi est devant, une courte séquence
s'ouvre : le curseur est libéré, six flèches s'affichent, cliquez-les dans l'ordre avant la fin du chrono (4 s).
Chaque bonne flèche frappe (dégâts croissants), les six déclenchent un final puissant ; une erreur ou le temps écoulé
termine la séquence. Le joueur est invulnérable pendant la séquence ; l'ennemi est toujours relâché à la fin.

Chakra : réserve de 300, régénération passive 12/s (après 2,5 s sans dépense), concentration (R) 90/s.

## Architecture

```
src/
  main.ts            démarrage, boucle requestAnimationFrame
  config/            TOUTES les valeurs de gameplay (voir docs/CONFIG.md)
  core/              EventBus typé, pas fixe, entrées (codes physiques), types partagés
  game/              Game (intégration, machine d'états, HUD), Actor, GameContext
  physics/           Rapier : monde, contrôleur de personnage cinématique, stepCharacter
  player/            locomotion, saut, escalade, réapparition
  camera/            caméra orbitale, anti-collision, verrouillage de cible
  combat/            Fighter (stats pures), hitbox/projectiles/dégâts, actions du joueur
  ai/                machines à états ennemies, directeur d'attaques, vagues
  world/ render/     arène, ninjas procéduraux animés, effets
  audio/             effets sonores synthétisés (WebAudio)
  ui/                menus, HUD, pause, paramètres (localStorage)
```

- **Simulation à pas fixe (60 Hz)** séparée du rendu, qui interpole. Les déplacements et les dégâts ne dépendent
  pas des FPS. En pause, aucun pas n'est exécuté (physique, IA, attaques, projectiles, régénération, cooldowns) et
  l'accumulateur est remis à zéro à la reprise : ni saut temporel ni touche bloquée.
- **Ordre d'un pas** : entrées → caméra (verrouillage) → combat joueur → déplacement joueur → IA → combat
  (fighters, hitbox, projectiles) → effets → vagues → nettoyage → physique.
- **Événements de gameplay** (`src/core/events.ts`) : `damage`, `death`, `attackStart`, `telegraph`, `technique`,
  `chakraFail`, `waveStart`, `victory`… Audio, effets et HUD ne font qu'écouter.
- **Frappes** : sphères actives pendant la fenêtre d'attaque, testées contre les capsules ; chaque hitbox mémorise
  ses cibles, donc un coup ne touche jamais deux fois la même cible.
- **Redémarrage** sans rechargement : acteurs, hitbox, projectiles et particules sont détruits et leurs ressources GPU
  libérées ; le joueur et les vagues repartent de zéro.

Le projet a été construit par une équipe d'agents IA en parallèle ; les consignes de chaque agent sont dans
[prompts/](prompts/) et le suivi des tâches et décisions dans [docs/TASKS.md](docs/TASKS.md).

## Paramètres de gameplay

Vitesses, gravité, hauteur de saut, coûts et régénération de chakra, dégâts, fenêtres d'attaque, recharges,
charge des techniques, saisie, aide à la visée, caméra dynamique, personnages, ennemis et vagues : tout est dans
[`src/config/`](src/config/), documenté dans [docs/CONFIG.md](docs/CONFIG.md).

## Direction artistique

Inspirée de *Naruto to Boruto: Shinobi Striker*, entièrement originale (aucun personnage, symbole ou logo repris) :
contours à l'encre calculés en post-traitement, cel-shading à deux tons avec liseré lumineux, bloom réservé au chakra,
lignes de vitesse en sprint et pendant les ruées, ciel anime avec nuages cel-shadés, village caché en terrasses
(tours à toits vermillon, maisons, lanternes), ninjas anime (yeux, coiffures, gilets, écharpes animées), impacts
façon manga et HUD incliné. Paramètres > *Qualité graphique : Basse* désactive le post-traitement et les ombres pour
les machines modestes. Réglages visuels : `POSTFX` dans [`src/render/PostFX.ts`](src/render/PostFX.ts).

## Performances

Mesuré le 2026-10-25 sur Apple M4 Pro (macOS, Chromium headless avec rendu Metal), en 1920×1080 pendant une vague :
**60 FPS stables** (limité par la synchro verticale, 95ᵉ centile 16,8 ms) en qualité *Élevée* (post-traitement anime
complet, ~140–220 appels de dessin et ~240 k triangles par image). Avec le rendu logiciel SwiftShader (sans GPU),
environ 16 FPS : le jeu reste jouable en test mais pas confortable. Une seule lumière projette des ombres
(carte 2048), les accessoires répétés sont instanciés et les particules sont mutualisées.

## Limites connues

- Compatibilité **vérifiée** : macOS + Chromium (tests e2e, captures, mesure FPS) et Docker sur macOS.
  Windows, Linux, Firefox et Safari : **prévue** (mêmes commandes npm, aucun chemin spécifique) mais non testée.
- La sensation (accélérations, caméra, timing des combos) a été vérifiée par scripts et captures, pas par une longue
  session de jeu humaine ; les valeurs de `src/config/` sont un premier réglage.
- Les ennemis à distance ne vérifient pas la ligne de vue avant de lancer.
- La carte n'a plus de zone de chute (tout le bas est de l'eau praticable) ; la réapparition sous y = −20 reste active par sécurité.
- La mer s'arrête à une limite invisible à ~128 m du centre.
- Le clignotement d'impact ne colore pas tous les petits détails des personnages (bandages, plaque, visage).
- Les bruits de pas sont joués pour tous les personnages, sans atténuation avec la distance.
- Pas de musique d'ambiance ; pas de manette.
- Les flèches de la saisie se cliquent uniquement (pas de raccourci clavier) ; si le navigateur refuse de recapturer la
  souris à la fin de la séquence, un clic dans le jeu la recapture.
- Le son de charge ne reprend pas après une pause en pleine charge (la charge, elle, reprend normalement).
- Les yeux du Sharingan ne s'appliquent pas au modèle Blender (Sasuke et Kakashi sont procéduraux).
- Le Chidori ne s'arrête que sur des obstacles à hauteur de poitrine (rayon unique), pas sur de très petits rochers.
- Le multijoueur est hors périmètre.
