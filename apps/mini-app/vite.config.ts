import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server pinned to :5174 (mytrion-crm already owns :5173) so both apps can run side by side.
// base '/mini-app/' + outDir 'app': the build is served SAME-ORIGIN by the backend at /mini-app/
// (see src/plugins/miniAppStatic.ts), vendored in git like the widget's app/ dir — so a Docker
// deploy needs no web build step and the mini-app shares the API's origin (no CORS).
export default defineConfig({
  base: '/mini-app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5174, strictPort: true },
  build: { outDir: 'app', emptyOutDir: true, sourcemap: false },
});
