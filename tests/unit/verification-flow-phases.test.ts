/**
 * Guards the one duplication in the flow: the 10 phases exist BOTH as seeded rows in
 * `verification_phases` (migration 0121) and as `PHASE_CATALOG` in code, so the state machine can
 * reason about a case without a round trip.
 *
 * Drift between them is silent and nasty — the rail would render one thing while the machine routed
 * on another. Pure FS reads, no database, so this runs on every PR like migration-journal.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHASE_CATALOG } from '../../src/modules/verificationFlow/phases.js';
import {
  VERIFICATION_STATUS,
  VERIFICATION_TERMINAL_STATUSES,
} from '../../src/db/schema/verification_flow.js';

const MIGRATION = readFileSync(
  join(process.cwd(), 'src/db/migrations/0121_verification_new_era.sql'),
  'utf8',
);

/**
 * Split one VALUES tuple into cells, respecting single-quoted strings.
 *
 * A regex will not do: `'Carrier Operational Review (Highway)'` contains the very parentheses that
 * delimit a tuple, and a description could legitimately contain a comma.
 */
function splitCells(body: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuote) {
      // '' is an escaped quote inside a SQL string literal.
      if (ch === "'" && body[i + 1] === "'") {
        current += "'";
        i += 1;
      } else if (ch === "'") {
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'") inQuote = true;
    else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Pull the VALUES tuples out of a named INSERT block, quote-aware. */
function seededRows(table: string): string[][] {
  const start = MIGRATION.indexOf(`INSERT INTO ${table}`);
  expect(start, `0121 must seed ${table}`).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf('ON CONFLICT', start);
  const block = MIGRATION.slice(MIGRATION.indexOf('VALUES', start) + 'VALUES'.length, end);

  const rows: string[][] = [];
  let depth = 0;
  let inQuote = false;
  let buffer = '';
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i] as string;
    if (inQuote) {
      buffer += ch;
      if (ch === "'" && block[i + 1] === "'") {
        buffer += "'";
        i += 1;
      } else if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      buffer += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth === 1) {
        buffer = '';
        continue;
      }
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        rows.push(splitCells(buffer));
        buffer = '';
        continue;
      }
    }
    if (depth > 0) buffer += ch;
  }
  return rows;
}

describe('verification_phases seed matches PHASE_CATALOG', () => {
  const rows = seededRows('verification_phases');

  it('seeds exactly the ten catalog phases', () => {
    expect(rows).toHaveLength(PHASE_CATALOG.length);
  });

  it('agrees on code, order and applicability for every phase', () => {
    const seeded = rows.map((cells) => ({
      code: cells[0],
      order: Number(cells[2]),
      appliesTo: cells[3],
    }));
    const catalog = PHASE_CATALOG.map((p) => ({
      code: p.code,
      order: p.order,
      appliesTo: p.appliesTo,
    }));
    expect(seeded).toEqual(catalog);
  });
});

describe('verification_statuses seed matches the code constants', () => {
  const rows = seededRows('verification_statuses');
  const seeded = new Map(rows.map((cells) => [cells[0] as string, cells]));

  it('seeds every status the code can set', () => {
    for (const code of Object.values(VERIFICATION_STATUS)) {
      expect(seeded.has(code), `0121 must seed status '${code}'`).toBe(true);
    }
  });

  it('seeds no status the code does not know about', () => {
    const known = new Set<string>(Object.values(VERIFICATION_STATUS));
    for (const code of seeded.keys()) {
      expect(known.has(code), `status '${code}' is seeded but unreachable from code`).toBe(true);
    }
  });

  it('agrees with VERIFICATION_TERMINAL_STATUSES on which statuses are terminal', () => {
    for (const [code, cells] of seeded) {
      const seededTerminal = cells[3] === 'true';
      expect(
        VERIFICATION_TERMINAL_STATUSES.has(code),
        `terminality of '${code}' differs between the 0121 seed and the code constant`,
      ).toBe(seededTerminal);
    }
  });

  it('gives every non-terminal working status a Sales board column', () => {
    // A status with no board column is invisible to Sales. That is legitimate for desk-only states,
    // but every status Sales can be waiting on must project somewhere or the agent loses the card.
    for (const [code, cells] of seeded) {
      const boardColumn = cells[4];
      expect(boardColumn, `status '${code}' has no board_column`).toBeTruthy();
    }
  });

  it('projects pending_docs onto the column that asks Sales to act', () => {
    expect(seeded.get(VERIFICATION_STATUS.pendingDocs)?.[4]).toBe('needs_you');
  });
});
