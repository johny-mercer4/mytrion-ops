import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server runs on :3000 — already in the backend's CORS allowlist (CORS_ORIGINS).
// `base: './'` makes the build use relative asset paths, which a Zoho widget bundle requires.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 3000 },
  // Build into app/ — the web root a Zoho widget (zet) serves and packs.
  build: { outDir: 'app', emptyOutDir: true, sourcemap: true },
});
