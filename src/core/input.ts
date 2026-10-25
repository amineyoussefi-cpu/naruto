/**
 * Keyboard + mouse input. Bindings use KeyboardEvent.code (physical key position),
 * so WASD on QWERTY and ZQSD on AZERTY are the same physical keys.
 * Edge-triggered actions are queued until the next simulation step consumes them.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'sprint' | 'jump' | 'attack' | 'guard' | 'special' | 'kunai'
  | 'concentrate' | 'dodge' | 'lockOn' | 'switchTarget' | 'pause'
  /** Synthetic: forward pressed twice quickly (no key of its own). */
  | 'boost';

export const KEY_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  attack: ['Mouse0'],
  guard: ['Mouse2'],
  special: ['KeyE'],
  kunai: ['KeyQ', 'Mouse1'],
  concentrate: ['KeyR'],
  dodge: ['KeyC'],
  lockOn: ['KeyF'],
  switchTarget: ['Tab', 'WheelUp', 'WheelDown'],
  pause: ['Escape', 'KeyP'],
  boost: [],
};

/** Max delay between two forward presses that counts as a double tap (ms). */
export const DOUBLE_TAP_MS = 300;

/** Key labels per layout for the help screens (UI is in French). */
export const KEY_LABELS: Record<'qwerty' | 'azerty', Record<Action, string>> = {
  qwerty: {
    forward: 'W', back: 'S', left: 'A', right: 'D', sprint: 'Maj', jump: 'Espace',
    attack: 'Clic gauche', guard: 'Clic droit', special: 'E', kunai: 'Q / Clic molette',
    concentrate: 'R (maintenir)', dodge: 'C', lockOn: 'F', switchTarget: 'Tab / Molette', pause: 'Échap / P',
    boost: 'W W (maintenir)',
  },
  azerty: {
    forward: 'Z', back: 'S', left: 'Q', right: 'D', sprint: 'Maj', jump: 'Espace',
    attack: 'Clic gauche', guard: 'Clic droit', special: 'E', kunai: 'A / Clic molette',
    concentrate: 'R (maintenir)', dodge: 'C', lockOn: 'F', switchTarget: 'Tab / Molette', pause: 'Échap / P',
    boost: 'Z Z (maintenir)',
  },
};

export class InputManager {
  private held = new Set<string>();
  private pressedQueue = new Set<Action>();
  private codeToActions = new Map<string, Action[]>();
  private lastForwardPress = -Infinity;
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  /** When false, game inputs are ignored (menus open). */
  enabled = false;
  private disposers: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      for (const code of codes) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
    const on = <K extends keyof WindowEventMap | "visibilitychange">(t: Window | HTMLElement | Document, type: K, fn: (e: K extends keyof WindowEventMap ? WindowEventMap[K] : Event) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => {
      if (this.codeToActions.has(e.code) && this.enabled && (e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
      if (e.repeat) return;
      this.down(e.code);
    });
    on(window, 'keyup', (e) => this.up(e.code));
    on(target, 'mousedown', (e) => this.down(`Mouse${e.button}`));
    on(window, 'mouseup', (e) => this.up(`Mouse${e.button}`));
    on(target, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.target) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(target, 'wheel', (e) => {
      if (!this.enabled) return;
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      this.down(code);
      this.up(code);
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    // Losing focus would otherwise leave keys stuck down.
    on(window, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  /** Pause key is reported even when input is disabled so menus can close. */
  onPause: (() => void) | null = null;

  private down(code: string): void {
    const actions = this.codeToActions.get(code);
    if (!actions) return;
    if (actions.includes('pause')) { this.onPause?.(); return; }
    if (!this.enabled) return;
    if (!this.held.has(code)) {
      for (const a of actions) this.pressedQueue.add(a);
      if (actions.includes('forward')) {
        // Input timing only (not simulation): a quick second tap means "run faster".
        const now = performance.now();
        if (now - this.lastForwardPress < DOUBLE_TAP_MS) this.pressedQueue.add('boost');
        this.lastForwardPress = now;
      }
    }
    this.held.add(code);
  }

  private up(code: string): void {
    this.held.delete(code);
  }

  isHeld(action: Action): boolean {
    if (!this.enabled) return false;
    return KEY_BINDINGS[action].some((c) => this.held.has(c));
  }

  /** Movement axes in [-1,1]: x = right, y = forward. */
  moveAxes(): { x: number; y: number } {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('forward') ? 1 : 0) - (this.isHeld('back') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  /** Returns and clears the actions pressed since the last call. Called once per simulation step. */
  consumePressed(): ReadonlySet<Action> {
    const out = new Set(this.pressedQueue);
    this.pressedQueue.clear();
    return out;
  }

  /** Returns and clears accumulated mouse movement (pixels). Called once per render frame. */
  consumeMouse(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  /** Clears every held key and pending press (focus loss, pause, resume). */
  releaseAll(): void {
    this.held.clear();
    this.pressedQueue.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }

  requestPointerLock(): void {
    // Some browsers reject without a user gesture; the game still works, just without lock.
    try {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch { /* ignore */ }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
