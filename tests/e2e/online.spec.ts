import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { HOST_PORT, PVP_PORT } from '../../playwright.config';

type Vec = { x: number; y: number; z: number };
type View = { id: number; kind: string; hp: number; maxHp: number; team: string; position: Vec };
type OnlineGame = {
  state: string;
  online: boolean;
  joinOnline(name: string): Promise<void>;
  resume(): void;
  me(): View;
  world: { squares: { id: string; center: Vec; size: number }[] };
  modeState(): { coop: { phase: string }; pvp: { phase: string; teams: { red: number[]; blue: number[] }; score: { red: number; blue: number }; round: number; roundCountdown: number } };
  markers(): { kind: string }[];
  myPlayerId: number;
  debugCommand(msg: unknown): void;
  debug(): { views: Map<number, View>; camera: { yaw: number } };
};
type W = { __game: OnlineGame };

/** Contexts opened by a test; closed afterwards so their pages stop rendering during the next test. */
const contexts: BrowserContext[] = [];
test.afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function join(browser: Browser, port: number, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  contexts.push(context);
  const page = await context.newPage();
  // Low quality: several software-rendered (SwiftShader) pages share one machine in these tests.
  await page.addInitScript(() => localStorage.setItem('shinobi-arena.settings.v1', JSON.stringify({ graphics: 'low' })));
  page.on('crash', () => console.log(`${name}: page crashed`));
  page.on('console', (m) => { if (m.type() === 'error' || /Connexion/.test(m.text())) console.log(`${name}: ${m.text()}`); });
  await page.goto(`http://localhost:${port}/`);
  await expect.poll(() => page.evaluate(() => !!(window as unknown as W).__game), { timeout: 60_000 }).toBe(true);
  // Several software-rendered pages starve each other's main thread: a join may time out; try once more.
  for (let attempt = 0; ; attempt++) {
    const ok = await page.evaluate((n) => (window as unknown as W).__game.joinOnline(n).then(() => true, () => false), name);
    if (ok && await page.evaluate(() => (window as unknown as W).__game.online)) break;
    if (attempt === 1) throw new Error(`${name} could not join the host`);
  }
  return page;
}

/** Headless windows steal focus from each other (blur opens the menu, which online doesn't pause): back to play. */
async function play(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => (window as unknown as W).__game.resume());
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__game.state)).toBe('playing');
}

/** Teleports the page's player into square `id`; `dx` = offset along X in square sizes (-0.25 = red half, +0.25 = blue). */
const toSquare = (page: Page, id: string, dx = 0) => page.evaluate(([id, dx]) => {
  const g = (window as unknown as W).__game;
  const sq = g.world.squares.find((s) => s.id === id)!;
  g.debugCommand({ t: 'debug', op: 'teleport', x: sq.center.x + (dx as number) * sq.size, y: sq.center.y + 0.3, z: sq.center.z });
}, [id, dx] as const);

// Several software-rendered pages boot slowly (~40 s each) on one machine.
test.describe.configure({ timeout: 360_000 });

const mode = (p: Page) => p.evaluate(() => (window as unknown as W).__game.modeState());
const players = (page: Page) => page.evaluate(() => [...(window as unknown as W).__game.debug().views.values()].filter((v) => v.kind === 'player').length);

