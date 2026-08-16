/**
 * The loyalty export's month relationship, scope and column parity.
 *
 * THE CLAIM UNDER TEST: pick July and you get each company's JULY activity, tiered by JUNE. That is
 * one sentence and it is the entire feature; it is also the single thing a well-meaning refactor is
 * most likely to invert, because the shared resolver's input fields are still named `prevMonth` /
 * `thisMonth` (they have to be — the board is anchored on today). If `toTierInput` ever swaps them
 * the file still exports, still looks plausible, and is wrong for every row.
 *
 * So the first two suites deliberately use rows where the two months disagree LOUDLY — Gold-sized
 * basis gallons against zero reported gallons, and the reverse — because a row where both months look
 * similar cannot fail this test.
 */
import { describe, expect, it } from 'vitest';

import type { LoyaltyMonthClient, LoyaltyMonthRoster } from '../../../api/loyalty';
import {
  EXPORT_COLUMNS,
  applyScope,
  buildExportPayload,
  exportFileStem,
  scoreMonthClients,
  summariseExport,
} from './loyaltyExportModel';
import { buildLoyaltyCsv } from './loyaltyExportFile';
import { PERK_OFF, PERK_ON, PERK_SET_CUSTOM, PERK_SET_DEFAULT } from './loyaltyExportStyle';

const client = (over: Partial<LoyaltyMonthClient> = {}): LoyaltyMonthClient => ({
  carrierId: '5794015',
  companyName: 'KBUFF TRUCKING LTD',
  agentName: 'Diana Rose',
  trucks: 1,
  activeCards: 12,
  currentStoredTierName: '',
  retainedTierName: '',
  basisActiveCards: 0,
  basisInNetworkGallons: 0,
  basisTotalGallons: 0,
  basisTransactions: 0,
  monthActiveCards: 0,
  monthInNetworkGallons: 0,
  monthTotalGallons: 0,
  monthTransactions: 0,
  cycleGallons: 0,
  lastTransactionAt: null,
  loyaltyOverride: null,
  ...over,
});

/** July 2026, reported; June 2026 earns the tier. A closed month, so no retained tier is in play. */
const roster = (clients: LoyaltyMonthClient[]): LoyaltyMonthRoster => ({
  month: '2026-07-01',
  basisMonth: '2026-06-01',
  monthLabel: 'July 2026',
  basisMonthLabel: 'June 2026',
  cycleLabel: '26 Jun – 25 Jul 2026',
  monthComplete: true,
  clients,
  total: clients.length,
  fetchedAt: '2026-08-01T09:00:00.000Z',
});

const rowsFor = (clients: LoyaltyMonthClient[]) => buildExportPayload(roster(clients), 'all').rows;

describe('the tier comes from the basis month', () => {
  it('tiers a single-card carrier on JUNE gallons even when JULY is silent', () => {
    // T1 (1 transacting card) Gold starts at 2,000 in-network gallons. June cleared it; July is dead.
    const [row] = rowsFor([
      client({ basisActiveCards: 1, basisInNetworkGallons: 2400, monthInNetworkGallons: 0 }),
    ]);
    expect(row!.tier).toBe('Gold');
    expect(row!.basisInNetworkGallons).toBe(2400);
    expect(row!.monthInNetworkGallons).toBe(0);
  });

  it('does NOT tier on July gallons — a dead June is a calibration month however big July is', () => {
    // The inversion this file exists to catch: were the windows swapped, 9,000 July gallons on one
    // card would read Gold instead of Building.
    const [row] = rowsFor([
      client({
        basisActiveCards: 0,
        basisInNetworkGallons: 0,
        monthActiveCards: 1,
        monthInNetworkGallons: 9000,
      }),
    ]);
    expect(row!.tier).toBe('Building');
    expect(row!.tierBasis).toBe('Calibration (no basis month activity)');
  });

  it('takes the TRACK from the basis month too, not from the reported month', () => {
    // 1 card in June (T1, Gold at 2,000) vs 9 cards in July (T3 Large, Gold at 19,000). 4,000 gallons
    // is Gold on the June track and would not even be Bronze on the July one.
    const [row] = rowsFor([
      client({
        basisActiveCards: 1,
        basisInNetworkGallons: 4000,
        monthActiveCards: 9,
        monthInNetworkGallons: 4000,
      }),
    ]);
    expect(row!.tier).toBe('Gold');
    expect(row!.track).toBe('Owner-Operator');
    expect(row!.goldThreshold).toBe(2000);
  });

  it('reports the projected next tier from the reported month, which is a different answer', () => {
    // June: 1 card / 2,400 gal → Gold today. July: 2 cards / 2,400 gal → T2, where Bronze is 2,200
    // and Gold is 4,500. So the row holds Gold and projects Bronze — both true, of different months.
    const [row] = rowsFor([
      client({
        basisActiveCards: 1,
        basisInNetworkGallons: 2400,
        monthActiveCards: 2,
        monthInNetworkGallons: 2400,
      }),
    ]);
    expect(row!.tier).toBe('Gold');
    expect(row!.projectedTier).toBe('Bronze');
  });
});

