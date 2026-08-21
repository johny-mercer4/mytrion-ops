/**
 * The Sales projection of the verification queue — the parts that are Sales' own.
 *
 * Everything shared with the desk is tested in `verification/applicants/applicantsModel.test.ts`;
 * this covers the four things that exist BECAUSE the reader is the agent rather than the reviewer:
 * the five scopes, the second-person ask line, whose Deal a row is, and the phase vocabulary.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationCaseRow } from '@/api/verificationFlow';
import { PHASE_ORDER, PHASE_SHORT } from '../../verification/applicants/applicantsModel';
import {
  anotherAgentsDeal,
  askFor,
  inSalesScope,
  SALES_PHASE_LABEL,
  SALES_PHASE_SHORT,
  SALES_SCOPES,
  salesPhaseLabel,
  selectSalesRows,
} from './salesVerificationQueue';

function row(over: Partial<VerificationCaseRow> = {}): VerificationCaseRow {
  return {
    id: 'vc_1',
    companyName: 'Kaiser Freight LLC',
    firstName: null,
    lastName: null,
    email: 'ops@kaiser.test',
    phone: '6145550110',
    applicantType: 'carrier',
    ein: '881234567',
    mc: null,
    dot: null,
    underwritingRoute: 'octane_internal',
    verificationProcess: false,
    phaseCode: 'p1_intake',
    statusCode: 'intake_incomplete',
    statusLabel: 'Incomplete application',
    boardColumn: 'draft',
    trucksCount: 14,
    fuelCardsRequested: 12,
    requestedLimit: '38000.00',
    approvedLimitAmount: null,
    intakeMissing: ['ein', 'businessAddress'],
    submittedAt: null,
    ownerName: 'Test Agent',
    ownerZohoUserId: 'agent-self',
    zohoOwnerId: 'agent-self',
    zohoOwnerName: 'Test Agent',
    closedAt: null,
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    ...over,
  };
}

const NOW = Date.parse('2026-08-19T10:00:00.000Z');

describe('scopes', () => {
  const submitted = row({ verificationProcess: true, statusCode: 'in_review', intakeMissing: [] });
  const asked = row({ verificationProcess: true, statusCode: 'pending_docs', intakeMissing: [] });
  const decided = row({
    verificationProcess: true,
    statusCode: 'approved',
    intakeMissing: [],
    closedAt: '2026-08-18T09:00:00.000Z',
  });

  it('puts every case in All', () => {
    for (const r of [row(), submitted, asked, decided]) expect(inSalesScope(r, 'all')).toBe(true);
  });

  /**
   * A pending-docs case is with the desk AND owes the agent something. It belongs under "Needs you"
   * and must NOT also sit under "With Verification" — a case in two buckets is a case the agent
   * reads twice and acts on neither time.
   */
  it('files a document request under Needs you only', () => {
    expect(inSalesScope(asked, 'needs_you')).toBe(true);
    expect(inSalesScope(asked, 'with_verification')).toBe(false);
    expect(inSalesScope(asked, 'draft')).toBe(false);
  });

  it('drops a decided case out of With Verification', () => {
    expect(inSalesScope(decided, 'decided')).toBe(true);
    expect(inSalesScope(decided, 'with_verification')).toBe(false);
  });

  it('counts an unsubmitted case as Incomplete and nothing else', () => {
    const scopes = SALES_SCOPES.map((s) => s.id).filter((id) => inSalesScope(row(), id));
    expect(scopes).toEqual(['all', 'draft']);
  });
});

describe('what the agent owes', () => {
  it('reports the server list verbatim rather than re-deriving completeness', () => {
    // Every visible field on this row is populated; the server still says three things are missing,
    // and the server is what the submit gate actually uses.
    expect(askFor(row({ intakeMissing: ['a', 'b', 'c'] }))).toEqual({
      tone: 'danger',
      text: '3 items still needed from you',
    });
  });

  it('uses the singular for one outstanding item', () => {
    expect(askFor(row({ intakeMissing: ['ein'] })).text).toBe('1 item still needed from you');
  });

  it('says so plainly when nothing is outstanding but nothing was submitted either', () => {
    expect(askFor(row({ intakeMissing: [] })).text).toBe('Not submitted yet');
  });

  /** What the agent owes outranks what the desk is doing — that is the whole precedence. */
  it('puts a document request ahead of the underwriting status', () => {
    expect(
      askFor(row({ verificationProcess: true, statusCode: 'pending_docs', intakeMissing: [] })),
    ).toEqual({ tone: 'warn', text: 'Verification asked you for documents' });
  });

  it('leads a decided case with the decision and the limit', () => {
    expect(
      askFor(
        row({
          verificationProcess: true,
          statusCode: 'approved',
          statusLabel: 'Approved',
          approvedLimitAmount: '4560.00',
          closedAt: '2026-08-18T09:00:00.000Z',
          intakeMissing: [],
        }),
      ).text,
    ).toBe('Approved — $4560.00');
  });

  it('says there is nothing to do while the desk works it', () => {
    const quiet = askFor(row({ verificationProcess: true, statusCode: 'in_review', intakeMissing: [] }));
    expect(quiet.tone).toBe('none');
    expect(quiet.text).toMatch(/nothing needed from you/);
  });
});

