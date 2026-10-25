import { expect, test, type Page } from '@playwright/test';

/** Typed access to the debug hook exposed by main.ts. */
type DebugGame = {
  state: string;
  debug(): {
    ctx: {
      time: number;
      player: { position: { x: number; y: number; z: number }; fighter: { hp: number; maxHp: number; chakra: number } };
      actors: { team: string; alive: boolean; position: { x: number; z: number } }[];
      enemies(): unknown[];
      combat: { dealDamage(src: unknown, dst: unknown, dmg: number, kb: number, kind: string, at: unknown): void };
    };
    waves: { wave: number; remaining: number; intermission: number };
  };
  events: { on(type: string, fn: (p: unknown) => void): void };
};
declare global { interface Window { __game: DebugGame; __log: string[] } }

const state = (page: Page) => page.evaluate(() => window.__game.state);

async function startGame(page: Page) {
  await page.goto('/');
  await page.locator('#btn-play').click();
  await page.locator('#btn-char-confirm').click(); // character selection (Naruto pre-selected)
  await page.locator('#btn-start-fight').click();
  await expect.poll(() => state(page)).toBe('playing');
  await expect(page.locator('#hud')).toBeVisible();
}

async function killAllEnemies(page: Page) {
  await page.evaluate(() => {
    const { ctx } = window.__game.debug();
    for (const e of ctx.enemies()) ctx.combat.dealDamage(ctx.player, e, 99999, 0, 'combo3', ctx.player.position);
  });
}

test('menu → fight → pause freezes simulation → victory → restart → defeat → menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page);
  await page.evaluate(() => {
    window.__log = [];
    for (const t of ['attackStart', 'waveStart', 'damage', 'victory', 'defeat']) window.__game.events.on(t, () => window.__log.push(t));
  });

  // A wave spawns enemies.
  await expect.poll(() => page.evaluate(() => window.__game.debug().ctx.enemies().length), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('#hud-wave')).toContainText('1');

  // Movement.
  const p0 = await page.evaluate(() => ({ ...window.__game.debug().ctx.player.position }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => ({ ...window.__game.debug().ctx.player.position }));
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(1);

  // Melee attack.
  await page.mouse.click(640, 360);
  await expect.poll(() => page.evaluate(() => window.__log.includes('attackStart'))).toBe(true);
  if ((await state(page)) === 'paused') await page.locator('#btn-resume').click(); // pointer-lock quirks in headless

  // Pause freezes simulation time and enemies.
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toBe('paused');
  await expect(page.locator('#pause-menu')).toBeVisible();
  const frozen = await page.evaluate(() => JSON.stringify({ t: window.__game.debug().ctx.time, a: window.__game.debug().ctx.actors.map((a) => a.position) }));
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => JSON.stringify({ t: window.__game.debug().ctx.time, a: window.__game.debug().ctx.actors.map((a) => a.position) }));
  expect(after).toBe(frozen);
  await page.locator('#btn-resume').click();
  await expect.poll(() => state(page)).toBe('playing');

  // Clear every wave → victory.
  await expect.poll(async () => {
    await killAllEnemies(page);
    return state(page);
  }, { timeout: 60_000, intervals: [500] }).toBe('victory');
  await expect(page.locator('#victory-screen')).toBeVisible();

  // Restart: fresh state, no leftovers.
  await page.locator('#btn-retry').click();
  await expect.poll(() => state(page)).toBe('playing');
  const fresh = await page.evaluate(() => {
    const { ctx, waves } = window.__game.debug();
    return { hp: ctx.player.fighter.hp, max: ctx.player.fighter.maxHp, dead: ctx.actors.filter((a) => !a.alive).length, wave: waves.wave };
  });
  expect(fresh.hp).toBe(fresh.max);
  expect(fresh.dead).toBe(0);
  expect(fresh.wave).toBeLessThanOrEqual(1);

  // Defeat.
  await page.evaluate(() => {
    const { ctx } = window.__game.debug();
    ctx.combat.dealDamage(ctx.player, ctx.player, 99999, 0, 'enemyMelee', ctx.player.position);
  });
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe('defeat');
  await expect(page.locator('#defeat-screen')).toBeVisible();
  await page.locator('#btn-defeat-menu').click();
  await expect.poll(() => state(page)).toBe('menu');
  await expect(page.locator('#btn-play')).toBeVisible();

  expect(errors).toEqual([]);
});
