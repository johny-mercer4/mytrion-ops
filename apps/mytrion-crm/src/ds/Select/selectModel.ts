/*
 * Select — the option model. What the list CONTAINS and what a query does to it, with no React and
 * no DOM in sight.
 *
 * It lives beside Select.tsx rather than inside it for two reasons: the component was over this
 * repo's 600-line file cap with it inlined, and filtering is the part most likely to be argued
 * about (prefix ranking, whether hints match, whether groups reorder). Isolated, those arguments are
 * settled by reading forty lines instead of six hundred.
 *
 * Nothing here is exported from src/ds — the public types are re-exported through Select.tsx so the
 * barrel has one door.
 */
import type { IconName } from '../Icon/Icon';

export interface SelectOption {
  /** The stable identity written back through `onChange`. Never the label. */
  value: string;
  /** What the user reads, and what the filter matches on first. */
  label: string;
  /** Secondary text, right-aligned and muted — a count, a carrier id, a department. Also matched. */
  hint?: string;
  /** Leading glyph. A name, because the icon family is not the caller's choice. */
  icon?: IconName;
  /**
   * Offered but not choosable. It stays VISIBLE and stays in the list — an option that vanishes when
   * it becomes unavailable teaches the user it never existed, and they stop looking for it.
   */
  disabled?: boolean;
}

export interface SelectOptionGroup {
  /** Stable key for the group, and the id its heading is announced through. */
  id: string;
  /** The group heading. It is a heading, not an option: it can never be chosen or highlighted. */
  label: string;
  options: readonly SelectOption[];
}

/** A flat option or a labelled group of them. Mixing both in one array is fine and common. */
export type SelectItem = SelectOption | SelectOptionGroup;

export function isGroup(item: SelectItem): item is SelectOptionGroup {
  return 'options' in item;
}

export function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** A group after filtering. `label` is null for the options that arrived ungrouped. */
export interface VisibleGroup {
  key: string;
  label: string | null;
  rows: ReadonlyArray<{ option: SelectOption; index: number }>;
}

export interface VisibleModel {
  /** The render tree — groups in author order, headings intact. */
  groups: readonly VisibleGroup[];
  /** The SAME options, flat and index-addressable. This is what the keyboard walks. */
  flat: readonly SelectOption[];
}

/**
 * Build the grouped render tree and the flat navigation list IN ONE PASS, sharing one index space.
 *
 * Deriving those two separately is precisely how a highlight ends up pointing at a row other than
 * the one lit on screen — the bug every picker this component replaces has shipped at least once.
 *
 * @param keyPrefix a per-instance id, so the synthetic keys for ungrouped runs cannot collide with
 *                  another Select's on the same page.
 */
export function buildVisible(
  options: readonly SelectItem[],
  query: string,
  keyPrefix: string,
): VisibleModel {
  const q = query.trim().toLowerCase();
  const groups: VisibleGroup[] = [];
  const flat: SelectOption[] = [];

  const matches = (o: SelectOption): boolean =>
    !q || o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false);

  const rank = (o: SelectOption): number => {
    const l = o.label.toLowerCase();
    if (l.startsWith(q)) return 0;
    if (l.includes(q)) return 1;
    // Matched on the hint only. A weaker signal than the label, so it sorts to the bottom rather
    // than interleaving with rows whose visible text explains why they are there.
    return 2;
  };

  const push = (key: string, label: string | null, pool: readonly SelectOption[]): void => {
    const kept = pool.filter(matches);
    if (kept.length === 0) return;
    // Prefix matches first, so typing "ma" surfaces "Mara" above "Tamara". Ranking happens WITHIN a
    // group and never across them: reordering groups would move the headings out from under the
    // user mid-keystroke.
    if (q) kept.sort((a, b) => rank(a) - rank(b));
    groups.push({
      key,
      label,
      rows: kept.map((option) => ({ option, index: flat.push(option) - 1 })),
    });
  };

  // Ungrouped options between two groups keep their place instead of being hoisted into one bucket
  // at the top — the caller's order is a decision, not an accident.
  let loose: SelectOption[] = [];
  let looseAt = 0;
  const flushLoose = (): void => {
    if (loose.length === 0) return;
    push(`${keyPrefix}-loose-${looseAt++}`, null, loose);
    loose = [];
  };

  for (const item of options) {
    if (isGroup(item)) {
      flushLoose();
      push(item.id, item.label, item.options);
    } else {
      loose.push(item);
    }
  }
  flushLoose();

  return { groups, flat };
}

/**
 * Resolve selected values to options for display.
 *
 * A value with no matching option renders as its own raw value rather than disappearing. A chip that
 * silently vanishes reads as "the app dropped my selection", and the usual cause is benign — the
 * options list has not finished loading yet.
 */
export function resolveSelected(
  options: readonly SelectItem[],
  selected: readonly string[],
): readonly SelectOption[] {
  const byValue = new Map<string, SelectOption>();
  for (const item of options) {
    if (isGroup(item)) for (const o of item.options) byValue.set(o.value, o);
    else byValue.set(item.value, item);
  }
  return selected.map((v) => byValue.get(v) ?? { value: v, label: v });
}
