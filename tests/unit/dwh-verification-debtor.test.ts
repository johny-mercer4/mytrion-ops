/**
 * Data Center Blacklist debtor SQL.
 *
 * Pins the company-wide money bar: outstanding > $100. Finance/Sales still use ≥ $1;
 * this desk must not silently keep that floor. Age ≥ 2 days is same-day noise only.
 */
import { describe, expect, it } from 'vitest';
import {
  DEBTOR_HAVING_SQL,
  DEBTOR_OPEN_INVOICE_SQL,
  DEBTOR_OUTSTANDING_SQL,
  DEBTOR_SEARCH_SQL,
  VERIFICATION_DEBTOR_MIN_AGE_DAYS,
  VERIFICATION_DEBTOR_OUTSTANDING_MIN,
} from '../../src/repos/dwhVerificationDebtorRepo.js';

describe('verification debtor predicate', () => {
  it('defines the money bar as outstanding > 100, not >= 1', () => {
    expect(VERIFICATION_DEBTOR_OUTSTANDING_MIN).toBe(100);
    expect(DEBTOR_OUTSTANDING_SQL).toBe('greatest(i.total_amount - coalesce(i.total_paid, 0), 0)');
    expect(DEBTOR_HAVING_SQL).toContain('> 100');
    expect(DEBTOR_HAVING_SQL).not.toMatch(/>=\s*1\b/);
    expect(DEBTOR_HAVING_SQL).not.toMatch(/\b1\b/);
  });

  it('keeps invoice age >= 2 days only as same-day noise, not the money bar', () => {
    expect(VERIFICATION_DEBTOR_MIN_AGE_DAYS).toBe(2);
    expect(DEBTOR_OPEN_INVOICE_SQL).toContain('>= 2');
    expect(DEBTOR_OPEN_INVOICE_SQL).not.toMatch(/total_amount - coalesce\(i\.total_paid, 0\).*>\s*100/);
  });

  it('rolls up cmp_invoice on carrier_id and never reads dim_company.is_debtor', () => {
    for (const sql of Object.values(DEBTOR_SEARCH_SQL)) {
      expect(sql).toContain('from public.cmp_invoice');
      expect(sql).toContain(DEBTOR_HAVING_SQL);
      expect(sql).toContain('i.carrier_id in (select carrier_id from company)');
      expect(sql).toMatch(/limit \$2 offset \$3/);
      expect(sql).not.toMatch(/is_debtor/);
      expect(sql).not.toMatch(/collection_cases/);
    }
  });

  it('resolves MC via stg_zoho_deals because dim_company has no MC column', () => {
    expect(DEBTOR_SEARCH_SQL.mc).toContain('octane.stg_zoho_deals');
    expect(DEBTOR_SEARCH_SQL.mc).toMatch(/regexp_replace\(coalesce\(mc/);
    expect(DEBTOR_SEARCH_SQL.dot).toContain('octane.dim_company');
    expect(DEBTOR_SEARCH_SQL.email).toContain('deal_email');
    expect(DEBTOR_SEARCH_SQL.phone).toContain('deal_phone');
    expect(DEBTOR_SEARCH_SQL.phone).toContain('cell');
    expect(DEBTOR_SEARCH_SQL.name).toContain('company_name');
  });
});
