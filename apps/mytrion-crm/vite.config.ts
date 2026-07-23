import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server is pinned to :5173 (strictPort → always 5173, never auto-drifts to 5174). This
// origin must be in the backend's CORS allowlist (CORS_ORIGINS in the API's .env).
// `base: './'` makes the build use relative asset paths, which a Zoho widget bundle requires.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // Force a single React / react-dom instance in the bundle. A sibling app (web/) has its own
    // react-dom, so a build environment whose dep tree resolves React from two physical locations
    // produces two copies — the reconciler and the hooks dispatcher then land in different chunks
    // and every useContext throws React #321 ("invalid hook call") at runtime. dedupe pins one copy.
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173, strictPort: true },
  // Build into app/ — the web root a Zoho widget (zet) serves and packs. sourcemap is OFF: the
  // app/ dir is packed into the .zet and served publicly, and maps would expose source (and could
  // re-expose any inlined env value). Flip to true only for local debugging, never for a shipped build.
  build: { outDir: 'app', emptyOutDir: true, sourcemap: false },
});
