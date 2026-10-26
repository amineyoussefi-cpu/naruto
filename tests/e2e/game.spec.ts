import { expect, test, type Page } from '@playwright/test';

type Vec = { x: number; y: number; z: number };
/** Typed access to the debug hook exposed by main.ts (solo: the simulation runs in the page). */
type DebugGame = {
  state: string;
  world: { squares: { id: string; center: Vec; size: number }[] };
  modeState(): { coop: { phase: string; results: { victory: boolean } | null } };
  markers(): { kind: string }[];
  debugCommand(msg: unknown): void;
  getHudData(): { qte: { arrows: string[] } | null };
  debug(): {
    ctx: {
      time: number;
      player: { position: Vec & { clone(): Vec }; fighter: { hp: number; maxHp: number } };
      actors: { team: string; alive: boolean; position: Vec }[];
      enemies(): unknown[];
      combat: { dealDamage(src: unknown, dst: unknown, dmg: number, kb: number, kind: string, at: unknown): void };
      spawnEnemy(kind: string, feet: unknown, mods: unknown): unknown;
    };
    camera: { yaw: number };
  };
  events: { on(type: string, fn: (p: unknown) => void): void };
};
declare global { interface Window { __game: DebugGame; __log: string[] } }

const state = (page: Page) => page.evaluate(() => window.__game.state);
const coopPhase = (page: Page) => page.evaluate(() => window.__game.modeState().coop.phase);

async function startGame(page: Page) {
  await page.goto('/');
  await page.locator('#btn-play').click();
  await page.locator('#btn-char-confirm').click(); // character selection (Naruto pre-selected)
  await page.locator('#btn-start-fight').click();
  await expect.poll(() => state(page)).toBe('playing');
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#minimap')).toBeVisible();
}

test('solo: free roam → pause freezes → co-op square → mission with enemy groups → victory → free roam → menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page);
  await page.evaluate(() => {
    window.__log = [];
    for (const t of ['attackStart', 'damage']) window.__game.events.on(t, () => window.__log.push(t));
  });

  // Movement on the ground (not through it).
  const p0 = await page.evaluate(() => ({ ...window.__game.debug().ctx.player.position }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => ({ ...window.__game.debug().ctx.player.position }));
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(1);
  expect(Math.abs(p1.y - p0.y)).toBeLessThan(3);

  // Melee attack.
  await page.mouse.click(640, 360);
  await expect.poll(() => page.evaluate(() => window.__log.includes('attackStart'))).toBe(true);
  if ((await state(page)) === 'paused') await page.locator('#btn-resume').click(); // pointer-lock quirks in headless

  // Pause freezes simulation time and every actor.
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toBe('paused');
  await expect(page.locator('#pause-menu')).toBeVisible();
  const frozen = await page.evaluate(() => JSON.stringify({ t: window.__game.debug().ctx.time, a: window.__game.debug().ctx.actors.map((a) => a.position) }));
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => JSON.stringify({ t: window.__game.debug().ctx.time, a: window.__game.debug().ctx.actors.map((a) => a.position) }));
  expect(after).toBe(frozen);
  await page.locator('#btn-resume').click();
  await expect.poll(() => state(page)).toBe('playing');

  // Into the co-op square: board, countdown, mission with enemy group markers.
  expect(await page.evaluate(() => window.__game.debug().ctx.enemies().length)).toBe(0); // free roam: no enemies
  await page.evaluate(() => {
    const sq = window.__game.world.squares.find((s) => s.id === 'coop-hq')!;
    window.__game.debugCommand({ t: 'debug', op: 'teleport', x: sq.center.x, y: sq.center.y + 0.3, z: sq.center.z });
  });
  await expect(page.locator('#mode-board')).toBeVisible();
  await expect.poll(() => coopPhase(page), { timeout: 10_000 }).toBe('countdown');
  await expect(page.locator('#mode-countdown')).toBeVisible();
  await expect.poll(() => coopPhase(page), { timeout: 10_000 }).toBe('running');
  await expect.poll(() => page.evaluate(() => window.__game.markers().filter((m) => m.kind === 'group').length)).toBeGreaterThan(1);
  await expect(page.locator('#mode-objective')).toBeVisible();

  // Defeat every group (waves included) → victory results → free roam again at full health.
  await expect.poll(async () => {
    await page.evaluate(() => {
      const { ctx } = window.__game.debug();
      for (const e of ctx.enemies()) ctx.combat.dealDamage(ctx.player, e, 99999, 0, 'combo3', ctx.player.position);
    });
    return coopPhase(page);
  }, { timeout: 90_000, intervals: [500] }).toBe('results');
  expect(await page.evaluate(() => window.__game.modeState().coop.results?.victory)).toBe(true);
  await expect(page.locator('#coop-results')).toBeVisible();
  await expect.poll(() => coopPhase(page), { timeout: 20_000 }).toBe('idle');
  expect(await page.evaluate(() => { const f = window.__game.debug().ctx.player.fighter; return f.hp === f.maxHp; })).toBe(true);

  // Back to the menu.
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toBe('paused');
  await page.locator('#btn-menu').click();
  await expect.poll(() => state(page)).toBe('menu');
  await expect(page.locator('#btn-play')).toBeVisible();
  expect(errors).toEqual([]);
});

test('grab sequence: left+right click grabs, keyboard arrows and ZQSD/WASD answer, sequence completes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page);
  const results: string[] = [];
  await page.exposeFunction('__grabEnd', (r: string) => results.push(r));
  await page.evaluate(() => {
    window.__game.events.on('grabEnd', (e) => (window as unknown as { __grabEnd(r: string): void }).__grabEnd((e as { result: string }).result));
    // One enemy right in front of the player (free roam has none).
    const { ctx } = window.__game.debug();
    const t = ctx.player.position.clone(); t.z += 1.6;
    ctx.spawnEnemy('melee', t, { hpMul: 3, dmgMul: 1 });
    window.__game.debug().camera.yaw = 0;
  });
  await page.mouse.down({ button: 'left' });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'left' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('#qte')).toBeVisible();
  const arrows = await page.evaluate(() => window.__game.getHudData().qte!.arrows);
  const arrowKeys: Record<string, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const wasd: Record<string, string> = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
  for (const [i, dir] of arrows.entries()) await page.keyboard.press(i % 2 ? wasd[dir] : arrowKeys[dir]);
  await expect.poll(() => results).toEqual(['complete']);
  expect(errors).toEqual([]);
});
