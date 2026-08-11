import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MYTRION_ORDER, type MytrionId } from './mytrions.config';
import { MYTRION_TABS, allTabs, findTab, tabsFor, unknownTabKeys } from './tabRegistry';

const MYTRIONS_DIR = join(__dirname, '../mytrions');

/** Every non-test source file under a Mytrion's own folder. */
function sourcesFor(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

const FOLDER: Record<MytrionId, string> = {
  admin: 'admin',
  sales: 'sales',
  billing: 'billing',
  collection: 'collection',
  finance: 'finance',
  verification: 'verification',
  manager: 'manager',
  marketing: 'marketing',
  analyst: 'analyst',
  hr: 'hr',
  recruit: 'recruit',
  trailhead: 'trailhead',
  'customer-service': 'customer-service',
};

describe('tab registry', () => {
  it('covers every Mytrion', () => {
    expect(Object.keys(MYTRION_TABS).sort()).toEqual([...MYTRION_ORDER].sort());
    for (const id of MYTRION_ORDER) {
      expect(tabsFor(id).length, `${id} declares at least one tab`).toBeGreaterThan(0);
    }
  });

  it('keeps keys unique within each Mytrion', () => {
    // The grant key is the PAIR (mytrionId, key), so duplicates within a Mytrion would make one
    // grant silently control two destinations. Across Mytrions they are free to repeat — `home`
    // exists in six and means six different things.
    for (const id of MYTRION_ORDER) {
      const keys = tabsFor(id).map((t) => t.key);
      expect(new Set(keys).size, `${id} has duplicate tab keys: ${keys.join(', ')}`).toBe(
        keys.length,
      );
    }
  });

  it("keeps Manager's card ids disjoint from its department ids", () => {
    // Manager composes two arrays into one flat keyspace. They are disjoint today, and a future
    // `sales` CARD would otherwise collide with the `sales` DEPARTMENT — one grant, two surfaces.
    const manager = tabsFor('manager');
    const general = manager.filter((t) => t.group === 'General').map((t) => t.key);
    const departments = manager.filter((t) => t.group === 'Departments').map((t) => t.key);
    expect(general.length).toBeGreaterThan(0);
    expect(departments.length).toBeGreaterThan(0);
    expect(general.filter((k) => departments.includes(k))).toEqual([]);
  });

  it('uses keys the server will accept', () => {
    // mytrionPermissionSets.routes.ts validates tab keys syntactically — they are opaque strings
    // server-side, so this regex is the whole contract. A key that fails it is ungrantable.
    //
    // camelCase is allowed because the app already uses it (sales.callHub). Renaming a live key to
    // satisfy a cosmetic constraint would break every URL and stored grant naming it; the server has
    // no opinion on the shape beyond "short, and safe to put in a jsonb array".
    const SERVER = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
    const bad = allTabs()
      .filter(({ tab }) => !SERVER.test(tab.key))
      .map(({ mytrion, tab }) => `${mytrion}.${tab.key}`);
    expect(bad).toEqual([]);
  });

  it('declares no tab its Mytrion does not actually render', () => {
    /**
     * The cross-check the type system cannot do.
     *
     * `as const satisfies readonly TabDescriptor[]` pins the SHAPE of a descriptor, and deriving each
     * shell's tab-id type from the key union keeps the two vocabularies identical — but neither makes
     * a NEW descriptor a compile error, because the shells consume the union through comparisons and
     * a `Partial<Record<…>>`, not an exhaustive map. So a phantom entry here would show up in the
     * permission-set picker as a grantable tab that does not exist.
     *
     * Source-text matching is the same idiom tokens.test.ts and breakpoints.test.ts already use for
     * things TypeScript cannot express. It is deliberately loose — the key merely has to appear
     * somewhere in the workspace's own sources.
     */
    const phantom: string[] = [];
    for (const id of MYTRION_ORDER) {
      const sources = sourcesFor(join(MYTRIONS_DIR, FOLDER[id]));
      for (const tab of tabsFor(id)) {
        if (!sources.some((src) => src.includes(`'${tab.key}'`) || src.includes(`"${tab.key}"`))) {
          phantom.push(`${id}.${tab.key}`);
        }
      }
    }
    expect(phantom).toEqual([]);
  });

  it('reports stored keys that no longer name a tab, rather than dropping them', () => {
    // A rename must never silently discard grants — the editor greys these out with an explicit
    // Remove instead. Auto-pruning would be unrecoverable and invisible.
    expect(unknownTabKeys('billing', ['ledger', 'ledger-old'])).toEqual(['ledger-old']);
    expect(unknownTabKeys('billing', ['ledger'])).toEqual([]);
  });

  it('resolves a descriptor by (mytrion, key)', () => {
    expect(findTab('billing', 'ledger')?.label).toBe('Ledger');
    expect(findTab('billing', 'nope')).toBeUndefined();
    // Same key, different Mytrion — proves the pair is what identifies a tab.
    expect(findTab('hr', 'home')).toBeDefined();
    expect(findTab('finance', 'home')).toBeDefined();
    expect(findTab('hr', 'home')).not.toBe(findTab('finance', 'home'));
  });
});
