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
  execFileSync(
    'python3',
    [
      '-m', 'fontTools.subset', fontPath,
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

  const kb = (statSync(OUT).size / 1024).toFixed(1);
  console.log(`\n  ${wanted.length} icons -> ${kb} KB  ${OUT.replace(APP + '/', '')}`);
  if (statSync(OUT).size > 120 * 1024) {
    console.warn('  WARNING: over 120 KB. Prune the map — this is on the critical path.');
  }
}

main();
