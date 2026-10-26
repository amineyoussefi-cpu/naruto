# Shinobi Arena

Jeu de combat de ninjas en 3D à la troisième personne, jouable dans le navigateur : en solo hors ligne, ou en ligne
jusqu'à 6 joueurs (coopération et JcJ) sur un réseau privé Tailscale, sans aucun service cloud.
Inspiré par la mobilité et le rythme de *Kizuna Drive*, *Shinobi Striker* et *Ultimate Ninja Storm 3*,
avec des personnages, une arène et des sons 100 % originaux et procéduraux (voir [ASSETS.md](ASSETS.md)).

Un grand monde (~900 m) : le village caché (version fan, sans logo officiel) avec son QG, ses quartiers, son marché,
ses toits et sa rivière ; une grande forêt d'arbres géants ; un lac et la mer avec plages, pontons et îles où l'on marche
sur l'eau. Les **missions coopératives** et les **matchs JcJ** (1c1 à 3c3, équipes inégales possibles) se lancent depuis
des carrés au sol à côté du QG et de la grande porte. Rythme inspiré de *Storm 3* :
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

## Jouer en ligne avec Tailscale / Online play over Tailscale

Un joueur **héberge** la partie ; tout le monde (lui compris) joue dans son navigateur.
*One player **hosts**; everyone, the host included, plays in a browser.*

