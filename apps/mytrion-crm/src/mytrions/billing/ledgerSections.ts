/**
 * Ledger sub-nav configuration — the ONE array that drives every balance section.
 *
 * The five balance sections are isomorphic: they differ only in an extra Billing Cycle column
 * (unbilled), which side the breakdown subnote sums, the reconciliation-caption rule, and an aging
 * footer (AR). So one config array feeds one generic table component rather than five near-copies of
 * the same ~180 lines of skeleton + pagination + empty/error + amount-cell markup. If adding a
 * section is not nearly free, this shape is wrong.
 *
 * Labels are ENGLISH. The source prototype and the TZ are in Russian; the app is not.
 *
 * `disabled` parks an entry with the shell's own "Soon" affordance. The derived `*_PARKED` consts
 * below read the flag back out of this array so the nav and the render map cannot drift — the
 * `TICKETS_PARKED` pattern from Shell.tsx.
 */
import type { LedgerSectionId } from '../../api/ledgerTypes';

/** Everything the sub-nav can show, including the non-balance surfaces. */
export type LedgerTabId = LedgerSectionId | 'transitions' | 'payments' | 'openings';

/** Sub-nav grouping headers, in display order. */
export type LedgerGroup = 'LOC clients' | 'Prepay clients' | 'Client type' | 'General' | 'Setup';

export interface LedgerTabDef {
  id: LedgerTabId;
  label: string;
  /** Short label for the narrow/scrolled sub-nav. */
  shortLabel: string;
  group: LedgerGroup;
  /**
   * False when the surface ignores the period bar (payments journal, opening-balance setup). The
   * period bar is HIDDEN for these — showing a control that provably does nothing is worse than
   * omitting it — and they are exempt from the Apply remount.
   */
  periodDriven: boolean;
  /** True for the five Opening/Debit/Credit/Closing sections. */
  isBalanceSection: boolean;
  disabled?: boolean;
  /** Scope pill next to the panel title. */
  scope?: string;
}

export const LEDGER_TABS: readonly LedgerTabDef[] = [
  {
    id: 'cb-loc',
    label: 'Customer Balance (LOC)',
    shortLabel: 'CB (LOC)',
    group: 'LOC clients',
    periodDriven: true,
    isBalanceSection: true,
    scope: 'LOC',
  },
  {
    id: 'unbilled',
    label: 'Unbilled Transactions',
    shortLabel: 'Unbilled',
    group: 'LOC clients',
    periodDriven: true,
    isBalanceSection: true,
    scope: 'LOC',
  },
  {
    id: 'ar',
    label: 'Accounts Receivable',
    shortLabel: 'AR',
    group: 'LOC clients',
    periodDriven: true,
    isBalanceSection: true,
    scope: 'LOC',
  },
  {
    id: 'cb-prepay',
    label: 'Customer Balance (Prepay)',
    shortLabel: 'CB (Prepay)',
    group: 'Prepay clients',
    periodDriven: true,
    isBalanceSection: true,
    scope: 'Prepay',
  },
  {
    id: 'untopped',
    label: 'Un Top-Upped Payments',
    shortLabel: 'Un Top-Upped',
    group: 'Prepay clients',
    periodDriven: true,
    isBalanceSection: true,
    scope: 'Prepay',
  },
  {
    id: 'transitions',
    label: 'LOC ↔ Prepay history',
    shortLabel: 'Transitions',
    group: 'Client type',
    periodDriven: false,
    isBalanceSection: false,
    // PARKED. The effective-dated transition WORKFLOW (TZ §8) is deferred, and no client-type change
    // log exists yet — so a live table here would render empty. An empty table is a factual claim
    // ("no transitions have occurred"); a "Soon" badge is a claim about the software. Only the second
    // one is true today. Drop this flag once the override history has data worth reading.
    disabled: true,
    scope: 'effective-dated',
  },
  {
    id: 'payments',
    label: 'Payments',
    shortLabel: 'Payments',
    group: 'General',
    periodDriven: false,
    isBalanceSection: false,
    disabled: true,
    scope: 'LOC + Prepay',
  },
  {
    id: 'openings',
    label: 'Opening Balances',
    shortLabel: 'Openings',
    group: 'Setup',
    periodDriven: false,
    isBalanceSection: false,
  },
];

/** Group order for rendering — derived once so the sub-nav and any legend agree. */
export const LEDGER_GROUPS: readonly LedgerGroup[] = [
  'LOC clients',
  'Prepay clients',
  'Client type',
  'General',
  'Setup',
];

const BY_ID = new Map<LedgerTabId, LedgerTabDef>(LEDGER_TABS.map((t) => [t.id, t]));

export function getLedgerTab(id: LedgerTabId): LedgerTabDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown ledger tab: ${id}`);
  return def;
}

/** Read the parked flags back out of the array so they cannot drift from the nav. */
export const TRANSITIONS_PARKED = LEDGER_TABS.some((t) => t.id === 'transitions' && t.disabled === true);
export const PAYMENTS_PARKED = LEDGER_TABS.some((t) => t.id === 'payments' && t.disabled === true);

/** The first tab that is actually usable — where the panel opens. */
export const LEDGER_DEFAULT_TAB: LedgerTabId =
  LEDGER_TABS.find((t) => !t.disabled)?.id ?? 'openings';
