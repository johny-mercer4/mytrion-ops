import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev server for `scripts/mobile-audit.mjs` / `scripts/mobile-shots.mjs`. NOT part of any build.
 *
 * Two things it does that the main config deliberately does not:
 *
 * 1. RUNS ON ITS OWN PORT, so an audit never fights the developer's `pnpm dev` on :5173
 *    (which is `strictPort`, precisely so it cannot drift).
 * 2. PROXIES `/v1` TO THE API instead of pointing the client at `http://localhost:3001`. The
 *    backend's CORS allowlist is an exact match on origin and does not include this port, so a
 *    cross-origin client here fails every fetch — and an audit against empty tables is worthless,
 *    because an empty grid never overflows. Proxying makes the calls same-origin, so
 *    `resolveApiConfig()` returns a relative base and the pages render with real data.
 *
 * Run with VITE_DEV_MOCK_AUTH=1 and VITE_API_URL= (empty) so the routes render behind the Zoho gate
 * and the client uses the relative base:
 *
 *   VITE_DEV_MOCK_AUTH=1 VITE_API_URL= pnpm exec vite --config vite.audit.config.ts
 *
 * `AUDIT_API_PORT` retargets the proxy. The default :3001 is whatever `pnpm dev:all` is pointed at —
 * and `.env`'s `MYTRION_OPS_DATABASE_URL` is the RENDER PRODUCTION database, so auditing a screen
 * that writes anything must run its own API against a throwaway local DB on another port.
 */
const API_PORT = process.env.AUDIT_API_PORT ?? '3001';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/v1': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/realtime': { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
});
