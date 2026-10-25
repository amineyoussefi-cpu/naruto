import type { GameApi } from '../game/Game';
import type { CharacterId, GameState, HudData, QteDir } from '../core/types';
import { SETTINGS_LIMITS, UI_CONFIG, type Settings } from '../config/settings';
import { CHARACTERS, CHARACTER_IDS } from '../config/characters';
import { browserStorage, loadSettings, sanitizeSettings, saveSettings } from './settingsStore';
import { QTE_DIR_LABELS, QTE_GLYPHS, qteArrowState, qteBanner } from './qteView';

type Overlay = 'character' | 'controls' | 'settings' | null;

/** Help rows; 'special' text comes from the selected character. */
const COMMANDS: [keyof GameApi['keyLabels'] | 'move' | 'climb', string][] = [
  ['move', 'Se déplacer'], ['boost', 'Double appui avant et maintenir : course ultra-rapide'],
  ['sprint', 'Appui : ruée de chakra (dash) vers la cible · maintenu : course ninja'],
  ['jump', 'Sauter, double saut en l’air'], ['climb', 'Courez contre un mur : escalade automatique et rapide'],
  ['attack', 'Combo de 5 coups à tête chercheuse (le dernier projette l’ennemi)'], ['guard', 'Garde'], ['special', ''],
  ['grab', 'Saisie : clic gauche + droit ensemble, puis cliquez les 6 flèches dans l’ordre'],
  ['kunai', 'Lancer un kunaï (visée assistée si la cible est en vue)'], ['concentrate', 'Concentrer le chakra'],
  ['dodge', 'Esquive · quand vous êtes touché : permutation (substitution)'],
  ['lockOn', 'Verrouiller une cible'], ['switchTarget', 'Changer de cible'], ['pause', 'Pause'],
];
const QTE_SLOTS = 6; // arrow buttons in the template (#qte-arrow-0..5)

const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

/**
 * DOM UI: main menu, controls help, HUD, pause, settings, victory/defeat.
 * Owner: UI agent. Reads the game only through GameApi.
 */
export class UI {
  private readonly el: Record<string, HTMLElement> = {};
  private overlay: Overlay = null;
  /** Where the controls card was opened from (shows "Commencer" only from the menu). */
  private overlayFromMenu = false;
  private wavesCleared = 0;
  private lastHp = -1;
  private hpTrail = 1;
  private hpTrailDelay = 0;
  private vignette = 0;
  private chakraFail = 0;
  private banner = 0;
  /** Last written text/style per key, so update() only touches the DOM on change. */
  private readonly written = new Map<string, string>();
  private readonly enemyPool: { root: HTMLElement; fill: HTMLElement }[] = [];
  private cdSlots: { root: HTMLElement; sweep: HTMLElement; time: HTMLElement }[] = [];
  /** Character highlighted on the selection screen (applied on confirm). */
  private pendingChar: CharacterId = 'naruto';
  /** Index of the last wrong arrow click in the current grab sequence (-1 if none). */
  private qteWrong = -1;

