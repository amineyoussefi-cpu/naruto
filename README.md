# Shinobi Arena

Jeu de combat de ninjas en 3D, solo, à la troisième personne, jouable dans le navigateur et entièrement local.
Inspiré par la mobilité et le rythme de *Kizuna Drive*, *Shinobi Striker* et *Ultimate Ninja Storm 3*,
avec des personnages, une arène et des sons 100 % originaux et procéduraux (voir [ASSETS.md](ASSETS.md)).

Survivez à 5 vagues de ninjas (mêlée et distance) dans une arène d'entraînement : courez, sprintez, sautez,
escaladez les falaises au chakra, enchaînez les combos, lancez des kunaï et déclenchez le Rasengan.

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
| Sprint | Maj | Maj |
| Saut / escalade (près d'un mur) | Espace | Espace |
| Attaque (combo 3 coups) | Clic gauche | Clic gauche |
| Garde | Clic droit (maintenir) | Clic droit (maintenir) |
| Kunaï (distance) | Q ou clic molette | A ou clic molette |
| Rasengan (35 chakra) | E | E |
| Concentration (recharge chakra) | R (maintenir) | R (maintenir) |
| Esquive | C | C |
| Verrouiller / libérer la cible | F | F |
| Changer de cible | Tab / molette | Tab / molette |
| Pause | Échap / P | Échap / P |

Cliquer dans le jeu capture la souris. Perdre le focus ou la capture met le jeu en pause.

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
ennemis et vagues : tout est dans [`src/config/`](src/config/), documenté dans [docs/CONFIG.md](docs/CONFIG.md).

## Performances

Mesuré le 2026-10-25 sur Apple M4 Pro (macOS, Chromium headless avec rendu Metal), en 1920×1080 pendant une vague :
**60 FPS stables** (limité par la synchro verticale, 95ᵉ centile 16,7 ms). Avec le rendu logiciel SwiftShader (sans GPU),
environ 16 FPS : le jeu reste jouable en test mais pas confortable. Une seule lumière projette des ombres
(carte 2048), les accessoires répétés sont instanciés et les particules sont mutualisées.

## Limites connues

- Compatibilité **vérifiée** : macOS + Chromium (tests e2e, captures, mesure FPS) et Docker sur macOS.
  Windows, Linux, Firefox et Safari : **prévue** (mêmes commandes npm, aucun chemin spécifique) mais non testée.
- La sensation (accélérations, caméra, timing des combos) a été vérifiée par scripts et captures, pas par une longue
  session de jeu humaine ; les valeurs de `src/config/` sont un premier réglage.
- Les ennemis à distance ne vérifient pas la ligne de vue avant de lancer.
- Les bruits de pas sont joués pour tous les personnages, sans atténuation avec la distance.
- Un seul type de technique spéciale (Rasengan) ; pas de musique d'ambiance ; pas de manette.
- Le multijoueur est hors périmètre.
