#!/usr/bin/env node
/**
 * Build the Material Symbols Sharp subset for Mytrion Horizon.
 *
 * Horizon ships ONE icon family. It is a variable font rather than a stroke set because the four
 * axes are the reason it was chosen:
 *   wght  the icon's stroke matches the Grotesk beside it instead of approximating it
 *   opsz  real optical correction — the 20px cut is not the 24px cut scaled down
 *   GRAD  compensates the optical bloom (halation) icons get on a dark ground, which a dark-first
 *         ops platform has on every screen
 *   FILL  a free solid variant for selected nav rows and toggled states, on one glyph
 *
 * ── SUBSET BY CODEPOINT, NEVER BY --text ──────────────────────────────────────────────────────
 * Material Symbols resolves names through LIGATURES. Subsetting with `--text=refresh,search,...`
 * keeps the LETTERS that spell the names and drops the glyphs those ligatures resolve to. Measured
 * on this font: a 40-icon --text subset produced 25 glyphs and 1.8 KB of nothing useful. The
 * failure is silent — the font loads and every icon renders as its own name in prose.
 *
 * ── MEASURED SIZES (Sharp, all four axes retained) ────────────────────────────────────────────
 *    40 icons ->  14.5 KB       200 icons -> 101.5 KB
 *   100 icons ->  48.3 KB       300 icons -> 159.7 KB
 *   full font -> 3428.0 KB      i.e. ~0.5 KB per icon, scaling linearly.
 * Keep the map tight. Every name you add costs half a kilobyte on the critical path forever.
 *
 * Usage:  node scripts/build-icon-font.mjs
 * Deps:   python3 with fontTools + brotli  (pip install 'fonttools[woff]')
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const OUT_DIR = join(APP, 'src/styles/fonts');
const OUT = join(OUT_DIR, 'material-symbols-sharp-subset.woff2');
const CACHE = join(APP, 'node_modules/.cache/horizon-icons');

/** The lucide -> Material Symbols name map. THE source of truth for which icons exist. */
const MAP_FILE = join(APP, 'src/styles/icon-map.json');

const UPSTREAM_FONT =
  'https://fonts.gstatic.com/s/materialsymbolssharp/v361/gNMVW2J8Roq16WD5tFNRaeLQk6-SHQ_R00k4aWHSSmlN.woff2';
const UPSTREAM_CODEPOINTS =
  'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsSharp%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';

function fetchCached(url, file) {
  const path = join(CACHE, file);
  if (existsSync(path) && statSync(path).size > 0) return path;
  mkdirSync(CACHE, { recursive: true });
  execFileSync('curl', ['-sS', '-f', '-L', '-o', path, url], { stdio: 'inherit' });
  return path;
}

function main() {
  if (!existsSync(MAP_FILE)) {
    console.error(
      `No icon map at ${MAP_FILE}.\n` +
        'It lands in Phase 3 with the lucide -> Material migration; the subset cannot be built\n' +
        'before it exists, because a subsetted icon font IS its list of codepoints.',
    );
    process.exit(1);
  }

  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
  const wanted = [...new Set(Object.values(map))].sort();

  const fontPath = fetchCached(UPSTREAM_FONT, 'material-symbols-sharp-full.woff2');
  const cpPath = fetchCached(UPSTREAM_CODEPOINTS, 'material-symbols-sharp.codepoints');

  const codepoints = new Map(
    readFileSync(cpPath, 'utf8')
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 2)
      .map(([name, hex]) => [name, hex]),
  );

  const missing = wanted.filter((n) => !codepoints.has(n));
  if (missing.length) {
    console.error(`Not real Material Symbols names:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  const unicodes = wanted.map((n) => `U+${codepoints.get(n)}`).join(',');
  const listFile = join(CACHE, 'unicodes.txt');
  writeFileSync(listFile, unicodes);

  mkdirSync(OUT_DIR, { recursive: true });

  /*
   * STEP 1 — PIN THE AXES WE DO NOT ACTUALLY VARY. This is the difference between a 115 KB font
   * and a 36 KB one, and it costs no capability. Measured on this exact glyph set:
   *
   *   all four axes ......... 114.8 KB
   *   pin opsz .............. 68.5 KB   (-46.3)
   *   pin opsz + GRAD ....... 36.4 KB   (-32.1)   <- what we ship
   *   + pin wght ............ 16.3 KB
   *   fully static .......... 12.1 KB
   *
   * opsz is pinned because its range is 20..48 and BOTH Horizon sizes (20px and 16px) resolve to
   * the floor — a 16px icon already renders the opsz-20 cut. That axis was costing 46 KB to
   * express a value we can never leave. Pinning it loses nothing.
   *
   * GRAD is pinned to 0 because we only ever wanted two values (dark/light), not a range, and the
   * dark-ground compensation is expressible on the wght axis we are keeping anyway — see
   * --icon-wght in theme.css, which steps 300 -> 290 in dark.
   *
   * FILL and wght STAY live: FILL is the selected-state axis (the capability a stroke set cannot
   * offer at any price) and it costs only 4 KB; wght carries the dark compensation.
   */
  const instanced = join(CACHE, 'ms-sharp-instanced.ttf');
  execFileSync(
    'python3',
    ['-m', 'fontTools.varLib.instancer', fontPath, 'opsz=20', 'GRAD=0', '-o', instanced],
    { stdio: 'inherit' },
  );

  // STEP 2 — subset to our glyphs.
  execFileSync(
    'python3',
    [
      '-m', 'fontTools.subset', instanced,
      `--output-file=${OUT}`,
      '--flavor=woff2',
      `--unicodes-file=${listFile}`,
      // No layout features: we address glyphs by codepoint from the Icon component, not by
      // ligature. That also removes the ligature-FOUT failure mode entirely — an unloaded font
      // renders nothing rather than rendering the word "refresh".
      '--layout-features=',
      '--no-hinting',
      '--desubroutinize',
    ],
    { stdio: 'inherit' },
  );

  // Emit the codepoint table the Icon component renders from. Addressing glyphs by CODEPOINT
  // rather than by ligature is what removes the ligature-FOUT failure mode: an unloaded ligature
  // font paints the literal word "refresh", whereas an unloaded codepoint paints nothing.
  const tsOut = join(APP, 'src/ds/Icon/codepoints.ts');
  const entries = wanted.map((n) => `  ${JSON.stringify(n)}: '\\u${codepoints.get(n)}',`).join('\n');
  writeFileSync(
    tsOut,
    `/* GENERATED by scripts/build-icon-font.mjs — do not edit.\n` +
      ` * Regenerate with: pnpm build:icons\n` +
      ` * ${wanted.length} icons, subsetted from Material Symbols Sharp.\n` +
      ` */\n\n` +
      `export const CODEPOINTS = {\n${entries}\n} as const;\n\n` +
      `export type IconName = keyof typeof CODEPOINTS;\n`,
  );

  const kb = (statSync(OUT).size / 1024).toFixed(1);
  console.log(`\n  ${wanted.length} icons -> ${kb} KB  ${OUT.replace(APP + '/', '')}`);
  console.log(`  codepoints -> ${tsOut.replace(APP + '/', '')}`);
  if (statSync(OUT).size > 120 * 1024) {
    console.warn('  WARNING: over 120 KB. Prune the map — this is on the critical path.');
  }
}

main();