1. **Hôte / host** : installer [Tailscale](https://tailscale.com/download) et se connecter. Inviter ses amis dans son
   tailnet (*Settings → Users → Invite*). Le plan gratuit Personal accepte jusqu'à 6 utilisateurs, assez pour 6 joueurs.
   *Install Tailscale, sign in and invite your friends to your tailnet (the free Personal plan allows 6 users).*
2. **Amis / friends** : installer Tailscale, accepter l'invitation, se connecter.
   *Install Tailscale, accept the invite, sign in.*
3. **Hôte / host**, dans ce dossier / in this folder :
   ```bash
   npm ci
   npm run host          # compile puis lance le serveur sur le port 5180
   ```
   Le serveur affiche les adresses à partager, par ex. `http://mon-mac.tailnet-xyz.ts.net:5180` (nom MagicDNS) ou
   `http://100.x.y.z:5180`. Au premier lancement, macOS demande d'autoriser les connexions entrantes pour `node` :
   accepter. *The server prints the URLs to share; allow incoming connections for `node` when macOS asks.*
4. **Tout le monde / everyone** ouvre l'adresse, choisit **Multijoueur**, un pseudo et un personnage, puis **Rejoindre**.
   L'hôte ouvre `http://localhost:5180`. *Open the URL, choose Multijoueur, a name and a character, then Rejoindre.*
5. Vérifier que la liaison est directe / check the link is direct : `tailscale ping <nom-de-l-hote>` doit répondre
   `via <ip>:<port>` (direct). `via DERP(...)` = relais : jouable mais avec plus de latence.

Sécurité : par défaut le serveur n'écoute que sur `localhost` et l'interface Tailscale (100.64.0.0/10), jamais sur tout
le réseau, donc il n'est pas exposé sur un Wi-Fi public. `npm run host -- --lan` l'ouvre au réseau local (à éviter hors de
chez soi). Autres options : `--port 5190`, `--seed 42` (même graine = même monde). Si une fonction du navigateur exige
HTTPS, `tailscale serve 5180` fournit une adresse `https://…ts.net`.
*By default the server binds to localhost and the Tailscale interface only. `--lan` opens it to the local network.*

6 joueurs maximum (un 7ᵉ voit « Serveur plein »). Un joueur déconnecté retrouve son personnage s'il revient avec le même
pseudo dans les 30 s. L'hôte peut exclure un joueur depuis le menu (Échap). En ligne, Échap ouvre le menu sans mettre la
partie en pause.

Développement : `npm run host:dev` (serveur + serveur de dev Vite sur http://localhost:5173, `/ws` relayé).

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
npm run test:e2e    # Playwright : solo (monde libre, pause, carré co-op → mission → victoire, saisie) et en ligne
                    # (3 navigateurs + 2 serveurs hôtes --debug : mission co-op, match JcJ, changement d'équipe, K.-O., serveur plein)
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
| Saisie, puis les 6 flèches dans l'ordre (touches fléchées, ZQSD/WASD ou clic) | Clic gauche + droit ensemble | Clic gauche + droit ensemble |
| Concentration (recharge chakra) | R (maintenir) | R (maintenir) |
| Esquive ; quand vous êtes touché : permutation (jauge de 4) | C | C |
| Verrouiller / libérer la cible ; dans un carré : changer de mission / d'arène ; près d'un allié à terre : maintenir pour le relever | F | F |
| Carte plein écran (molette : zoom) | M | M |
| Changer de cible | Tab / molette | Tab / molette |
| Menu (pause en solo ; en ligne la partie continue) | Échap / P | Échap / P |

Cliquer dans le jeu capture la souris. Perdre le focus ou la capture met le jeu en pause.

## Personnages

Choisis dans le menu (et depuis les écrans de victoire/défaite), mémorisés dans les paramètres :

| Personnage | Technique (E) | Détail |
|---|---|---|
| Naruto (modèle Blender « Ren ») | Rasengan chargé | Sans recharge. Relâché tout de suite : 20 % de puissance ; 100 % après 1,5 s de charge. Dégâts, recul, rayon et effets suivent la charge. 45 chakra. |
| Sasuke | Sharingan | Genjutsu : tous les ennemis dans un rayon de 14 m sont désorientés 5 s (attaques interrompues, ne ciblent plus le joueur). 80 chakra, recharge 8 s. |
| Kakashi | Chidori chargé | Même charge que le Rasengan, puis ruée qui traverse les ennemis : chacun n'est touché qu'une fois, la ruée s'arrête devant les obstacles. 50 chakra. |

**Saisie** (tous) : clic gauche + droit à moins de 120 ms d'intervalle. Si un ennemi est devant, une courte séquence
s'ouvre : six flèches s'affichent ; entrez-les dans l'ordre avant la fin du chrono (4 s) avec les touches fléchées,
ZQSD/WASD ou en cliquant dessus (le curseur est libéré).
Chaque bonne flèche frappe (dégâts croissants), les six déclenchent un final puissant ; une erreur ou le temps écoulé
termine la séquence. Le joueur est invulnérable pendant la séquence ; l'ennemi est toujours relâché à la fin.

Chakra : réserve de 300, régénération passive 12/s (après 2,5 s sans dépense), concentration (R) 90/s.

## Architecture

```
server/              hôte en ligne (Node) : HTTP statique + WebSocket RFC 6455 maison, boucle 60 Hz, instantanés 30 Hz
src/
  main.ts            démarrage, boucle requestAnimationFrame
  config/            TOUTES les valeurs de gameplay (voir docs/CONFIG.md)
  core/              EventBus typé, pas fixe, entrées (codes physiques), types partagés
  sim/               SIMULATION pure (Node + navigateur) : Sim, acteurs, physique Rapier, déplacements, combat, IA,
                     monde généré par graine (sim/world), missions co-op et JcJ (sim/missions), protocole réseau
  net/               LocalHost (solo dans la page), NetClient (WebSocket), codec binaire, interpolation, réconciliation
  game/              client : Game (rendu, caméra, entrées → PlayerInput, instantanés → ActorView), prédiction
  camera/            caméra orbitale, anti-collision, verrouillage de cible
  world/ render/     maillages du monde (tronçons de 64 m + LOD), ninjas procéduraux, effets, dôme, noms
  audio/             effets sonores synthétisés (WebAudio)
  ui/                menus, salon, HUD, minicarte et carte, écrans de mission / JcJ, paramètres
```

- **Simulation à pas fixe (60 Hz)** séparée du rendu, qui interpole. Les déplacements et les dégâts ne dépendent
  pas des FPS. En pause, aucun pas n'est exécuté (physique, IA, attaques, projectiles, régénération, cooldowns) et
  l'accumulateur est remis à zéro à la reprise : ni saut temporel ni touche bloquée.
- **Hôte autoritaire** : la même simulation (`src/sim/`) tourne sur l'hôte en ligne et dans la page en solo. Le client
  n'envoie qu'un `PlayerInput` par pas et dessine les instantanés ; il prédit ses propres déplacements et interpole les
  autres (100 ms). Les coups sont décidés par l'hôte, avec compensation de latence (≤ 150 ms) entre joueurs.
- **Ordre d'un pas** : entrées → combat des joueurs → déplacement des joueurs → IA → combat (fighters, hitbox,
  projectiles) → missions / JcJ → nettoyage → physique.
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

## Modes de jeu

- **Monde libre** : pas d'ennemis ; on explore le village, la forêt, le lac. La minicarte (en haut à droite) tourne avec la
  caméra (option « Minimap orientée nord »).
- **Mission co-op** : tous les joueurs connectés se placent dans le carré bleu devant le QG (F change de mission) ; compte à
  rebours de 5 s (quitter le carré l'annule). Les groupes ennemis apparaissent sur la minicarte (crâne rouge + nombre) et
  attendent qu'on s'approche. À 0 PV on est **à terre** 30 s : un allié maintient F 3 s pour relever (40 % PV). Tout le monde
  à terre = défaite. Résultats 10 s puis retour au QG. Le nombre et les PV des ennemis augmentent avec le nombre de joueurs.
- **Match JcJ** : carrés rouge/bleu sur la place du QG et derrière la grande porte ; la moitié où l'on se tient = son équipe
  (on peut changer jusqu'au compte à rebours). Départ quand tous les joueurs sont dans le même carré, au moins 1 par équipe
  et 3 au plus. F choisit l'arène (Terrain d'entraînement, Clairière, Lac, Toits), fermée par un dôme de chakra. 2 manches
  gagnantes, 120 s par manche (sinon l'équipe au plus fort % de PV gagne la manche), dégâts × 0,7, l'équipe en infériorité
  numérique reçoit +25 % de PV par joueur manquant. Pas de tir allié.

## Limites connues

- Compatibilité **vérifiée** : macOS + Chromium (tests e2e, captures) et Docker sur macOS (solo). Le jeu en ligne a été testé
  avec plusieurs navigateurs sur la même machine (localhost) ; une vraie partie entre machines via Tailscale (relais DERP
  compris) n'a pas été testée. Avec une liaison relayée, compter ~50–150 ms de latence de plus : les déplacements restent
  fluides (prédiction), mais les coups (décidés par l'hôte) arrivent avec ce délai.
- En ligne, seuls les déplacements du joueur local sont prédits ; les attaques, ruées et esquives suivent l'hôte (un aller-retour).
- `docker compose up` sert le jeu solo (fichiers statiques) ; pour héberger une partie en ligne, utiliser `npm run host`.
- Le ralenti à l'impact (hit-stop) n'existe qu'en solo.
- Les bruits de pas sont joués pour tous les personnages, sans atténuation avec la distance ; pas de musique ; pas de manette.
- Le son de charge ne reprend pas après une pause en pleine charge.
- Les yeux du Sharingan ne s'appliquent pas au modèle Blender (Sasuke et Kakashi sont procéduraux).
