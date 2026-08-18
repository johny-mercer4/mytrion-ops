import { describe, expect, it } from 'vitest';
import {
  BANKING_CHECKS,
  creditBankingCanPass,
  creditPhaseOutcome,
  creditSidePass,
  missingBankingDocs,
} from './caseCreditBanking';

const allOk = Object.fromEntries(BANKING_CHECKS.map((c) => [c.id, 'ok' as const]));

describe('creditBankingCanPass', () => {
  it('passes only on strong/acceptable credit and no open missing banking rows', () => {
    expect(creditSidePass('strong')).toBe(true);
    expect(creditSidePass('acceptable')).toBe(true);
    expect(creditSidePass('borderline')).toBe(false);
    expect(creditSidePass('unacceptable')).toBe(false);
    expect(creditBankingCanPass({ credit: 'strong', banking: allOk })).toBe(true);
    expect(creditBankingCanPass({ credit: 'acceptable', banking: { ...allOk, nsf: 'concern' } })).toBe(
      true,
    );
    expect(creditBankingCanPass({ credit: 'strong', banking: { ...allOk, nsf: 'missing' } })).toBe(
      false,
    );
    expect(creditBankingCanPass({ credit: 'borderline', banking: allOk })).toBe(false);
    expect(creditBankingCanPass({ credit: 'unacceptable', banking: allOk })).toBe(false);
  });

  it('maps missing banking rows onto a bank-statement request', () => {
    expect(missingBankingDocs({ ownership: 'missing' })).toEqual([
      { docType: 'bank_statement', label: 'Bank statements (last 3 months)' },
    ]);
    expect(missingBankingDocs(allOk)).toEqual([]);
  });

  it('routes borderline to manager and unacceptable to deposit/prepaid', () => {
    expect(creditPhaseOutcome('borderline')).toBe('manager_review');
    expect(creditPhaseOutcome('unacceptable')).toBe('deposit_prepaid');
    expect(creditPhaseOutcome('strong')).toBeNull();
  });
});
