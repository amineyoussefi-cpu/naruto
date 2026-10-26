import type { Game, GameApi } from '../game/Game';
import type { CharacterId, GameState, HudData, QteDir } from '../core/types';
import type { ModeState } from '../sim/missions/types';
import { SETTINGS_LIMITS, UI_CONFIG, type Settings } from '../config/settings';
import { CHARACTERS, CHARACTER_IDS } from '../config/characters';
import { MINIMAP } from '../config/minimap';
import { browserStorage, loadSettings, sanitizeSettings, saveSettings } from './settingsStore';
import { QTE_DIR_LABELS, QTE_GLYPHS, qteArrowState, qteBanner } from './qteView';
import { MapView } from './MapView';
import { formatTime, mapRotation } from './minimapMath';
import { modeView } from './modeView';

type Overlay = 'character' | 'controls' | 'settings' | 'lobby' | null;

/** What the UI reads from the client: GameApi plus the v5 online/mode getters of `Game`. */
export type UiGame = GameApi & Pick<Game, 'modeState' | 'markers' | 'players' | 'myPlayerId' | 'isHost' | 'kick' | 'world' | 'me' | 'views' | 'cameraYaw'>;

/** Help rows; 'special' text comes from the selected character. */
const COMMANDS: [keyof GameApi['keyLabels'] | 'move' | 'climb' | 'map', string][] = [
  ['move', 'Se déplacer'], ['boost', 'Double appui avant et maintenir : course ultra-rapide'],
  ['sprint', 'Appui : ruée de chakra (dash) vers la cible · maintenu : course ninja'],
  ['jump', 'Sauter, double saut en l’air'], ['climb', 'Courez contre un mur : escalade automatique et rapide'],
  ['attack', 'Combo de 5 coups à tête chercheuse (le dernier projette l’ennemi)'], ['guard', 'Garde'], ['special', ''],
  ['grab', 'Saisie : clic gauche + droit ensemble, puis les 6 flèches dans l’ordre (touches fléchées, ZQSD/WASD ou clic)'],
  ['kunai', 'Lancer un kunaï (visée assistée si la cible est en vue)'], ['concentrate', 'Concentrer le chakra'],
  ['dodge', 'Esquive · quand vous êtes touché : permutation (substitution)'],
  ['lockOn', 'Verrouiller une cible'], ['switchTarget', 'Changer de cible'],
  ['interact', 'Sur un carré de départ : changer de mission / d’arène · près d’un allié à terre : maintenir pour relever'],
  ['map', 'Carte du monde (molette : zoom)'], ['pause', 'Pause / menu'],
];
const ESC = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = browserStorage;
const QTE_SLOTS = 6; // arrow buttons in the template (#qte-arrow-0..5)

const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

/**
 * DOM UI: main menu (solo / multijoueur lobby), controls help, HUD, minimap and full map, co-op / PvP HUD and
 * results, pause (with the online players list), settings. Owner: UI agent. Reads the game only through UiGame.
 */
export class UI {
  private readonly el: Record<string, HTMLElement> = {};
  private overlay: Overlay = null;
  /** Where the controls card was opened from (shows "Commencer" only from the menu). */
  private overlayFromMenu = false;
  private lastHp = -1;
  private hpTrail = 1;
  private hpTrailDelay = 0;
  private vignette = 0;
  private chakraFail = 0;
  /** Last written text/style per key, so update() only touches the DOM on change. */
  private readonly written = new Map<string, string>();
  private readonly enemyPool: { root: HTMLElement; fill: HTMLElement }[] = [];
  private cdSlots: { root: HTMLElement; sweep: HTMLElement; time: HTMLElement }[] = [];
  /** Character highlighted on the selection screen (applied on confirm). */
  private pendingChar: CharacterId = 'naruto';
  /** Index of the last wrong arrow click in the current grab sequence (-1 if none). */
  private qteWrong = -1;
  private readonly map: MapView;
  private mapOpen = false;
  private northUp = false;
  /** Render clock (s): pulses only. */
  private clock = 0;
  private lobbyChar: CharacterId = 'naruto';
  private joining = false;
  private playersSig = '';
  private readonly mateBars: { root: HTMLElement; name: HTMLElement; fill: HTMLElement }[] = [];

