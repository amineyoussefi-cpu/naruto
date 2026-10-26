import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** Two host servers (with --debug test commands): co-op and PvP tests each get a fresh world state. */
export const HOST_PORT = 5181;
export const PVP_PORT = 5182;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // SwiftShader gives WebGL in headless CI without a GPU.
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite build --ssr server/main.ts --outDir dist-server && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    ...[HOST_PORT, PVP_PORT].map((port) => ({
      // Host servers (built by the first command) for the online tests: page + /ws, fixed seed, debug commands on.
      command: `node dist-server/main.js --port ${port} --seed 1337 --debug`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 60_000,
    })),
  ],
});
