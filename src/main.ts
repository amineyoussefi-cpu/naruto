import './ui/styles.css';
import { Game } from './game/Game';
import { UI } from './ui/UI';
import { detectLayout } from './core/layout';

async function boot(): Promise<void> {
  const host = document.getElementById('app')!;
  const uiRoot = document.getElementById('ui')!;
  const game = await Game.create(host);
  game.detectedLayout = await detectLayout();
  const ui = new UI(uiRoot, game);
  document.getElementById('loading')?.remove();
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    game.frame(dt);
    ui.update(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Exposed for end-to-end tests and debugging.
  (window as unknown as { __game: Game }).__game = game;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
