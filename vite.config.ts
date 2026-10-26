import { defineConfig } from 'vitest/config';

export default defineConfig(({ isSsrBuild }) => ({
  base: './',
  // /ws goes to `npm run host:dev`'s server; xfwd lets it tell remote players from the host behind the proxy.
  server: { port: 5173, host: true, proxy: { '/ws': { target: 'ws://127.0.0.1:5180', ws: true, xfwd: true } } },
  preview: { port: 4173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  // Server bundle (vite build --ssr server/main.ts): self-contained Node script, no public/ copy.
  ...(isSsrBuild ? { ssr: { noExternal: true }, build: { target: 'node20', copyPublicDir: false } } : {}),
}));
