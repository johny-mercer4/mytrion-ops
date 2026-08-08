#!/usr/bin/env node
/**
 * Build the design system's PORTABLE stylesheet into dist/horizon-tokens.css.
 *
 * WHY THIS IS A SEPARATE STEP: the library build (vite.lib.config.ts) emits `horizon-ui.css` from
 * the components' .module.css files, and every rule in it is `var(--token)`. On its own that CSS
 * paints nothing recognisable — no colour, no radius, no type. The token layer has to travel with
 * it, and it cannot simply be imported from src/ds/index.ts or every app that imports a single
 * Button would also inline the entire theme into its own bundle.
 *
 * So: two stylesheets, one import away from each other.
 *   horizon-tokens.css   fonts + the three token tiers + atmosphere   (this file)
 *   horizon-ui.css       the component rules                          (vite.lib.config.ts)
 *
 * A consumer loads horizon-tokens.css then horizon-ui.css. That ordering is not optional — the
 * component rules reference tokens the first file declares.
 *
 * Run via `pnpm build:ds`.
 */
import { build } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  configFile: false,
  root: APP,
  publicDir: false,
  logLevel: 'warn',
  // RELATIVE font urls. Without this Vite emits `/fonts/x.woff2`, which only works if the consumer
  // happens to serve the library from their domain root — every other deployment 404s the faces and
  // silently falls back to system-ui. A library cannot assume where it is mounted.
  base: './',
  build: {
    outDir: 'dist',
    // The library build runs first and must not be wiped.
    emptyOutDir: false,
    // NOT cssCodeSplit:false — Vite rejects a CSS file as a rollup input under that flag. There is
    // only one entry here anyway, so there is nothing to split.
    rollupOptions: {
      input: join(APP, 'src/ds/styles.css'),
      output: {
        assetFileNames: (info) =>
          info.name?.endsWith('.woff2') ? 'fonts/[name][extname]' : 'horizon-tokens.css',
      },
    },
  },
});

/*
 * Vite emits a tiny JS shim alongside a CSS-only entry (the entry chunk for styles.css). It is dead
 * weight in a distributed library and, worse, it looks like something a consumer should import.
 * Delete it and leave only the stylesheet.
 */
const shim = join(APP, 'dist/style.js');
if (existsSync(shim)) {
  const { unlinkSync } = await import('node:fs');
  unlinkSync(shim);
}

const out = join(APP, 'dist/horizon-tokens.css');
if (!existsSync(out)) {
  console.error('build-ds-styles: dist/horizon-tokens.css was not produced');
  process.exit(1);
}
const css = readFileSync(out, 'utf8');

// A guard, not a formality: if the @font-face url() were rewritten to anything other than a
// relative ./fonts/ path, every consumer would 404 on the faces and silently fall back to
// system-ui — which is exactly the class of bug this design system already shipped once.
// Must be RELATIVE (./fonts/…). A root-absolute /fonts/… only works when the consumer serves the
// library from their domain root; anywhere else the faces 404 and the whole thing silently renders
// in system-ui. That exact failure has already shipped in this repo once, via a different route.
const urls = [...css.matchAll(/url\(([^)"']*\.woff2)[^)]*\)/g)].map((m) => m[1]);
const bad = urls.filter((u) => !u.startsWith('./fonts/'));
if (!urls.length || bad.length) {
  console.error('build-ds-styles: font url() must be relative ./fonts/… — got:', bad.length ? bad : '(none found)');
  process.exit(1);
}

writeFileSync(out, css);
console.log(`  portable stylesheet -> dist/horizon-tokens.css (${(css.length / 1024).toFixed(1)} KB)`);