  constructor(private readonly root: HTMLElement, private readonly game: GameApi) {
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>('[id]').forEach((n) => { this.el[n.id] = n; });

    const settings = loadSettings(browserStorage());
    this.game.applySettings(settings);
    this.fillSettingsForm(settings);

    const click = (id: string, fn: () => void) => this.el[id].addEventListener('click', () => { this.game.uiClick(); fn(); });
    click('btn-play', () => this.openOverlay('character', true));
    click('btn-char-victory', () => this.openOverlay('character', false));
    click('btn-char-defeat', () => this.openOverlay('character', false));
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
    click('btn-retry', () => { this.resetRun(); this.game.restart(); });
    click('btn-retry-defeat', () => { this.resetRun(); this.game.restart(); });
    click('btn-victory-menu', () => this.game.quitToMenu());
    click('btn-defeat-menu', () => this.game.quitToMenu());
    click('btn-controls-back', () => this.openOverlay(null));
    click('btn-settings-back', () => this.openOverlay(null));
    this.el['settings-panel'].addEventListener('input', () => this.onSettingsInput());
    this.el['settings-panel'].addEventListener('change', () => this.onSettingsInput());

    window.addEventListener('keydown', (e) => {
      // The game only handles Escape while playing/paused; close menu overlays ourselves.
      const st = this.game.state;
      if (e.code === 'Escape' && this.overlay && (st === 'menu' || st === 'victory' || st === 'defeat')) this.openOverlay(null);
    });

    const ev = this.game.events;
    ev.on('stateChange', () => {
      this.overlay = null;
      this.render();
    });
    ev.on('waveCleared', (e) => { this.wavesCleared = Math.max(this.wavesCleared, e.wave); });
    ev.on('waveStart', (e) => {
      this.el['hud-banner'].textContent = e.wave === e.totalWaves ? `Vague finale ${e.wave}/${e.totalWaves}` : `Vague ${e.wave}/${e.totalWaves}`;
      this.banner = UI_CONFIG.bannerTime;
      this.restartAnim(this.el['hud-banner']);
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
    if (this.game.state !== 'playing') return;
    const d = this.game.getHudData();
    if (s.showFps) this.text('hud-fps', `${Math.round(d.fps)} FPS`);
    this.updateBars(d, frameDt);
    this.updateCooldowns(d);
    this.updateWave(d);
    this.updateLock(d);
    this.updateEnemyBars(d);
    this.updateCharge(d);
    this.updateQte(d);

    this.vignette = Math.max(0, this.vignette - frameDt);
    this.style('hud-vignette', 'opacity', (this.vignette / UI_CONFIG.vignetteTime).toFixed(2));
    this.chakraFail = Math.max(0, this.chakraFail - frameDt);
    this.setHidden('hud-chakra-msg', this.chakraFail <= 0);
    this.el['hud-chakra'].classList.toggle('fail', this.chakraFail > 0);
    this.banner = Math.max(0, this.banner - frameDt);
    this.setHidden('hud-banner', this.banner <= 0);
  }

  // ---------- screens ----------

  private render(): void {
    const st: GameState = this.game.state;
    const ov = this.overlay;
    this.setHidden('main-menu', st !== 'menu' || ov !== null);
    this.setHidden('hud', st !== 'playing');
    this.setHidden('pause-menu', st !== 'paused' || ov !== null);
    this.setHidden('victory-screen', st !== 'victory' || ov !== null);
    this.setHidden('defeat-screen', st !== 'defeat' || ov !== null);
    this.setHidden('char-panel', ov !== 'character');
    this.setHidden('controls-panel', ov !== 'controls');
    this.setHidden('settings-panel', ov !== 'settings');
    this.setHidden('btn-start-fight', !this.overlayFromMenu);
    this.root.classList.toggle('dim', st !== 'playing');
    const c = CHARACTERS[this.game.character];
    this.el['menu-character'].textContent = `Personnage : ${c.name} — ${c.specialLabel}`;
    this.el['menu-character'].className = `menu-character accent-${this.game.character}`;
    this.el['btn-char-confirm'].textContent = this.overlayFromMenu ? 'Continuer' : 'Valider';

    const n = this.wavesCleared;
    if (st === 'victory') this.el['victory-stats'].textContent = `Les ${n || 'cinq'} vagues ont été repoussées. Le village est sauf.`;
    if (st === 'defeat') this.el['defeat-stats'].textContent = n > 0 ? `Vagues franchies : ${n}` : 'Aucune vague franchie.';

    if (ov === 'character') { this.el[`char-${this.pendingChar}`].focus(); return; }
    const visible = ['controls-panel', 'settings-panel', 'main-menu', 'pause-menu', 'victory-screen', 'defeat-screen']
      .map((id) => this.el[id]).find((e) => !e.hidden);
    visible?.querySelector<HTMLElement>('button:not([hidden]), input, select')?.focus();
  }

  private openOverlay(ov: Overlay, fromMenu = this.overlayFromMenu): void {
    this.overlay = ov;
    this.overlayFromMenu = fromMenu;
    if (ov === 'controls') this.fillControls();
    if (ov === 'character') this.pickCharacter(this.game.character);
    this.render();
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
        : action === 'climb' ? `${k.forward} → mur` : action === 'special' && charged ? `${k.special} (maintenir)` : k[action];
      const desc = document.createElement('span');
      desc.textContent = action === 'special' ? `${c.specialLabel} — ${c.blurb}` : label;
      row.append(key, desc);
      list.appendChild(row);
    }
    this.el['controls-layout'].textContent = `Disposition du clavier : ${this.game.layout.toUpperCase()}`;
  }

  private resetRun(): void {
    this.wavesCleared = 0;
    this.lastHp = -1;
    this.hpTrail = 1;
    this.vignette = this.chakraFail = this.banner = 0;
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

  private updateWave(d: HudData): void {
    this.text('hud-wave', d.wave > 0 ? `Vague ${d.wave}/${d.totalWaves}` : 'Préparez-vous');
    this.text('hud-enemies', `Ennemis restants : ${d.enemiesRemaining}`);
    const inter = d.intermission > 0;
    this.setHidden('hud-intermission', !inter);
    if (inter) this.text('hud-intermission', `Prochaine vague dans ${Math.ceil(d.intermission)}`);
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
    <button id="btn-play" class="primary">Jouer</button>
    <button id="btn-controls">Commandes</button>
    <button id="btn-settings-main">Paramètres</button>
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
  <p class="goal">Objectif : <strong>Survivez aux 5 vagues</strong> de ninjas ennemis.</p>
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
</section>

<section id="victory-screen" class="screen panel" hidden aria-labelledby="victory-title">
  <h2 id="victory-title" class="brush win">Victoire !</h2>
  <p id="victory-stats"></p>
  <div class="buttons">
    <button id="btn-retry" class="primary">Recommencer</button>
    <button id="btn-char-victory">Changer de personnage</button>
    <button id="btn-victory-menu">Menu principal</button>
  </div>
</section>

<section id="defeat-screen" class="screen panel" hidden aria-labelledby="defeat-title">
  <h2 id="defeat-title" class="brush lose">Défaite…</h2>
  <p id="defeat-stats"></p>
  <div class="buttons">
    <button id="btn-retry-defeat" class="primary">Recommencer</button>
    <button id="btn-char-defeat">Changer de personnage</button>
    <button id="btn-defeat-menu">Menu principal</button>
  </div>
</section>

<div id="hud" hidden>
  <div id="hud-vignette"></div>
  <div id="hud-enemy-bars"></div>
  <div id="hud-crosshair"></div>
  <div id="hud-charge" hidden><div class="charge-ring"></div><span id="hud-charge-val"></span></div>
  <div id="hud-lock" hidden><span id="hud-lock-name"></span><div class="bar"><div id="hud-lock-fill" class="fill"></div></div></div>
  <div id="hud-banner" hidden></div>
  <div id="hud-wavebox">
    <div id="hud-wave"></div>
    <div id="hud-enemies"></div>
    <div id="hud-intermission" hidden></div>
  </div>
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
    <div id="qte-title">Saisie ! Cliquez les flèches dans l’ordre</div>
    <div class="qte-timer"><div id="qte-timer-fill"></div></div>
    <div class="qte-arrows">${Array.from({ length: QTE_SLOTS }, (_, i) => `<button id="qte-arrow-${i}" class="qte-arrow" type="button"><span class="qte-glyph"></span><span class="qte-mark"></span></button>`).join('')}</div>
    <div id="qte-banner" hidden></div>
  </div>
</div>
`;
