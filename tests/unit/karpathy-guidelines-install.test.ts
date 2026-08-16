/**
 * The Karpathy guidelines have to be installed for Claude Code, Codex AND Cursor.
 *
 * Each tool loads a different file by default, so "installed" means six artifacts agree — and six
 * copies of anything drift. This is the ratchet: the mirrors must be byte-identical to the source,
 * and every surface a tool actually reads must carry all four principles.
 *
 * Without this, the usual failure is silent: someone edits `.claude/skills/...`, Cursor keeps
 * serving the old rule, and the two assistants follow different instructions in the same repo.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** The canonical copy. Everything else is a mirror or a restatement of it. */
const SOURCE = '.claude/skills/karpathy-guidelines/SKILL.md';

/** Skill trees this repo already keeps in lockstep (see `.agents/skills`, `.cursor/skills`). */
const MIRRORS = [
  '.agents/skills/karpathy-guidelines/SKILL.md',
  '.cursor/skills/karpathy-guidelines/SKILL.md',
];

/** Files a tool loads WITHOUT being asked — this is what "by default" means for each one. */
const AUTOLOADED = [
  'CLAUDE.md', // Claude Code
  'AGENTS.md', // Codex, and Cursor's native cross-tool file
  '.cursor/rules/karpathy-guidelines.mdc', // Cursor, alwaysApply
];

const PRINCIPLES = [
  /think before coding/i,
  /simplicity first/i,
  /surgical changes/i,
  /goal-driven execution/i,
];

describe('karpathy guidelines are installed', () => {
  it('has a canonical skill with the four principles', () => {
    const text = read(SOURCE);
    for (const p of PRINCIPLES) expect(text).toMatch(p);
  });

  it.each(MIRRORS)('%s is byte-identical to the canonical skill', (mirror) => {
    // Not "contains the same headings" — identical. A mirror that has drifted is worse than none,
    // because nobody knows which copy the other assistant read.
    expect(read(mirror)).toBe(read(SOURCE));
  });

  it.each(AUTOLOADED)('%s carries all four principles', (file) => {
    const text = read(file);
    for (const p of PRINCIPLES) expect(text).toMatch(p);
  });

  it('attributes the guidelines honestly in the canonical copy', () => {
    const text = read(SOURCE);
    // They are a community distillation of Karpathy's observations, not text he wrote. Saying so is
    // the difference between a citation and a fabricated endorsement.
    expect(text).toMatch(/community distillation/i);
    expect(text).toMatch(/karpathy\.com|x\.com\/karpathy|github\.com\/forrestchang/i);
  });

  it('is always-on for Cursor rather than glob-scoped', () => {
    const rule = read('.cursor/rules/karpathy-guidelines.mdc');
    // A behavioural guideline scoped to a glob only fires for some edits, which is not "by default".
    expect(rule).toMatch(/^alwaysApply:\s*true$/m);
  });

  it('is a hard rule in CLAUDE.md, not a suggestion buried in prose', () => {
    const claude = read('CLAUDE.md');
    expect(claude).toMatch(/^\d+\.\s+\*\*Karpathy guidelines apply to every change\*\*/m);
  });
});
