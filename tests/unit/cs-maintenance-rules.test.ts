/**
 * The two Zoho workflow rules, now running in Mytrion.
 *
 * These pin behaviour that has no visible symptom when it breaks. If the compensation defaults stop
 * applying, a case saves cleanly and looks right in the tab — the columns are simply empty, and the
 * bonus/payroll figures that multiply them quietly under-report. That is the failure mode the whole
 * module exists to prevent, so the assertions are about the stored values, not the happy path.
 *
 * Two of them pin a DELIBERATE divergence from Zoho and would (correctly) fail against a faithful
 * port — see the header of maintenanceRules.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCompaniesMock } = vi.hoisted(() => ({ searchCompaniesMock: vi.fn() }));
vi.mock('../../src/integrations/dwhCompanies.js', () => ({ searchCompanies: searchCompaniesMock }));

import {
  COMPENSATION_DEFAULTS,
  withCompensationDefaults,
  withCompensationRefill,
  withResolvedCompany,
} from '../../src/modules/customerService/maintenanceRules.js';
import { BONUS_FULL_USD, BONUS_HALF_USD } from '../../src/integrations/csMaintenance.js';
import type { NewMaintenanceCase } from '../../src/db/schema/maintenance_cases.js';

beforeEach(() => {
  vi.clearAllMocks();
  searchCompaniesMock.mockResolvedValue([]);
});

describe('rule 1 — Compensation Prepopulation, on create', () => {
  it('fills all three from the Zoho field-update values (5 / 10 / 2.5)', () => {
    const out = withCompensationDefaults({ name: 'ACME' });
    expect(out.completionCompensation).toBe('5.00');
    expect(out.leadCompensation).toBe('10.00');
    expect(out.halfCompletionCompensation).toBe('2.50');
  });

  it('stores them at NUMERIC(14,2) scale, not as bare numbers', () => {
    // The columns are numeric(14,2) and Drizzle round-trips them as strings. '5' would render as
    // "$5" in one place and "$5.00" in another.
    for (const v of Object.values(COMPENSATION_DEFAULTS)) {
      expect(v).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('DIVERGES from Zoho: one empty field does not reset a deliberate override', () => {
    // Zoho ORs the three criteria and fires all three actions unconditionally, so a hand-set 7.00
    // completion fee reverts to 5.00 whenever any other compensation is blank. Per-field here.
    const out = withCompensationDefaults({ completionCompensation: '7.00' });
    expect(out.completionCompensation).toBe('7.00');
    expect(out.leadCompensation).toBe('10.00');
    expect(out.halfCompletionCompensation).toBe('2.50');
  });

  it('treats null and a cleared input as empty, but keeps a legitimate 0.00', () => {
    // A waived fee is a real value an agent may enter; it must not be overwritten with 5.00.
    expect(withCompensationDefaults({ completionCompensation: null }).completionCompensation).toBe('5.00');
    expect(withCompensationDefaults({ completionCompensation: '  ' }).completionCompensation).toBe('5.00');
    expect(withCompensationDefaults({ completionCompensation: '0.00' }).completionCompensation).toBe('0.00');
  });

  it('does not mutate the caller\'s object', () => {
    const input = { name: 'ACME' };
    withCompensationDefaults(input);
    expect(input).toEqual({ name: 'ACME' });
  });
});

describe('rule 1 — on edit', () => {
  it('puts the default back when an edit CLEARS a compensation', () => {
    const out = withCompensationRefill({ completionCompensation: null, status: 'Completed' });
    expect(out.completionCompensation).toBe('5.00');
    expect(out.status).toBe('Completed');
  });

  it('leaves a compensation the edit never mentioned alone', () => {
    // The alternative resurrects a column the agent deliberately left as-is — and would need a read
    // of the stored row to even know its value.
    const out = withCompensationRefill({ status: 'Completed' });
    expect(out).not.toHaveProperty('completionCompensation');
    expect(out).not.toHaveProperty('leadCompensation');
    expect(out).not.toHaveProperty('halfCompletionCompensation');
  });

  it('keeps an edited override', () => {
    expect(withCompensationRefill({ leadCompensation: '25.00' }).leadCompensation).toBe('25.00');
  });
});

describe('the analytics bonus rate and the per-case default are the same number', () => {
  it('derives BONUS_FULL_USD / BONUS_HALF_USD from COMPENSATION_DEFAULTS', () => {
    // Two literals would let the payout rate drift from the fee written onto each case, and nothing
    // downstream would notice — both sides would just be internally consistent and disagree.
    expect(BONUS_FULL_USD).toBe(Number(COMPENSATION_DEFAULTS.completionCompensation));
    expect(BONUS_HALF_USD).toBe(Number(COMPENSATION_DEFAULTS.halfCompletionCompensation));
    expect(BONUS_FULL_USD).toBe(5);
    expect(BONUS_HALF_USD).toBe(2.5);
  });
});

describe('rule 2 — UpdateCompanyForMaintenance, on create', () => {
  it('fills the company from the case name, as the Zoho function effectively did', async () => {
    // Zoho searched Accounts for Account_Name == Name and CREATED that Account when missing, so the
    // linked company name always ended up equal to Name either way.
    const out = await withResolvedCompany({ name: 'ACME HAULING LLC' });
    expect(out.companyName).toBe('ACME HAULING LLC');
  });

  it('adopts the carrier id from an exact DWH match', async () => {
    searchCompaniesMock.mockResolvedValue([
      { carrierId: '5000010', companyName: 'ACME HAULING LLC', isActive: true, paymentTerms: null },
    ]);
    const out = await withResolvedCompany({ name: 'acme hauling llc' });
    expect(out.carrierId).toBe('5000010');
    expect(out.companyName).toBe('ACME HAULING LLC'); // canonical casing from the DWH
  });

  it('refuses a fuzzy match rather than attaching money to the wrong carrier', async () => {
    searchCompaniesMock.mockResolvedValue([
      { carrierId: '5000011', companyName: 'ACME HAULING LLC OF TEXAS', isActive: true, paymentTerms: null },
    ]);
    const out = await withResolvedCompany({ name: 'ACME HAULING' });
    expect(out.carrierId).toBeUndefined();
    expect(out.companyName).toBe('ACME HAULING'); // still gets a company, just not a carrier id
  });

  it('leaves an explicit pick from the tab\'s company picker untouched', async () => {
    const out = await withResolvedCompany({
      name: 'whatever the agent typed',
      companyName: 'NORTHWIND FREIGHT',
      carrierId: '5000020',
    });
    expect(out.companyName).toBe('NORTHWIND FREIGHT');
    expect(out.carrierId).toBe('5000020');
    expect(searchCompaniesMock).not.toHaveBeenCalled();
  });

  it('never writes to Zoho — it has no Zoho account id to invent', async () => {
    // Typed as the full row shape so the assertion is about the VALUE, not about T's narrow keys.
    const input: Partial<NewMaintenanceCase> = { name: 'SAMPLE HAULING CO' };
    const out = await withResolvedCompany(input);
    expect(out.companyZohoId).toBeUndefined();
  });

  it('survives a DWH outage: the case still gets a company', async () => {
    searchCompaniesMock.mockRejectedValue(new Error('dwh unreachable'));
    const out = await withResolvedCompany({ name: 'SAMPLE HAULING CO' });
    expect(out.companyName).toBe('SAMPLE HAULING CO');
    expect(out.carrierId).toBeUndefined();
  });

  it('does nothing without a name', async () => {
    const out = await withResolvedCompany({ carrierId: '5000010' });
    expect(out.companyName).toBeUndefined();
    expect(searchCompaniesMock).not.toHaveBeenCalled();
  });
});
