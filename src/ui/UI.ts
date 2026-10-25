import type { GameApi } from '../game/Game';

/**
 * DOM UI: main menu, controls help, HUD, pause, settings, victory/defeat.
 * Owner: UI agent. STUB: a start button so the loop can be exercised.
 */
export class UI {
  constructor(private readonly root: HTMLElement, private readonly game: GameApi) {
    const btn = document.createElement('button');
    btn.id = 'btn-play';
    btn.textContent = 'Play';
    btn.onclick = () => { btn.remove(); this.game.start(); };
    root.appendChild(btn);
  }
  update(_frameDt: number): void { void this.root; }
}