/**
 * The row's assignee is a snapshot taken at ingest, and it falls back to a CREDIT agent when the Deal
 * arrives unowned — so measuring ownership on it is what once labelled a credit agent as the Sales
 * owner. The Deal's owner is the Sales agent.
 */
describe('whose Deal it is', () => {
  it('is quiet on your own Deal', () => {
    expect(anotherAgentsDeal(row(), 'agent-self')).toBe(false);
  });

  it('flags a colleague’s Deal even when the assignee is still you', () => {
    expect(anotherAgentsDeal(row({ zohoOwnerId: 'other' }), 'agent-self')).toBe(true);
  });

  it('never flags a Deal Zoho has nobody on — there is no owner to name', () => {
    expect(anotherAgentsDeal(row({ zohoOwnerId: null, ownerZohoUserId: 'desk' }), 'agent-self')).toBe(
      false,
    );
  });
});

describe('phase vocabulary', () => {
  it('covers all ten phases', () => {
    expect(Object.keys(SALES_PHASE_LABEL).sort()).toEqual([...PHASE_ORDER].sort());
  });

  /**
   * The desk names the CHECK; Sales names the STAGE. This is the assertion that stops somebody
   * "simplifying" the Sales rail down to `PHASE_SHORT` and putting "Hard stops" in front of an agent.
   */
  it('keeps the credit desk’s own words off the Sales surface', () => {
    const words = Object.values(SALES_PHASE_SHORT).join(' ').toLowerCase();
    for (const jargon of ['hard stop', 'highway', 'risk tier', 'blacklist']) {
      expect(words).not.toContain(jargon);
    }
    // And it really is a different list — three phases at least must read differently.
    const differing = PHASE_ORDER.filter((code) => SALES_PHASE_SHORT[code] !== PHASE_SHORT[code]);
    expect(differing.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every short label inside the rail’s measure', () => {
    for (const [code, label] of Object.entries(SALES_PHASE_LABEL)) {
      expect(label.short.length, code).toBeLessThanOrEqual(16);
    }
  });

  it('falls back rather than showing a raw phase code', () => {
    expect(salesPhaseLabel('p99_nonsense')).toEqual({ short: 'Intake', full: 'Application intake' });
  });
});

describe('search and sort', () => {
  const rows = [
    row({ id: 'a', companyName: 'Zeta Haulage', trucksCount: 1, createdAt: '2026-08-18T10:00:00.000Z' }),
    row({ id: 'b', companyName: 'Alpha Freight', trucksCount: 9, createdAt: '2026-08-10T10:00:00.000Z' }),
  ];
  const query = { scope: 'all', search: '', sortKey: 'age', sortDir: 'desc', now: NOW } as const;

  it('sorts oldest first by default', () => {
    expect(selectSalesRows(rows, query).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts by name ascending', () => {
    expect(
      selectSalesRows(rows, { ...query, sortKey: 'name', sortDir: 'asc' }).map((r) => r.id),
    ).toEqual(['b', 'a']);
  });

  it('searches the identifiers an agent actually has to hand', () => {
    expect(selectSalesRows(rows, { ...query, search: 'zeta' }).map((r) => r.id)).toEqual(['a']);
    expect(selectSalesRows(rows, { ...query, search: '881234567' })).toHaveLength(2);
    expect(selectSalesRows(rows, { ...query, search: 'nothing here' })).toHaveLength(0);
  });

  it('applies the scope before the search', () => {
    const mixed = [rows[0]!, { ...rows[1]!, verificationProcess: true, intakeMissing: [] }];
    expect(
      selectSalesRows(mixed, { ...query, scope: 'draft', search: 'freight' }),
    ).toHaveLength(0);
  });
});