describe('the reported month supplies the activity columns', () => {
  it('keeps each figure in its own month, and derives the change between them', () => {
    const [row] = rowsFor([
      client({
        basisActiveCards: 3,
        basisInNetworkGallons: 2000,
        basisTotalGallons: 2100,
        basisTransactions: 40,
        monthActiveCards: 4,
        monthInNetworkGallons: 2500,
        monthTotalGallons: 2600,
        monthTransactions: 55,
        cycleGallons: 2450,
      }),
    ]);
    expect(row!.exportMonth).toBe('July 2026');
    expect(row!.basisMonth).toBe('June 2026');
    expect(row!.basisActiveCards).toBe(3);
    expect(row!.monthActiveCards).toBe(4);
    expect(row!.monthTransactions).toBe(55);
    expect(row!.cycleGallons).toBe(2450);
    expect(row!.monthOverBasisChange).toBeCloseTo(0.25, 10);
  });

  it('leaves the change empty rather than dividing by a zero basis month', () => {
    const [row] = rowsFor([client({ monthActiveCards: 2, monthInNetworkGallons: 900 })]);
    expect(row!.monthOverBasisChange).toBeNull();
  });

  it('carries the last transaction as a UTC-anchored date, not a local one', () => {
    const [row] = rowsFor([client({ lastTransactionAt: '2026-07-01' })]);
    expect(row!.lastTransactionAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('a retained tier is only used when the server sent one', () => {
  it('exports a fully dormant carrier as not evaluated when no tier was retained', () => {
    const [row] = rowsFor([client()]);
    expect(row!.tier).toBe('No Tier');
    expect(row!.tierBasis).toBe('Not evaluated');
  });

  it('honours a retained tier when the server did forward one (a current-month export)', () => {
    const [row] = rowsFor([client({ retainedTierName: 'Silver' })]);
    expect(row!.tier).toBe('Silver');
    expect(row!.tierBasis).toBe('Retained from warehouse');
  });
});

describe('perks follow the tier, and an exception says so', () => {
  it('includes the Bronze-and-up perks for a Bronze carrier and nothing above them', () => {
    const [row] = rowsFor([client({ basisActiveCards: 1, basisInNetworkGallons: 1200 })]);
    expect(row!.tier).toBe('Bronze');
    expect(row!.perks.transaction_fee_waiver).toBe(PERK_ON);
    expect(row!.perks.money_code_limit).toBe(PERK_ON);
    expect(row!.perks.monthly_fee_waiver).toBe(PERK_OFF);
    expect(row!.perks.loves_rebate).toBe(PERK_OFF);
    expect(row!.moneyCodeLimit).toBe('20%');
    expect(row!.perkSet).toBe(PERK_SET_DEFAULT);
  });

  it('scales the money-code limit with the tier', () => {
    const [row] = rowsFor([client({ basisActiveCards: 1, basisInNetworkGallons: 2400 })]);
    expect(row!.tier).toBe('Gold');
    expect(row!.moneyCodeLimit).toBe('30%');
  });

  it('reports a manual checklist as an exception, with the note and its date', () => {
    const [row] = rowsFor([
      client({
        basisActiveCards: 1,
        basisInNetworkGallons: 2400,
        loyaltyOverride: {
          carrierId: '5794015',
          enterpriseMode: 'volume_target',
          enterpriseGoldTargetGallons: 23000,
          enabledRewardIds: ['loves_rebate'],
          note: 'Contract exception',
          updatedBy: 'CI Test Admin',
          updatedAt: '2026-05-02T10:00:00.000Z',
        },
      }),
    ]);
    expect(row!.perkSet).toBe(PERK_SET_CUSTOM);
    expect(row!.perks.loves_rebate).toBe(PERK_ON);
    expect(row!.perks.transaction_fee_waiver).toBe(PERK_OFF);
    expect(row!.perksIncluded).toBe(1);
    expect(row!.moneyCodeLimit).toBe('—');
    expect(row!.enterpriseMode).toBe('Volume target');
    expect(row!.enterpriseGoldTarget).toBe(23000);
    // Dated so a reader can see the exception predates the exported month.
    expect(row!.overrideUpdatedAt?.toISOString()).toBe('2026-05-02T10:00:00.000Z');
  });
});

describe('scope', () => {
  const population = [
    client({ carrierId: 'gold', basisActiveCards: 1, basisInNetworkGallons: 2400 }),
    client({ carrierId: 'building', basisActiveCards: 2, basisInNetworkGallons: 100 }),
    client({ carrierId: 'active-untiered', basisActiveCards: 0, monthActiveCards: 0 }),
    client({ carrierId: 'dormant', basisActiveCards: 0 }),
  ];

  it('keeps every carrier under "all"', () => {
    expect(applyScope(scoreMonthClients(roster(population)), 'all')).toHaveLength(4);
  });

  it('keeps only tier holders under "tiered"', () => {
    const kept = applyScope(scoreMonthClients(roster(population)), 'tiered');
    expect(kept.map((row) => row.client.carrierId)).toEqual(['gold']);
  });

  it('drops untiered dormant carriers under "active", matching the board', () => {
    const kept = applyScope(scoreMonthClients(roster(population)), 'active');
    // `active-untiered` and `dormant` both have a zero basis month and no tier, so neither is in the
    // population — same predicate the board applies (loyaltyPopulation.ts).
    expect(kept.map((row) => row.client.carrierId)).toEqual(['gold', 'building']);
  });
});

describe('the summary describes exactly what is in the file', () => {
  it('shares sum to 1 over the exported population, not the whole roster', () => {
    const payload = buildExportPayload(
      roster([
        client({ carrierId: 'a', basisActiveCards: 1, basisInNetworkGallons: 2400 }),
        client({ carrierId: 'b', basisActiveCards: 2, basisInNetworkGallons: 100 }),
        client({ carrierId: 'c', basisActiveCards: 0 }),
      ]),
      'active',
    );
    expect(payload.rows).toHaveLength(2);
    expect(payload.summary.carriers).toBe(2);
    const shares = payload.summary.buckets.reduce((sum, b) => sum + b.share, 0);
    expect(shares).toBeCloseTo(1, 10);
  });

  it('counts tier holders and exceptions', () => {
    const summary = summariseExport(
      scoreMonthClients(
        roster([
          client({ carrierId: 'a', basisActiveCards: 1, basisInNetworkGallons: 2400 }),
          client({
            carrierId: 'b',
            basisActiveCards: 1,
            basisInNetworkGallons: 1200,
            loyaltyOverride: {
              carrierId: 'b',
              enterpriseMode: null,
              enterpriseGoldTargetGallons: null,
              enabledRewardIds: [],
              note: null,
              updatedBy: 'CI Test Admin',
              updatedAt: '2026-05-02T10:00:00.000Z',
            },
          }),
        ]),
      ),
    );
    expect(summary.tierHolders).toBe(2);
    expect(summary.exceptions).toBe(1);
    expect(summary.basisInNetworkGallons).toBe(3600);
  });
});

describe('the CSV is the same file in another encoding', () => {
  const csv = buildLoyaltyCsv(
    rowsFor([client({ basisActiveCards: 1, basisInNetworkGallons: 2400, lastTransactionAt: '2026-07-24' })]),
  );
  const lines = csv.replace('﻿', '').split('\r\n');

  it('leads with a BOM so Excel on Windows reads UTF-8 names correctly', () => {
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('carries every column from the shared definition, in order', () => {
    expect(lines[0]).toBe(EXPORT_COLUMNS.map((c) => `"${c.label}"`).join(','));
    expect(lines[1]!.split('","')).toHaveLength(EXPORT_COLUMNS.length);
  });

  it('emits the same picklist text the workbook paints', () => {
    expect(lines[1]).toContain('"Gold"');
    expect(lines[1]).toContain(`"${PERK_ON}"`);
  });

  it('renders dates as YYYY-MM-DD rather than a locale string', () => {
    expect(lines[1]).toContain('"2026-07-24"');
  });

  it('escapes a quote in a company name instead of breaking the row', () => {
    const quoted = buildLoyaltyCsv(rowsFor([client({ companyName: 'BIG "RIG" LLC' })]));
    expect(quoted).toContain('"BIG ""RIG"" LLC"');
    expect(quoted.replace('﻿', '').split('\r\n')).toHaveLength(2);
  });
});

describe('the filename names the month and the scope', () => {
  it('puts the month first so a folder of exports sorts chronologically', () => {
    expect(exportFileStem(roster([]), 'active')).toBe('Loyalty_Tiers_2026-07_Active-clients');
    expect(exportFileStem(roster([]), 'tiered')).toBe('Loyalty_Tiers_2026-07_Tier-holders-only');
  });
});