  constructor(private readonly root: HTMLElement, private readonly game: UiGame) {
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>('[id]').forEach((n) => { this.el[n.id] = n; });

    const settings = loadSettings(browserStorage());
    this.game.applySettings(settings);
    this.fillSettingsForm(settings);
    this.map = new MapView(this.el['minimap'] as HTMLCanvasElement, this.el['fullmap-canvas'] as HTMLCanvasElement);
    try { this.northUp = store()?.getItem(MINIMAP.northUpStorageKey) === '1'; } catch { /* blocked storage */ }
    (this.el['settings-northup'] as HTMLInputElement).checked = this.northUp;
    try { (this.el['lobby-name'] as HTMLInputElement).value = store()?.getItem(MINIMAP.nameStorageKey) ?? ''; } catch { /* blocked storage */ }

    const click = (id: string, fn: () => void) => this.el[id].addEventListener('click', () => { this.game.uiClick(); fn(); });
    click('btn-play', () => this.openOverlay('character', true));
    click('btn-multi', () => this.openOverlay('lobby', true));
    click('btn-lobby-join', () => void this.join());
    click('btn-lobby-back', () => this.openOverlay(null));
    for (const id of CHARACTER_IDS) click(`lobby-char-${id}`, () => this.pickLobbyChar(id));
    this.el['lobby-name'].addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.join(); });
    click('btn-fullmap-close', () => this.toggleMap(false));
    this.el['players-list'].addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-kick]')?.dataset.kick;
      if (id) { this.game.uiClick(); this.game.kick(Number(id)); }
    });
    click('btn-char-confirm', () => this.confirmCharacter());
    click('btn-char-back', () => this.openOverlay(null));
    for (const id of CHARACTER_IDS) click(`char-${id}`, () => this.pickCharacter(id));
    this.el['char-panel'].addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const n = CHARACTER_IDS.length;
      this.pickCharacter(CHARACTER_IDS[(CHARACTER_IDS.indexOf(this.pendingChar) + step + n) % n]);
      this.el[`char-${this.pendingChar}`].focus();
    });
    // Grab sequence: every arrow sends its own direction, combat validates. Keep clicks off the canvas.
    const qte = this.el['qte'];
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'click'] as const) qte.addEventListener(type, (e) => e.stopPropagation());
    qte.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    for (let i = 0; i < QTE_SLOTS; i++) {
      this.el[`qte-arrow-${i}`].addEventListener('click', (e) => {
        const dir = (e.currentTarget as HTMLElement).dataset.dir as QteDir | undefined;
        if (dir) this.game.qteInput(dir);
      });
    }
    click('btn-controls', () => this.openOverlay('controls', true));
    click('btn-settings-main', () => this.openOverlay('settings', true));
    click('btn-start-fight', () => { this.resetRun(); this.game.start(); });
    click('btn-resume', () => this.game.resume());
    click('btn-restart', () => { this.resetRun(); this.game.restart(); });
    click('btn-settings', () => this.openOverlay('settings', false));
    click('btn-controls-pause', () => this.openOverlay('controls', false));
    click('btn-menu', () => this.game.quitToMenu());
    click('btn-controls-back', () => this.openOverlay(null));
    click('btn-settings-back', () => this.openOverlay(null));
    this.el['settings-panel'].addEventListener('input', () => this.onSettingsInput());
    this.el['settings-panel'].addEventListener('change', () => this.onSettingsInput());

    window.addEventListener('keydown', (e) => {
      // The game only handles Escape while playing/paused; close menu overlays ourselves.
      const st = this.game.state;
      if (e.code === 'Escape' && this.overlay && st === 'menu') this.openOverlay(null);
      // M toggles the full map while playing (the map uses the "paused" state to free the cursor; online the game goes on).
      if (e.code === 'KeyM' && !e.repeat && this.game.world && (st === 'playing' || (st === 'paused' && this.mapOpen))) {
        e.preventDefault();
        this.toggleMap(!this.mapOpen);
      }
    });

    const ev = this.game.events;
    ev.on('stateChange', (e) => {
      this.overlay = null;
      if (e.state !== 'paused') this.mapOpen = false;
      this.render();
    });
    ev.on('grabStart', () => { this.qteWrong = -1; });
    ev.on('qteInput', (e) => {
      if (e.correct || e.index >= QTE_SLOTS) return;
      this.qteWrong = e.index;
      this.restartAnim(this.el[`qte-arrow-${e.index}`]);
    });
    ev.on('chakraFail', () => {
      this.chakraFail = UI_CONFIG.chakraFailTime;
      this.restartAnim(this.el['hud-chakra']);
    });
    this.render();
  }

  update(frameDt: number): void {
    const s = this.game.settings;
    this.setHidden('hud-fps', !s.showFps);
    this.clock += frameDt;
    if (this.mapOpen) this.drawMap(true);
    if (this.game.state === 'paused' && this.game.online && !this.mapOpen) this.updatePlayers();
    if (this.game.state !== 'playing') return;
    const d = this.game.getHudData();
    if (s.showFps) this.text('hud-fps', `${Math.round(d.fps)} FPS`);
    this.updateBars(d, frameDt);
    this.updateCooldowns(d);
    this.drawMap(false);
    this.updateMode();
    this.updateLock(d);
    this.updateEnemyBars(d);
    this.updateCharge(d);
    this.updateQte(d);

    this.vignette = Math.max(0, this.vignette - frameDt);
    this.style('hud-vignette', 'opacity', (this.vignette / UI_CONFIG.vignetteTime).toFixed(2));
    this.chakraFail = Math.max(0, this.chakraFail - frameDt);
    this.setHidden('hud-chakra-msg', this.chakraFail <= 0);
    this.el['hud-chakra'].classList.toggle('fail', this.chakraFail > 0);
  }

  // ---------- screens ----------

  private render(): void {
    const st: GameState = this.game.state;
    const ov = this.overlay;
    const online = this.game.online;
    this.setHidden('main-menu', st !== 'menu' || ov !== null);
    this.setHidden('hud', st !== 'playing');
    this.setHidden('pause-menu', st !== 'paused' || ov !== null || this.mapOpen);
    this.setHidden('fullmap', !this.mapOpen || st !== 'paused');
    this.setHidden('pause-online', !online);
    this.setHidden('btn-restart', online);
    this.text('pause-title', online ? 'Menu' : 'Pause');
    this.text('btn-menu', online ? 'Quitter la partie' : 'Menu principal');
    this.playersSig = '';
    if (st === 'paused' && online) this.updatePlayers();
    this.setHidden('lobby-panel', ov !== 'lobby');
    this.setHidden('char-panel', ov !== 'character');
    this.setHidden('controls-panel', ov !== 'controls');
    this.setHidden('settings-panel', ov !== 'settings');
    this.setHidden('btn-start-fight', !this.overlayFromMenu);
    this.root.classList.toggle('dim', st !== 'playing' && !this.mapOpen);
    const c = CHARACTERS[this.game.character];
    this.el['menu-character'].textContent = `Personnage : ${c.name} — ${c.specialLabel}`;
    this.el['menu-character'].className = `menu-character accent-${this.game.character}`;
    this.el['btn-char-confirm'].textContent = this.overlayFromMenu ? 'Continuer' : 'Valider';

    if (ov === 'character') { this.el[`char-${this.pendingChar}`].focus(); return; }
    if (ov === 'lobby') { this.el['lobby-name'].focus(); return; }
    if (this.mapOpen) return;
    const visible = ['controls-panel', 'settings-panel', 'main-menu', 'pause-menu']
      .map((id) => this.el[id]).find((e) => !e.hidden);
    visible?.querySelector<HTMLElement>('button:not([hidden]), input, select')?.focus();
  }

  private openOverlay(ov: Overlay, fromMenu = this.overlayFromMenu): void {
    this.overlay = ov;
    this.overlayFromMenu = fromMenu;
    if (ov === 'controls') this.fillControls();
    if (ov === 'character') this.pickCharacter(this.game.character);
    if (ov === 'lobby') { this.pickLobbyChar(this.game.character); this.lobbyStatus(''); }
    this.render();
  }

  // ---------- lobby / online ----------

  private pickLobbyChar(id: CharacterId): void {
    this.lobbyChar = id;
    for (const c of CHARACTER_IDS) this.el[`lobby-char-${c}`].setAttribute('aria-pressed', String(c === id));
  }

  private lobbyStatus(msg: string, error = false): void {
    this.el['lobby-status'].textContent = msg;
    this.el['lobby-status'].classList.toggle('error', error);
  }

  /** Saves name + character, then joins the host that served this page. */
  private async join(): Promise<void> {
    if (this.joining) return;
    const input = this.el['lobby-name'] as HTMLInputElement;
    const name = input.value.trim().slice(0, MINIMAP.nameMaxLength);
    if (!name) { this.lobbyStatus('Entrez un nom de joueur.', true); input.focus(); return; }
    try { store()?.setItem(MINIMAP.nameStorageKey, name); } catch { /* blocked storage */ }
    const s = sanitizeSettings({ ...this.game.settings, character: this.lobbyChar });
    this.game.applySettings(s);
    saveSettings(store(), s);
    this.joining = true;
    (this.el['btn-lobby-join'] as HTMLButtonElement).disabled = true;
    this.lobbyStatus('Connexion au serveur…');
    try {
      await this.game.joinOnline(name);
    } catch (err) {
      this.lobbyStatus(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.joining = false;
      (this.el['btn-lobby-join'] as HTMLButtonElement).disabled = false;
    }
  }

  /** Players list of the online menu (rebuilt only when it changes); the host gets an "Exclure" button per player. */
  private updatePlayers(): void {
    const me = this.game.myPlayerId, host = this.game.isHost;
    const list = this.game.players();
    const sig = `${host}|${me}|${list.map((p) => `${p.id}:${p.name}:${p.character}:${p.ping}:${p.connected}`).join(',')}`;
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    this.el['players-list'].innerHTML = list.map((p) => `<li class="player-row${p.id === me ? ' me' : ''}${p.connected ? '' : ' away'}">
      <span class="player-name accent-${p.character}">${ESC(p.name)}${p.id === me ? ' (vous)' : ''}</span>
      <span class="player-char">${CHARACTERS[p.character].name}</span>
      <span class="player-ping">${p.connected ? `${Math.round(p.ping)} ms` : 'déconnecté'}</span>
      ${host && p.id !== me ? `<button type="button" class="kick" data-kick="${p.id}" id="btn-kick-${p.id}">Exclure</button>` : '<span></span>'}
    </li>`).join('');
    this.text('players-count', `Joueurs connectés : ${list.filter((p) => p.connected).length} / 6`);
  }

  // ---------- maps ----------

  private toggleMap(open: boolean): void {
    if (open === this.mapOpen) return;
    if (open) {
      this.mapOpen = true;
      this.map.resetFull();
      this.game.pause(); // frees the cursor for the wheel; online the match goes on
      this.render();
      this.drawMap(true);
    } else {
      this.mapOpen = false;
      this.game.resume();
      this.render();
    }
  }

  private drawMap(full: boolean): void {
    const world = this.game.world;
    this.setHidden('minimap-box', !world);
    if (!world) return;
    const me = this.game.me();
    const f = {
      world, markers: this.game.markers(), time: this.clock,
      me: me ? { x: me.position.x, z: me.position.z, yaw: me.yaw, team: me.team } : null,
      rot: full ? 0 : mapRotation(this.game.cameraYaw, this.northUp),
    };
    if (full) this.map.drawFull(f); else this.map.drawMini(f);
  }

  // ---------- co-op / PvP HUD ----------

  private updateMode(): void {
    const mode = this.game.modeState();
    const world = this.game.world;
    const me = this.game.me();
    const v = mode && world ? modeView({
      mode, markers: this.game.markers(), squares: world.squares,
      pos: me ? { x: me.position.x, z: me.position.z } : null,
      myActorId: me?.id ?? -1, myPlayerId: this.game.myPlayerId, interactKey: this.game.keyLabels.interact,
    }) : null;

    this.setHidden('mode-board', !v?.board);
    if (v?.board) {
      this.text('mode-board-title', v.board.title);
      this.text('mode-board-hint', v.board.hint);
      this.text('mode-board-team', v.board.team ? `Vous êtes dans l’équipe ${v.board.team === 'red' ? 'rouge' : 'bleue'}` : '');
      this.el['mode-board'].className = v.board.team ? `team-${v.board.team}` : '';
      this.text('mode-board-blocked', v.board.blocked ?? '');
      this.setHidden('mode-board-blocked', !v.board.blocked);
    }
    this.setHidden('mode-countdown', !v?.countdown);
    if (v?.countdown) this.text('mode-countdown', v.countdown);
    this.setHidden('mode-objective', !v?.objective);
    if (v?.objective) {
      this.text('mode-objective-text', v.objective.text);
      this.text('mode-objective-timer', v.objective.timer ? `Temps restant ${v.objective.timer}` : '');
    }
    this.setHidden('mode-downed', !v?.downed);
    if (v?.downed) { this.text('mode-downed-text', v.downed.text); this.text('mode-downed-timer', v.downed.timer); }
    this.setHidden('mode-revive', !v?.revive);
    if (v?.revive) {
      this.text('mode-revive-text', v.revive.text);
      this.style('mode-revive-fill', 'transform', `scaleX(${v.revive.progress.toFixed(3)})`);
    }
    this.setHidden('pvp-score', !v?.pvp);
    this.el['hud-lock'].classList.toggle('below-score', !!v?.pvp);
    if (v?.pvp) {
      this.text('pvp-score-red', String(v.pvp.red));
      this.text('pvp-score-blue', String(v.pvp.blue));
      this.text('pvp-round', v.pvp.round);
      this.text('pvp-timer', v.pvp.timer);
    }
    this.updateMates(mode, me);
    this.updateKillFeed(mode);
    this.updateResults(mode);
  }

  /** PvP: HP bars of the local player's teammates. */
  private updateMates(mode: ModeState | null, me: ReturnType<UiGame['me']>): void {
    const pvpOn = mode?.pvp.phase === 'running' && !!me;
    const mates = pvpOn ? this.game.views().filter((a) => a.kind === 'player' && a.id !== me!.id && a.team === me!.team && !a.removed) : [];
    const layer = this.el['pvp-mates'];
    this.setHidden('pvp-mates', mates.length === 0);
    while (this.mateBars.length < mates.length) {
      const root = document.createElement('div');
      root.className = 'mate';
      root.innerHTML = '<span class="mate-name"></span><div class="bar"><div class="fill"></div></div>';
      layer.appendChild(root);
      this.mateBars.push({ root, name: root.querySelector('.mate-name')!, fill: root.querySelector('.fill')! });
    }
    this.mateBars.forEach((b, i) => {
      const a = mates[i];
      b.root.hidden = !a;
      if (!a) return;
      if (b.name.textContent !== a.name) b.name.textContent = a.name;
      b.fill.style.transform = `scaleX(${pct(a.hp, a.maxHp).toFixed(3)})`;
      b.root.classList.toggle('ko', a.hp <= 0);
    });
  }

  private updateKillFeed(mode: ModeState | null): void {
    const feed = mode?.pvp.phase === 'running' ? mode.pvp.killFeed : [];
    const sig = feed.map((k) => `${k.killer}>${k.victim}@${k.time}`).join('|');
    this.setHidden('pvp-killfeed', feed.length === 0);
    if (this.written.get('killfeed') === sig) return;
    this.written.set('killfeed', sig);
    this.el['pvp-killfeed'].innerHTML = feed.map((k) => `<li><b>${ESC(k.killer)}</b> a mis K.O. <b>${ESC(k.victim)}</b></li>`).join('');
  }

  /** Co-op and PvP results screens (built once per result, countdown updated each frame). */
  private updateResults(mode: ModeState | null): void {
    const coop = mode?.coop.phase === 'results' ? mode.coop : null;
    const pvp = mode?.pvp.phase === 'results' ? mode.pvp : null;
    this.setHidden('coop-results', !coop?.results);
    this.setHidden('pvp-results', !pvp?.results);
    if (coop?.results) {
      const r = coop.results;
      this.text('coop-results-title', r.victory ? 'Mission accomplie !' : 'Mission échouée…');
      this.el['coop-results-title'].className = `brush ${r.victory ? 'win' : 'lose'}`;
      this.text('coop-results-sub', `${coop.title} — temps ${formatTime(r.time)}`);
      this.table('coop-results-table', ['Joueur', 'Ennemis vaincus', 'Alliés relevés'], r.players.map((p) => [p.name, p.kills, p.revives]));
      this.text('coop-results-return', `Retour au village dans ${Math.ceil(coop.countdown)} s`);
    }
    if (pvp?.results) {
      const r = pvp.results;
      const mine = r.players.find((p) => p.id === this.game.myPlayerId)?.team;
      this.text('pvp-results-title', mine ? (mine === r.winner ? 'Victoire !' : 'Défaite…') : `Victoire de l’équipe ${r.winner === 'red' ? 'rouge' : 'bleue'}`);
      this.el['pvp-results-title'].className = `brush ${!mine || mine === r.winner ? 'win' : 'lose'}`;
      this.text('pvp-results-sub', `Manches : Rouge ${r.rounds.red} – ${r.rounds.blue} Bleu`);
      this.table('pvp-results-table', ['Joueur', 'Équipe', 'Dégâts', 'K.O.'],
        r.players.map((p) => [p.name, p.team === 'red' ? 'Rouge' : 'Bleu', Math.round(p.damage), p.kos]));
      this.text('pvp-results-return', pvp.countdown > 0 ? `Retour au carré dans ${Math.ceil(pvp.countdown)} s` : '');
    }
  }

  private table(id: string, head: string[], rows: (string | number)[][]): void {
    const html = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${ESC(String(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    if (this.written.get(id) === html) return;
    this.written.set(id, html);
    this.el[id].innerHTML = html;
  }

  private pickCharacter(id: CharacterId): void {
    this.pendingChar = id;
    for (const c of CHARACTER_IDS) this.el[`char-${c}`].setAttribute('aria-pressed', String(c === id));
  }

  /** Applies + persists the highlighted character; from the menu, continues to the controls card. */
  private confirmCharacter(): void {
    const s = sanitizeSettings({ ...this.game.settings, character: this.pendingChar });
    this.game.applySettings(s); // calls game.selectCharacter
    saveSettings(browserStorage(), s);
    this.openOverlay(this.overlayFromMenu ? 'controls' : null);
  }

  private fillControls(): void {
    const k = this.game.keyLabels;
    const list = this.el['controls-list'];
    list.textContent = '';
    for (const [action, label] of COMMANDS) {
      const row = document.createElement('li');
      const key = document.createElement('kbd');
      const c = CHARACTERS[this.game.character];
      const charged = c.special !== 'sharingan';
      key.textContent = action === 'move' ? `${k.forward} ${k.left} ${k.back} ${k.right}`
        : action === 'climb' ? `${k.forward} → mur` : action === 'map' ? 'M' : action === 'special' && charged ? `${k.special} (maintenir)` : k[action];
      const desc = document.createElement('span');
      desc.textContent = action === 'special' ? `${c.specialLabel} — ${c.blurb}` : label;
      row.append(key, desc);
      list.appendChild(row);
    }
    this.el['controls-layout'].textContent = `Disposition du clavier : ${this.game.layout.toUpperCase()}`;
  }

  private resetRun(): void {
    this.lastHp = -1;
    this.hpTrail = 1;
    this.vignette = this.chakraFail = 0;
  }

  // ---------- settings ----------

  private fillSettingsForm(s: Settings): void {
    const f = this.form();
    f.volume.value = String(Math.round(s.masterVolume * 100));
    f.sensitivity.value = String(s.sensitivity);
    f.invert.checked = s.invertY;
    f.layout.value = s.layout;
    f.fps.checked = s.showFps;
    f.graphics.value = s.graphics;
    this.el['settings-volume-val'].textContent = `${f.volume.value} %`;
    this.el['settings-sensitivity-val'].textContent = `${s.sensitivity.toFixed(1)}×`;
  }

  private onSettingsInput(): void {
    const f = this.form();
    const s = sanitizeSettings({
      masterVolume: Number(f.volume.value) / 100,
      sensitivity: Number(f.sensitivity.value),
      invertY: f.invert.checked,
      layout: f.layout.value,
      showFps: f.fps.checked,
      graphics: f.graphics.value,
      character: this.game.settings.character,
    });
    this.game.applySettings(s);
    saveSettings(browserStorage(), s);
    this.fillSettingsForm(s);
    this.northUp = (this.el['settings-northup'] as HTMLInputElement).checked;
    try { store()?.setItem(MINIMAP.northUpStorageKey, this.northUp ? '1' : '0'); } catch { /* blocked storage */ }
  }

  private form() {
    return {
      volume: this.el['settings-volume'] as HTMLInputElement,
      sensitivity: this.el['settings-sensitivity'] as HTMLInputElement,
      invert: this.el['settings-invert'] as HTMLInputElement,
      layout: this.el['settings-layout'] as HTMLSelectElement,
      fps: this.el['settings-fps'] as HTMLInputElement,
      graphics: this.el['settings-graphics'] as HTMLSelectElement,
    };
  }

  // ---------- HUD ----------

  private updateBars(d: HudData, dt: number): void {
    const p = d.player;
    const hp = pct(p.hp, p.maxHp);
    if (this.lastHp >= 0 && p.hp < this.lastHp) {
      this.vignette = UI_CONFIG.vignetteTime;
      this.hpTrailDelay = UI_CONFIG.trailDelay;
    }
    this.lastHp = p.hp;
    if (hp >= this.hpTrail) this.hpTrail = hp;
    else if ((this.hpTrailDelay -= dt) <= 0) this.hpTrail = Math.max(hp, this.hpTrail - UI_CONFIG.trailSpeed * dt);

    this.style('hud-hp-fill', 'transform', `scaleX(${hp.toFixed(3)})`);
    this.style('hud-hp-trail', 'transform', `scaleX(${this.hpTrail.toFixed(3)})`);
    this.text('hud-hp-val', `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.el['hud-hp'].classList.toggle('low', hp < 0.3);
    this.style('hud-chakra-fill', 'transform', `scaleX(${pct(p.chakra, p.maxChakra).toFixed(3)})`);
    this.text('hud-chakra-val', `${Math.floor(p.chakra)} / ${p.maxChakra}`);
    this.el['hud-chakra'].classList.toggle('charging', p.concentrating);
    // Substitution gauge: 4 pips, each one use.
    const pips = (p.substitution / p.maxSubstitution) * 4;
    for (let i = 0; i < 4; i++) this.style(`hud-sub-${i}`, 'transform', `scaleX(${Math.min(1, Math.max(0, pips - i)).toFixed(2)})`);
    const status = p.concentrating ? 'Concentration du chakra…' : p.guarding ? 'Garde' : p.climbing ? 'Escalade' : '';
    this.text('hud-status', status);
    this.setHidden('hud-status', !status);
  }

  private updateCooldowns(d: HudData): void {
    const box = this.el['hud-cooldowns'];
    if (this.cdSlots.length !== d.cooldowns.length) {
      box.textContent = '';
      this.cdSlots = d.cooldowns.map((c) => {
        const root = document.createElement('div');
        root.className = `cd cd-${c.id}`;
        root.innerHTML = '<div class="cd-sweep"></div><span class="cd-label"></span><span class="cd-time"></span><kbd class="cd-key"></kbd><span class="cd-cost"></span>';
        box.appendChild(root);
        return { root, sweep: root.querySelector('.cd-sweep')!, time: root.querySelector('.cd-time')! };
      });
      this.written.clear();
    }
    d.cooldowns.forEach((c, i) => {
      const slot = this.cdSlots[i];
      const k = `cd${i}`;
      const statics = `${c.label}|${c.key}|${c.chakraCost}`;
      if (this.written.get(k) !== statics) {
        this.written.set(k, statics);
        slot.root.querySelector('.cd-label')!.textContent = c.label;
        slot.root.querySelector('.cd-key')!.textContent = c.key;
        slot.root.querySelector('.cd-cost')!.textContent = c.chakraCost > 0 ? `${c.chakraCost} ch.` : '';
      }
      const frac = c.total > 0 ? pct(c.remaining, c.total).toFixed(3) : '0';
      if (this.written.get(`${k}s`) !== frac) {
        this.written.set(`${k}s`, frac);
        slot.sweep.style.setProperty('--cd', frac);
      }
      const t = c.remaining > 0 ? c.remaining.toFixed(c.remaining < 1 ? 1 : 0) : '';
      if (this.written.get(`${k}t`) !== t) { this.written.set(`${k}t`, t); slot.time.textContent = t; }
      slot.root.classList.toggle('disabled', !c.usable);
    });
  }

  private updateLock(d: HudData): void {
    const t = d.lockTarget;
    this.setHidden('hud-lock', !t);
    this.setHidden('hud-crosshair', !!t);
    if (!t) return;
    this.text('hud-lock-name', t.name);
    this.style('hud-lock-fill', 'transform', `scaleX(${pct(t.hp, t.maxHp).toFixed(3)})`);
  }

  private updateEnemyBars(d: HudData): void {
    const layer = this.el['hud-enemy-bars'];
    while (this.enemyPool.length < d.enemyBars.length) {
      const root = document.createElement('div');
      root.className = 'enemy-bar';
      const fill = document.createElement('div');
      fill.className = 'enemy-bar-fill';
      root.appendChild(fill);
      layer.appendChild(root);
      this.enemyPool.push({ root, fill });
    }
    this.enemyPool.forEach((b, i) => {
      const e = d.enemyBars[i];
      b.root.hidden = !e;
      if (!e) return;
      b.root.style.transform = `translate(${e.x.toFixed(0)}px, ${e.y.toFixed(0)}px)`;
      b.fill.style.transform = `scaleX(${pct(e.hp, e.maxHp).toFixed(3)})`;
      b.root.classList.toggle('telegraph', e.telegraph);
      b.root.classList.toggle('locked', e.locked);
    });
  }

  private updateCharge(d: HudData): void {
    const c = d.charge;
    this.setHidden('hud-charge', !c);
    if (!c) return;
    const lv = Math.max(0, Math.min(1, c.level)).toFixed(3);
    const k = `charge|${c.technique}|${lv}`;
    if (this.written.get('charge') === k) return;
    this.written.set('charge', k);
    const box = this.el['hud-charge'];
    box.style.setProperty('--lv', lv);
    box.className = `tech-${c.technique}${c.level >= UI_CONFIG.chargeMaxLevel ? ' max' : ''}`;
    this.text('hud-charge-val', c.level >= UI_CONFIG.chargeMaxLevel ? 'MAX' : `${Math.round(c.level * 100)} %`);
  }

  private updateQte(d: HudData): void {
    const q = d.qte;
    this.setHidden('qte', !q);
    if (!q) { this.qteWrong = -1; return; }
    for (let i = 0; i < QTE_SLOTS; i++) {
      const b = this.el[`qte-arrow-${i}`] as HTMLButtonElement;
      const dir = q.arrows[i];
      b.hidden = !dir;
      if (!dir) continue;
      const st = qteArrowState(q, i, this.qteWrong);
      const sig = `${dir}|${st}|${q.done}`;
      if (this.written.get(b.id) === sig) continue;
      this.written.set(b.id, sig);
      b.dataset.dir = dir;
      b.className = `qte-arrow ${st}${b.classList.contains('anim') ? ' anim' : ''}`;
      b.querySelector('.qte-glyph')!.textContent = QTE_GLYPHS[dir];
      b.querySelector('.qte-mark')!.textContent = st === 'done' ? '✓' : st === 'wrong' ? '✗' : '';
      b.setAttribute('aria-label', `Flèche ${i + 1} : ${QTE_DIR_LABELS[dir]}`);
      b.disabled = q.done;
    }
    this.style('qte-timer-fill', 'transform', `scaleX(${pct(q.timeLeft, q.timeTotal).toFixed(3)})`);
    const banner = qteBanner(q);
    this.text('qte-banner', banner);
    this.setHidden('qte-banner', !banner);
    this.el['qte'].classList.toggle('done', q.done);
    this.el['qte-banner'].classList.toggle('good', q.result === 'complete');
  }

  // ---------- DOM helpers (write only on change) ----------

  private text(id: string, v: string): void {
    if (this.written.get(id) === v) return;
    this.written.set(id, v);
    this.el[id].textContent = v;
  }

  private style(id: string, prop: 'opacity' | 'transform', v: string): void {
    const k = `${id}.${prop}`;
    if (this.written.get(k) === v) return;
    this.written.set(k, v);
    this.el[id].style[prop] = v;
  }

  private setHidden(id: string, hidden: boolean): void {
    if (this.el[id].hidden !== hidden) this.el[id].hidden = hidden;
  }

  private restartAnim(e: HTMLElement): void {
    e.classList.remove('anim');
    void e.offsetWidth; // force reflow so the CSS animation replays
    e.classList.add('anim');
  }
}

const L = SETTINGS_LIMITS;
const TEMPLATE = /* html */ `
<section id="main-menu" class="screen panel" aria-labelledby="title">
  <h1 id="title" class="brush">Shinobi Arena</h1>
  <p class="tagline">L’arène des ninjas</p>
  <p id="menu-character" class="menu-character"></p>
  <div class="buttons">
    <button id="btn-play" class="primary">Solo</button>
    <button id="btn-multi" class="primary">Multijoueur</button>
    <button id="btn-controls">Commandes</button>
    <button id="btn-settings-main">Paramètres</button>
  </div>
</section>

<section id="lobby-panel" class="screen panel scroll" hidden aria-labelledby="lobby-title">
  <h2 id="lobby-title" class="brush">Multijoueur</h2>
  <div class="field lobby-field">
    <label for="lobby-name">Nom du joueur</label>
    <input id="lobby-name" type="text" maxlength="${MINIMAP.nameMaxLength}" autocomplete="nickname" spellcheck="false" />
  </div>
  <div class="lobby-chars" role="group" aria-label="Personnage">
    ${CHARACTER_IDS.map((id) => `<button id="lobby-char-${id}" type="button" class="lobby-char accent-${id}" aria-pressed="false">${CHARACTERS[id].name}<small>${CHARACTERS[id].specialLabel}</small></button>`).join('')}
  </div>
  <p class="muted">Le jeu en ligne fonctionne quand la page est servie par l’hôte (commande « npm run host »). Jusqu’à 6 joueurs ; plusieurs joueurs peuvent choisir le même ninja.</p>
  <p id="lobby-status" role="status" aria-live="polite"></p>
  <div class="buttons row">
    <button id="btn-lobby-join" class="primary">Rejoindre</button>
    <button id="btn-lobby-back">Retour</button>
  </div>
</section>

<section id="char-panel" class="screen panel scroll" hidden aria-labelledby="char-title">
  <h2 id="char-title" class="brush">Choisissez votre ninja</h2>
  <div class="char-cards" role="group" aria-label="Personnages">
    ${CHARACTER_IDS.map((id) => `<button id="char-${id}" class="char-card accent-${id}" aria-pressed="false">
      <span class="char-name">${CHARACTERS[id].name}</span>
      <span class="char-special">${CHARACTERS[id].specialLabel}</span>
      <span class="char-blurb">${CHARACTERS[id].blurb}</span>
    </button>`).join('')}
  </div>
  <p class="muted">Flèches ou souris pour choisir, Entrée pour sélectionner.</p>
  <div class="buttons row">
    <button id="btn-char-confirm" class="primary">Continuer</button>
    <button id="btn-char-back">Retour</button>
  </div>
</section>

<section id="controls-panel" class="screen panel scroll" hidden aria-labelledby="controls-title">
  <h2 id="controls-title" class="brush">Commandes</h2>
  <p class="goal">Explorez le village. Entrez dans le <strong>carré bleu</strong> devant le QG pour lancer une mission, ou dans un <strong>carré rouge / bleu</strong> pour un combat entre joueurs.</p>
  <ul id="controls-list" class="controls"></ul>
  <p id="controls-layout" class="muted"></p>
  <p class="muted">Cliquez dans le jeu pour capturer la souris. Échap met le jeu en pause.</p>
  <div class="buttons row">
    <button id="btn-start-fight" class="primary">Commencer</button>
    <button id="btn-controls-back">Retour</button>
  </div>
</section>

<section id="settings-panel" class="screen panel scroll" hidden aria-labelledby="settings-title">
  <h2 id="settings-title" class="brush">Paramètres</h2>
  <div class="field">
    <label for="settings-volume">Volume général</label>
    <input id="settings-volume" type="range" min="${L.masterVolume.min * 100}" max="${L.masterVolume.max * 100}" step="1" />
    <output id="settings-volume-val"></output>
  </div>
  <div class="field">
    <label for="settings-sensitivity">Sensibilité de la caméra</label>
    <input id="settings-sensitivity" type="range" min="${L.sensitivity.min}" max="${L.sensitivity.max}" step="${L.sensitivity.step}" />
    <output id="settings-sensitivity-val"></output>
  </div>
  <div class="field">
    <label for="settings-invert">Inverser l’axe vertical</label>
    <input id="settings-invert" type="checkbox" />
  </div>
  <div class="field">
    <label for="settings-layout">Disposition du clavier</label>
    <select id="settings-layout">
      <option value="auto">Automatique</option>
      <option value="qwerty">QWERTY</option>
      <option value="azerty">AZERTY</option>
    </select>
  </div>
  <div class="field">
    <label for="settings-graphics">Qualité graphique</label>
    <select id="settings-graphics">
      <option value="high">Élevée (contours, bloom)</option>
      <option value="low">Basse (performances)</option>
    </select>
  </div>
  <div class="field">
    <label for="settings-northup">Minimap orientée nord</label>
    <input id="settings-northup" type="checkbox" />
  </div>
  <div class="field">
    <label for="settings-fps">Afficher les FPS</label>
    <input id="settings-fps" type="checkbox" />
  </div>
  <div class="buttons row"><button id="btn-settings-back" class="primary">Retour</button></div>
</section>

<section id="pause-menu" class="screen panel" hidden aria-labelledby="pause-title">
  <h2 id="pause-title" class="brush">Pause</h2>
  <div class="buttons">
    <button id="btn-resume" class="primary">Reprendre</button>
    <button id="btn-restart">Recommencer</button>
    <button id="btn-settings">Paramètres</button>
    <button id="btn-controls-pause">Commandes</button>
    <button id="btn-menu">Menu principal</button>
  </div>
  <div id="pause-online" hidden>
    <p class="online-note">La partie continue</p>
    <p id="players-count" class="muted"></p>
    <ul id="players-list" class="players"></ul>
  </div>
</section>

<section id="fullmap" hidden aria-label="Carte du monde">
  <canvas id="fullmap-canvas"></canvas>
  <div class="fullmap-bar"><span>Carte — molette : zoom · <kbd>M</kbd> / <kbd>Échap</kbd> : fermer</span><button id="btn-fullmap-close">Fermer</button></div>
</section>

<div id="hud" hidden>
  <div id="hud-vignette"></div>
  <div id="hud-enemy-bars"></div>
  <div id="hud-crosshair"></div>
  <div id="hud-charge" hidden><div class="charge-ring"></div><span id="hud-charge-val"></span></div>
  <div id="hud-lock" hidden><span id="hud-lock-name"></span><div class="bar"><div id="hud-lock-fill" class="fill"></div></div></div>
  <div id="minimap-box" hidden><canvas id="minimap" width="${MINIMAP.sizePx}" height="${MINIMAP.sizePx}" aria-label="Minimap"></canvas><kbd class="minimap-key">M</kbd></div>
  <div id="mode-objective" hidden><div id="mode-objective-text"></div><div id="mode-objective-timer"></div></div>
  <div id="pvp-score" hidden>
    <span class="pvp-team red">Rouge <b id="pvp-score-red"></b></span>
    <span class="pvp-mid"><span id="pvp-round"></span><span id="pvp-timer"></span></span>
    <span class="pvp-team blue"><b id="pvp-score-blue"></b> Bleu</span>
  </div>
  <div id="pvp-mates" hidden></div>
  <ul id="pvp-killfeed" hidden></ul>
  <div id="mode-board" hidden><div id="mode-board-title"></div><div id="mode-board-team"></div><div id="mode-board-hint"></div><div id="mode-board-blocked" hidden></div></div>
  <div id="mode-countdown" hidden></div>
  <div id="mode-downed" hidden><div id="mode-downed-text"></div><div id="mode-downed-timer"></div></div>
  <div id="mode-revive" hidden><div id="mode-revive-text"></div><div class="bar"><div id="mode-revive-fill" class="fill"></div></div></div>
  <section id="coop-results" class="screen results" hidden aria-labelledby="coop-results-title">
    <h2 id="coop-results-title" class="brush"></h2><p id="coop-results-sub"></p>
    <table id="coop-results-table" class="results-table"></table><p id="coop-results-return" class="muted"></p>
  </section>
  <section id="pvp-results" class="screen results" hidden aria-labelledby="pvp-results-title">
    <h2 id="pvp-results-title" class="brush"></h2><p id="pvp-results-sub"></p>
    <table id="pvp-results-table" class="results-table"></table><p id="pvp-results-return" class="muted"></p>
  </section>
  <div id="hud-player">
    <div id="hud-hp" class="bar big"><div id="hud-hp-trail" class="trail"></div><div id="hud-hp-fill" class="fill"></div><span id="hud-hp-val" class="val"></span></div>
    <div id="hud-chakra" class="bar big"><div id="hud-chakra-fill" class="fill"></div><span id="hud-chakra-val" class="val"></span></div>
    <div id="hud-sub" title="Permutation (C quand vous êtes touché)"><span class="sub-label">Permutation</span>${[0, 1, 2, 3].map((i) => `<span class="sub-pip"><span id="hud-sub-${i}" class="sub-fill"></span></span>`).join('')}</div>
    <div id="hud-chakra-msg" hidden>Chakra insuffisant</div>
    <div id="hud-status" hidden></div>
  </div>
  <div id="hud-cooldowns"></div>
  <div id="hud-fps" hidden></div>
  <div id="qte" hidden role="dialog" aria-labelledby="qte-title">
    <div id="qte-title">Saisie ! Flèches du clavier (ou ZQSD / WASD) ou clic, dans l’ordre</div>
    <div class="qte-timer"><div id="qte-timer-fill"></div></div>
    <div class="qte-arrows">${Array.from({ length: QTE_SLOTS }, (_, i) => `<button id="qte-arrow-${i}" class="qte-arrow" type="button"><span class="qte-glyph"></span><span class="qte-mark"></span></button>`).join('')}</div>
    <div id="qte-banner" hidden></div>
  </div>
</div>
`;
