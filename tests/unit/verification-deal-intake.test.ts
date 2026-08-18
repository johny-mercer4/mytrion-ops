/**
 * Zoho Deal → application. This is the ONLY way an application is created, so the invariants it
 * establishes are the ones the whole two-desk flow rests on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const insertMock = vi.fn();
const seedPhasesMock = vi.fn();
const refreshGateMock = vi.fn();

vi.mock('../../src/repos/verificationFlowRepo.js', () => ({
  verificationFlowRepo: { insert: (...a: unknown[]) => insertMock(...a) },
}));
vi.mock('../../src/repos/verificationCaseAssetRepo.js', () => ({
  verificationCaseAssetRepo: { seedPhases: (...a: unknown[]) => seedPhasesMock(...a) },
}));
vi.mock('../../src/modules/verificationFlow/applicationService.js', () => ({
  applicationService: { refreshGate: (...a: unknown[]) => refreshGateMock(...a) },
}));

const { createApplicationFromDeal, inferApplicantType } = await import(
  '../../src/modules/verificationFlow/dealIntake.js'
);

const ctx = { tenantId: DEFAULT_TENANT_ID, userId: 'system', audience: 'internal', role: 'admin' } as TenantContext;
const FALLBACK = { fallbackOwnerZohoUserId: 'desk-owner', fallbackOwnerName: 'Verification' };

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ id: 'vc_1', applicantType: null });
  seedPhasesMock.mockReset().mockResolvedValue(undefined);
  refreshGateMock.mockReset().mockResolvedValue(undefined);
});

const deal = (over: Record<string, unknown> = {}) => ({
  zohoDealId: '778899',
  companyName: 'Blue Ridge Hauling LLC',
  zohoOwnerId: 'zoho-42',
  zohoOwnerName: 'Dana Reed',
  ...over,
});

describe('applicant type inference', () => {
  it('is a carrier when there is authority', () => {
    expect(inferApplicantType(deal({ mc: '1234567' }))).toBe('carrier');
    expect(inferApplicantType(deal({ dot: '987654', companyName: 'Ray Diaz' }))).toBe('carrier');
  });

  it('is an owner-operator when Zoho SAYS the applicant is a person', () => {
    // The two Business_Type values that mean a human: everything else in the picklist is a company.
    expect(inferApplicantType(deal({ businessType: 'Sole Proprietorship' }))).toBe('owner_operator');
    expect(inferApplicantType(deal({ businessType: 'natural person' }))).toBe('owner_operator');
  });

  it('never guesses from the COMPANY NAME — that is what produced the wrong type', () => {
    // "Blue Ridge Hauling LLC" with no authority used to infer `company` off an `llc` regex. An
    // owner-operator trading as an LLC is indistinguishable this way, so the name is not a signal.
    expect(inferApplicantType(deal())).toBeNull();
    expect(inferApplicantType(deal({ companyName: 'Sehaj Logistics Inc' }))).toBeNull();
    expect(inferApplicantType(deal({ companyName: 'Efrain Mendoza Buitron' }))).toBeNull();
    expect(inferApplicantType(deal({ companyName: '' }))).toBeNull();
  });

  it('never returns the retired third type', () => {
    // Two types now: `owner_operator` and `carrier`. `company` is still READ (rows carry it) but
    // nothing produces it any more.
    for (const over of [
      {},
      { companyName: 'Anything Corp' },
      { businessType: 'Limited Liability Company' },
      { businessType: 'Corporation', mc: '1234567' },
    ]) {
      expect(inferApplicantType(deal(over))).not.toBe('company');
    }
  });

  it('is not fooled by a business type that merely mentions a company form', () => {
    expect(inferApplicantType(deal({ businessType: 'Limited Liability Company' }))).toBeNull();
    expect(inferApplicantType(deal({ businessType: 'Corporation' }))).toBeNull();
  });
});

describe('the fuel-card count comes off the Deal', () => {
  it('carries Cards_Requested onto the case', async () => {
    // Populated on every live Deal and never read, so "Number of fuel cards requested" sat on
    // EVERY case's missing list and the roster showed a dash.
    await createApplicationFromDeal(ctx, deal({ cardsRequested: '5' }), FALLBACK);
    expect((insertMock.mock.calls[0]?.[1] as Record<string, unknown>).fuelCardsRequested).toBe(5);
  });

  it('treats a blank or zero count as no information, not a request for zero', async () => {
    for (const value of ['', '0', 'n/a', undefined]) {
      insertMock.mockClear();
      await createApplicationFromDeal(ctx, deal({ cardsRequested: value }), FALLBACK);
      expect(
        (insertMock.mock.calls[0]?.[1] as Record<string, unknown>).fuelCardsRequested,
        String(value),
      ).toBeNull();
    }
  });

  it('falls back to the secondary contact fields Zoho already holds', async () => {
    await createApplicationFromDeal(
      ctx,
      deal({ email: '', secondaryEmail: 'ops@blueridge.test', phone: '', cell: '', alternativeContact: '6145550110' }),
      FALLBACK,
    );
    const row = insertMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(row.email).toBe('ops@blueridge.test');
    expect(row.phone).toBe('6145550110');
  });
});

describe('creating an application from a deal', () => {
  it('lands RED, at phase 1, from the deal origin', async () => {
    await createApplicationFromDeal(ctx, deal({ mc: '1234567' }), FALLBACK);
    const row = insertMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(row.verificationProcess).toBe(false);
    expect(row.phaseCode).toBe('p1_intake');
    expect(row.statusCode).toBe('intake_incomplete');
    expect(row.origin).toBe('zoho_deal');
    expect(row.zohoDealId).toBe('778899');
  });

  it('gives the application to the DEAL owner, which is what makes Sales able to see it', async () => {
    await createApplicationFromDeal(ctx, deal(), FALLBACK);
    const row = insertMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(row.ownerZohoUserId).toBe('zoho-42');
    expect(row.zohoOwnerId).toBe('zoho-42');
    expect(row.ownerName).toBe('Dana Reed');
  });

  it('still creates an unowned deal, but does not invent a Sales owner for it', async () => {
    await createApplicationFromDeal(ctx, deal({ zohoOwnerId: '', zohoOwnerName: '' }), FALLBACK);
    const row = insertMock.mock.calls[0]?.[1] as Record<string, unknown>;
    // Owned by the desk so the NOT NULL column is satisfied and the row is not orphaned...
    expect(row.ownerZohoUserId).toBe('desk-owner');
    // ...but zohoOwnerId stays null, so the Sales list does not claim an agent who does not exist.
    expect(row.zohoOwnerId).toBeNull();
  });

  it('seeds all ten phases, marking the carrier-only ones skipped for an owner-operator', async () => {
    insertMock.mockResolvedValue({ id: 'vc_1', applicantType: 'owner_operator' });
    await createApplicationFromDeal(ctx, deal({ companyName: 'Ray Diaz', mc: '', dot: '' }), FALLBACK);
    // No confident signal → applicantType null → the carrier phases are still seeded as applicable,
    // because we do not yet know they do not apply.
    const phases = seedPhasesMock.mock.calls[0]?.[2] as Array<{ phaseCode: string; status: string }>;
    expect(phases).toHaveLength(10);
    expect(phases.map((p) => p.phaseCode)).toContain('p4_authority');
  });

  it('marks phases 4 and 8 skipped when the deal is clearly a company', async () => {
    await createApplicationFromDeal(ctx, deal(), FALLBACK);
    const phases = seedPhasesMock.mock.calls[0]?.[2] as Array<{ phaseCode: string; status: string }>;
    const byCode = new Map(phases.map((p) => [p.phaseCode, p.status]));
    expect(byCode.get('p4_authority')).toBe('skipped');
    expect(byCode.get('p8_highway')).toBe('skipped');
    expect(byCode.get('p6_credit_banking')).toBe('not_started');
  });

  it('computes the missing list immediately, so the red card is not empty', async () => {
    await createApplicationFromDeal(ctx, deal(), FALLBACK);
    expect(refreshGateMock).toHaveBeenCalledWith(ctx, 'vc_1');
  });

  it('keeps the application when the gate refresh fails rather than losing the deal', async () => {
    refreshGateMock.mockRejectedValue(new Error('db down'));
    await expect(createApplicationFromDeal(ctx, deal(), FALLBACK)).resolves.toMatchObject({ id: 'vc_1' });
  });

  it('reads a truck count out of free text, and treats nonsense as no information', async () => {
    await createApplicationFromDeal(ctx, deal({ truckCount: '12 trucks' }), FALLBACK);
    expect((insertMock.mock.calls[0]?.[1] as Record<string, unknown>).trucksCount).toBe(12);

    insertMock.mockClear();
    await createApplicationFromDeal(ctx, deal({ truckCount: 'a few' }), FALLBACK);
    // Not 0 — zero trucks is a claim, and "a few" is not one.
    expect((insertMock.mock.calls[0]?.[1] as Record<string, unknown>).trucksCount).toBeNull();
  });
});
