import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server runs on :3000 — already in the backend's CORS allowlist (CORS_ORIGINS).
// `base: './'` makes the build use relative asset paths, which a Zoho widget bundle requires.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 3000 },
  // Build into app/ — the web root a Zoho widget (zet) serves and packs. sourcemap is OFF: the
  // app/ dir is packed into the .zet and served publicly, and maps would expose source (and could
  // re-expose any inlined env value). Flip to true only for local debugging, never for a shipped build.
  build: { outDir: 'app', emptyOutDir: true, sourcemap: false },
});