test('co-op: 3 players see each other move, gather in the square, the mission starts with enemy groups on everyone\'s minimap; a 7th connection is refused', async ({ browser }) => {
  const errors: string[] = [];
  const pages: Page[] = [];
  for (const i of [1, 2, 3]) {
    const p = await join(browser, HOST_PORT, `Ninja${i}`);
    p.on('pageerror', (e) => errors.push(e.message));
    pages.push(p);
  }
  for (const p of pages) await expect.poll(() => players(p), { timeout: 15_000 }).toBe(3);

  // Player 1 runs forward: the two others see its actor move.
  await play(pages[0]);
  const id1 = await pages[0].evaluate(() => (window as unknown as W).__game.me().id);
  const where = (p: Page) => p.evaluate((id) => ({ ...(window as unknown as W).__game.debug().views.get(id)!.position }), id1);
  const before = await where(pages[1]);
  await pages[0].keyboard.down('KeyW');
  await pages[0].waitForTimeout(2500);
  await pages[0].keyboard.up('KeyW');
  for (const p of pages.slice(1)) await expect.poll(async () => { const a = await where(p); return Math.hypot(a.x - before.x, a.z - before.z); }, { timeout: 20_000 }).toBeGreaterThan(1.5);

  // Everyone in the co-op square → countdown → mission → enemy group markers for all.
  for (const p of pages) await toSquare(p, 'coop-hq');
  const where3 = () => pages[2].evaluate(() => {
    const s = (window as unknown as { __game: { snap: { players: { name: string; actorId: number; connected: boolean }[]; actors: { id: number; x: number; y: number; z: number; flags: number }[] } } }).__game.snap;
    return s.players.map((p) => { const a = s.actors.find((x) => x.id === p.actorId)!; return `${p.name}${p.connected ? '' : '(off)'} ${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)} f${a.flags}`; }).join(' | ');
  });
  await expect.poll(async () => `${(await mode(pages[2])).coop.phase} ${await where3()}`, { timeout: 20_000 }).toMatch(/^(countdown|running)/);
  await expect.poll(async () => (await mode(pages[1])).coop.phase, { timeout: 20_000 }).toBe('running');
  for (const p of pages) await expect.poll(() => p.evaluate(() => (window as unknown as W).__game.markers().filter((m) => m.kind === 'group').length), { timeout: 10_000 }).toBeGreaterThan(1);

  // 3 more raw connections fill the server (6 players); the 7th gets "full".
  const replies = await pages[1].evaluate(async (url) => {
    const hello = (name: string) => new Promise<string>((resolve) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', version: 1, name, character: 'naruto' }));
      ws.onmessage = (e) => { if (typeof e.data === 'string') resolve((JSON.parse(e.data) as { t: string }).t); };
      ws.onclose = () => resolve('closed');
    });
    const out: string[] = [];
    for (const n of ['A', 'B', 'C', 'D']) out.push(await hello(n));
    return out;
  }, `ws://localhost:${HOST_PORT}/ws`);
  expect(replies).toEqual(['welcome', 'welcome', 'welcome', 'full']);
  expect(errors).toEqual([]);
});

test('PvP: two players on opposite halves start a match, changing sides works, a KO ends the round and everyone sees it', async ({ browser }) => {
  const errors: string[] = [];
  const pages: Page[] = [];
  for (const n of ['Rouge', 'Bleu', 'Arbitre']) {
    const p = await join(browser, PVP_PORT, n);
    p.on('pageerror', (e) => errors.push(e.message));
    pages.push(p);
  }
  for (const p of pages) await expect.poll(() => players(p), { timeout: 15_000 }).toBe(3);
  const [red, blue, third] = pages;
  const pid = (p: Page) => p.evaluate(() => (window as unknown as W).__game.myPlayerId);
  const thirdId = await pid(third);

  // Third player starts on the red half, then switches to blue before the countdown ends.
  await toSquare(red, 'pvp-hq', -0.25);
  await toSquare(blue, 'pvp-hq', 0.25);
  await toSquare(third, 'pvp-hq', -0.25);
  await expect.poll(async () => (await mode(blue)).pvp.teams.red.includes(thirdId), { timeout: 15_000 }).toBe(true);
  await toSquare(third, 'pvp-hq', 0.25);
  await expect.poll(async () => (await mode(blue)).pvp.teams.blue.includes(thirdId), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await mode(red)).pvp.phase, { timeout: 20_000 }).toBe('running');
  await expect.poll(async () => (await mode(red)).pvp.roundCountdown, { timeout: 20_000 }).toBe(0);

  // Red KOs both blue players (HP set low with the debug command); the round goes to red for everyone.
  await play(red);
  const blueIds = await red.evaluate(() => [...(window as unknown as W).__game.debug().views.values()].filter((v) => v.team === 'blue').map((v) => v.id));
  expect(blueIds).toHaveLength(2);
  for (const id of blueIds) {
    await red.evaluate((id) => {
      const g = (window as unknown as W).__game;
      const t = g.debug().views.get(id)!.position;
      g.debugCommand({ t: 'debug', op: 'hp', actorId: id, hp: 1 });
      g.debugCommand({ t: 'debug', op: 'teleport', x: t.x, y: t.y + 0.3, z: t.z - 1.4 });
      g.debug().camera.yaw = 0; // look (and home) toward +Z: at the target
    }, id);
    await expect.poll(async () => {
      await red.keyboard.press('KeyF');
      for (let i = 0; i < 4; i++) { await red.mouse.click(480, 270); await red.waitForTimeout(80); }
      return third.evaluate((id) => ((window as unknown as W).__game.debug().views.get(id)?.hp ?? 1) <= 0, id);
    }, { timeout: 40_000, intervals: [100] }).toBe(true);
  }
  for (const p of pages) await expect.poll(async () => (await mode(p)).pvp.score.red, { timeout: 15_000 }).toBe(1);
  expect(errors).toEqual([]);
});
