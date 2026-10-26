/**
 * `npm run host`: serves the built client (`dist/`) and the game WebSocket (`/ws`) on one port.
 * Binds to localhost and the Tailscale addresses only (100.64.0.0/10); `--lan` binds every interface.
 * Flags: `--port N`, `--lan`, `--dev` (no static files: the Vite dev server proxies `/ws`), `--seed N`.
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NET } from '../src/config/net';
import { createGameSim } from '../src/sim/factory';
import { ServerHost, type SimLike } from './ServerHost';
import { acceptUpgrade } from './ws';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export interface ServerOptions { port: number; lan: boolean; dev: boolean; seed: number; debug: boolean }

export function parseArgs(argv: readonly string[]): ServerOptions {
  const value = (flag: string): number | null => {
    const i = argv.indexOf(flag);
    const n = i >= 0 ? Number(argv[i + 1]) : NaN;
    return Number.isInteger(n) ? n : null;
  };
  return {
    port: value('--port') ?? NET.port,
    lan: argv.includes('--lan'),
    dev: argv.includes('--dev'),
    /** Test tooling: accept teleport / HP debug messages. Never for real games. */
    debug: argv.includes('--debug'),
    seed: value('--seed') ?? Math.floor(Math.random() * 0x7fffffff),
  };
}

/** IPv4 addresses of this machine inside Tailscale's CGNAT range 100.64.0.0/10. */
export function tailscaleAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      const [o1, o2] = a.address.split('.').map(Number);
      if (o1 === 100 && o2 >= 64 && o2 <= 127) out.push(a.address);
    }
  }
  return out;
}

/** MagicDNS name of this machine (without the trailing dot), or null when the CLI is missing / logged out. */
function magicDnsName(): Promise<string | null> {
  const bins = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  const tryBin = (i: number): Promise<string | null> => new Promise((done) => {
    if (i >= bins.length) return done(null);
    execFile(bins[i], ['status', '--json'], { timeout: 2000 }, (err, stdout) => {
      if (err) return done(tryBin(i + 1));
      try {
        const name = (JSON.parse(stdout) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, '');
        done(name || null);
      } catch { done(null); }
    });
  });
  return tryBin(0);
}

/** Resolves a URL path inside `root`, or null when it escapes it. */
export function safePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const full = normalize(join(root, decoded));
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let file = safePath(root, req.url ?? '/');
  if (!file) { res.writeHead(400).end(); return; }
  const isFile = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isFile() ?? false;
  if (!(await isFile(file))) {
    const index = join(file, 'index.html');
    if (await isFile(index)) file = index;
    else if (!extname(file)) file = join(root, 'index.html'); // SPA fallback
    else { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500).end();
  }
}

/** Starts the host. `createSim` builds the authoritative simulation for a seed. */
export async function startServer(opts: ServerOptions, createSim: (seed: number) => Promise<SimLike>): Promise<ServerHost> {
  const host = await ServerHost.create(() => createSim(opts.seed));
  host.debugEnabled = opts.debug;
  const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/[\\/]$/, '');
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (opts.dev) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Mode --dev : ouvrez le serveur Vite / open the Vite dev server.'); return; }
    void serveStatic(root, req, res);
  };
  const tailscale = tailscaleAddresses();
  const addresses = opts.lan ? ['0.0.0.0'] : ['127.0.0.1', '::1', ...tailscale];
  let bound = 0;
  await Promise.all(addresses.map((addr) => new Promise<void>((done) => {
    const server = createServer(onRequest);
    server.on('upgrade', (req, socket, head) => {
      if ((req.url ?? '').split('?')[0] !== NET.wsPath) { socket.destroy(); return; }
      // Behind the Vite dev proxy (loopback) the real peer is in X-Forwarded-For; never trusted from remote peers.
      const peer = req.socket.remoteAddress ?? '';
      const fwd = req.headers['x-forwarded-for'];
      const remote = (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') && typeof fwd === 'string'
        ? fwd.split(',')[0].trim() : peer;
      const ws = acceptUpgrade(req, socket, head, NET.maxPayload, remote);
      if (ws) host.accept(ws);
    });
    server.on('error', (e: Error) => { console.warn(`[host] ${addr}:${opts.port} — ${e.message}`); done(); });
    server.listen(opts.port, addr, () => { bound++; done(); });
  })));
  if (!bound) throw new Error(`Impossible d'écouter sur le port ${opts.port} / cannot listen on port ${opts.port}`);
  host.start();

  const dns = await magicDnsName();
  const urls = [`http://localhost:${opts.port}`, ...(dns ? [`http://${dns}:${opts.port}`] : []), ...tailscale.map((a) => `http://${a}:${opts.port}`)];
  console.log(`\nShinobi Arena — serveur lancé / server running (seed ${opts.seed})${opts.dev ? ' [dev]' : ''}`);
  console.log('Partagez une de ces adresses / share one of these URLs:');
  for (const u of urls) console.log(`  ${u}`);
  if (!tailscale.length && !opts.lan) console.log('Tailscale introuvable : seul localhost est accessible / Tailscale not found: localhost only.');
  if (opts.lan) console.log('--lan : ouvert sur tout le réseau local / open to the whole local network.');
  return host;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2));
  startServer(opts, (seed) => createGameSim(seed, true))
    .then((host) => {
      const quit = (): void => { host.stop(); process.exit(0); };
      process.on('SIGINT', quit);
      process.on('SIGTERM', quit);
    })
    .catch((e: Error) => { console.error(e.message); process.exit(1); });
}
