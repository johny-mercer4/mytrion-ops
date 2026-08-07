/**
 * The Billing Ledger section catalog — the SINGLE source of truth for section ids, labels, which
 * client type owns them, what Debit/Credit mean, and which external system the Closing balance is
 * reconciled against. The API, the Excel template, the importer, the nightly snapshot job and the
 * frontend sub-nav all read this, so none of them can disagree about a section's name or ownership.
 *
 * From the TZ (§5.1, §5.2). The chain rule — "Credit of one section becomes Debit of the next" — is
 * enforced in feeds.ts by literally calling the same feed function for both sides, not by convention
 * here; `chainsTo` only documents the intent so a test can assert it.
 *
 * WEX-Funded carriers are outside the module entirely (TZ §5.3) and therefore have no sections.
 */

export const LEDGER_SECTION_IDS = ['cb-loc', 'unbilled', 'ar', 'cb-prepay', 'untopped'] as const;
export type LedgerSectionId = (typeof LEDGER_SECTION_IDS)[number];

export type LedgerClientType = 'LOC' | 'Prepay';

/** Which independent system the Closing balance is checked against (TZ §5's control mechanism). */
export type LedgerExternalSource = 'efs' | 'cmp_invoice' | 'cmp_balance_after' | 'payments_unapplied';

export interface LedgerSectionDef {
  id: LedgerSectionId;
  label: string;
  /** Which client type this sub-ledger belongs to. */
  clientType: LedgerClientType;
  /** Plain-English Debit rule, surfaced in the UI's formula caption and the template instructions. */
  debit: string;
  credit: string;
  /** What "positive" means for this section's balance — the sign convention agents key against. */
  positiveMeans: string;
  externalSource: LedgerExternalSource;
  /** The section whose Debit this section's Credit feeds, if any. */
  chainsTo: LedgerSectionId | null;
  /** True when a non-zero Closing is itself the alarm (transient sections). */
  shouldTrendToZero: boolean;
  description: string;
}

export const LEDGER_SECTIONS: readonly LedgerSectionDef[] = [
  {
    id: 'cb-loc',
    label: 'Customer Balance (LOC)',
    clientType: 'LOC',
    debit: 'Top-ups, net of draws',
    credit: 'All carrier transactions (fuel, money code, maintenance)',
    positiveMeans: 'Funds available on the EFS contract',
    externalSource: 'efs',
    chainsTo: 'unbilled',
    shouldTrendToZero: false,
    description:
      'Company funds loaded onto the carrier’s EFS account, less what the carrier has spent. Reconciled against the actual EFS balance.',
  },
  {
    id: 'unbilled',
    label: 'Unbilled Transactions',
    clientType: 'LOC',
    debit: 'Transactions incurred (fuel, money code, maintenance)',
    credit: 'Amount included in a CMP invoice',
    positiveMeans: 'Incurred but not yet invoiced',
    externalSource: 'cmp_invoice',
    chainsTo: 'ar',
    shouldTrendToZero: true,
    // TZ §5.1 control point: a non-zero closing at cycle end means transactions CMP never invoiced.
    description:
      'Spend that has happened but has not yet reached an invoice. Should return to zero by the end of each billing cycle — a residual means CMP missed something.',
  },
  {
    id: 'ar',
    label: 'Accounts Receivable',
    clientType: 'LOC',
    debit: 'CMP invoices issued',
    credit: 'Payments applied',
    positiveMeans: 'The carrier owes us',
    externalSource: 'cmp_invoice',
    chainsTo: null,
    shouldTrendToZero: false,
    description:
      'What LOC carriers currently owe. Reconciled against CMP’s own open-invoice balance and the payment gateways.',
  },
  {
    id: 'cb-prepay',
    label: 'Customer Balance (Prepay)',
    clientType: 'Prepay',
    debit: 'Top-ups, net of draws',
    credit: 'All carrier transactions (fuel, money code, maintenance)',
    positiveMeans: 'Deposit remaining on the EFS contract',
    externalSource: 'efs',
    chainsTo: null,
    shouldTrendToZero: false,
    // TZ §5.2: no invoice is raised — spend consumes a deposit the carrier already paid.
    description:
      'The carrier’s remaining prepaid deposit. No invoice is raised; spend simply draws the deposit down. Reconciled against the actual EFS balance.',
  },
  {
    id: 'untopped',
    label: 'Un Top-Upped Payments',
    clientType: 'Prepay',
    debit: 'Payments received from the carrier',
    credit: 'Top-up applied to their EFS account',
    positiveMeans: 'Received but not yet loaded to EFS',
    externalSource: 'payments_unapplied',
    chainsTo: 'cb-prepay',
    shouldTrendToZero: true,
    // TZ §5.2 control point: nothing should sit here longer than 24h.
    description:
      'Money received from a Prepay carrier that has not yet been loaded onto their EFS account. A payment sitting here longer than 24 hours is an alarm.',
  },
];

const BY_ID = new Map<LedgerSectionId, LedgerSectionDef>(LEDGER_SECTIONS.map((s) => [s.id, s]));

export function isLedgerSectionId(value: string): value is LedgerSectionId {
  return BY_ID.has(value as LedgerSectionId);
}

export function getLedgerSection(id: LedgerSectionId): LedgerSectionDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown ledger section: ${id}`);
  return def;
}

/** The sections that apply to a carrier of this type — the manual-entry form and the template use it. */
export function sectionsForClientType(clientType: LedgerClientType): readonly LedgerSectionDef[] {
  return LEDGER_SECTIONS.filter((s) => s.clientType === clientType);
}
