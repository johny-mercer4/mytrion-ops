import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The DESIGN SYSTEM library build. Separate from vite.config.ts, which builds the CRM *app* into
 * `app/` as a Zoho widget bundle.
 *
 * WHY THIS EXISTS: the app build cannot be consumed by anything else. This one emits `dist/` — a
 * real component library with one CSS file and TypeScript declarations — which is what makes the
 * design system portable: Claude Design (claude.ai/design) binds a compiled bundle plus a
 * `styles.css` whose @import closure carries the look, and an engineer importing `@/ds` gets
 * exactly the same components the design agent drew with.
 *
 * THE PURITY RULE, which this build enforces by shape:
 *   Everything under src/ds/ takes PROPS and nothing else. No useUserContext, no react-router, no
 *   api/ imports, no access/ imports. A component that reaches into app context cannot render
 *   outside the app, which means it cannot be previewed, cannot be documented in isolation, and
 *   cannot be shipped to a design tool. src/ds/purity.test.ts fails the build if one does.
 *   Workspace-aware components stay in mytrions/_shared — they are compositions, not primitives.
 *
 * Run: pnpm build:ds
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The app's public/ holds a favicon and Zoho widget vendor scripts. None of that belongs in a
  // component library — without this, `dist/` ships a favicon and jspdf to anyone importing a Button.
  publicDir: false,
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/ds/index.ts'),
      name: 'MytrionHorizon',
      formats: ['es', 'umd'],
      fileName: (format) => `horizon-ui.${format}.js`,
    },
    rollupOptions: {
      // React is a peer, never bundled — two React copies in one page is React #321 ("invalid hook
      // call"), which vite.config.ts already carries a comment about for the app build.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        assetFileNames: (info) => {
          const name = info.name ?? '';
          if (name.endsWith('.woff2')) return 'fonts/[name][extname]';
          return name.endsWith('.css') ? 'horizon-ui.css' : 'assets/[name][extname]';
        },
      },
    },
  },
});
