import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runCoqlAll: vi.fn(), runCoql: vi.fn() }));

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { runCoqlAll: mocks.runCoqlAll, runCoql: mocks.runCoql },
}));

const { getAgentVerificationClients, toVerificationClient } = await import(
  '../../src/modules/verificationPipeline/service.js'
);

/** One COQL row shaped exactly like the live org returns it (lookups are `{name,id}`). */
function dealRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '6227679000138682078',
    Deal_Name: '3 brothers trucking',
    Account_Name: { name: '3 Brothers Trucking LLC', id: '622767900019' },
    Carrier_ID: 5837291,
    MC: 'MC-123456',
    DOT1: 1531770,
    Owner: { name: 'Sales Agent', id: '42' },
    Stage: 'Application Approved',
    Application_Stage: 'Implementation',
    Application_Status: 'Pending Setup-Generic',
    Application_ID: 899041,
    Application_Date: '2026-08-01',
    Stage_Last_Updated: null,
    Credit_Score: 499,
    Credit_Limit: '$15,000',
    Credit_Line_Approved: 0,
    Credit_Decision: 'Declined-Prepay/Secured Only',
    Risk_Score: '-None-',
    CreditSafe_Grade: null,
    Money_Code_Limit: null,
    Billing_Cycle: 'THR-WED',
    Payment_Type_Billing: 'Prepay',
    Company_Verification: 'Verified',
    Billing_Verification: null,
    Loves_Verification: 'Approved',
    Verified: false,
    Limits_Added: false,
    Reject_reason: null,
    Verification_Notes: null,
    Cards_Requested: 2,
    Modified_Time: '2026-08-02T11:30:02-04:00',
    ...over,
  };
}

describe('verification pipeline — Zoho Deals source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCoqlAll.mockResolvedValue({ rows: [dealRow()], truncated: false, pages: 1 });
  });

  it('scopes the COQL to the owner, filters to applications, and drains 200-row pages', async () => {
    await getAgentVerificationClients('42', { page: 1, pageSize: 9 });

    const [query, opts] = mocks.runCoqlAll.mock.calls[0] as [string, { pageSize: number }];
    expect(query).toContain("where Owner = '42'");
    expect(query).toContain('Application_ID > 0');
    // A unique trailing sort key — Application_Date has huge tie groups, and offset paging over a
    // non-total order silently duplicates and skips rows.
    expect(query).toContain('order by Application_Date desc, id desc');
    // runCoqlAll owns the LIMIT clause.
    expect(query).not.toMatch(/\blimit\b/i);
    expect(opts.pageSize).toBe(200);
  });

  it('refuses an owner id that is not a Zoho numeric id', async () => {
    await expect(getAgentVerificationClients("42' or '1'='1", {})).rejects.toThrow(/invalid owner id/);
  });

  it('maps the Zoho verification fields onto the card DTO', () => {
    const client = toVerificationClient(dealRow());

    expect(client).toMatchObject({
      dealId: '6227679000138682078',
      // The Account lookup wins over Deal_Name — it is the company, not the deal's label.
      companyName: '3 Brothers Trucking LLC',
      dealStage: 'Application Approved',
      applicationStage: 'Implementation',
      applicationStatus: 'Pending Setup-Generic',
      classification: 'in_pipeline',
      creditDecision: 'Declined-Prepay/Secured Only',
      creditScore: 499,
      // `Credit_Limit` is a TEXT field in CRM, so "$15,000" has to parse.
      creditLimit: 15000,
      paymentTerms: 'Prepay',
      companyVerification: 'Verified',
      lovesVerification: 'Approved',
      applicationId: '899041',
      dot: '1531770',
      mc: 'MC-123456',
    });
    // "-None-" is Zoho's unset picklist marker, not a value.
    expect(client.riskScore).toBeNull();
  });

  it('treats a 0 credit score as "not scored" rather than a catastrophic score', () => {
    expect(toVerificationClient(dealRow({ Credit_Score: 0 })).creditScore).toBeNull();
    expect(toVerificationClient(dealRow({ Credit_Score: 688 })).creditScore).toBe(688);
  });

  it('drops free-text noise from the MC field', () => {
    // Agents type notes-to-self into MC ("DOT", "No assigned number"); only keep identifiers.
    expect(toVerificationClient(dealRow({ MC: 'No assigned number' })).mc).toBeNull();
    expect(toVerificationClient(dealRow({ MC: 'DOT' })).mc).toBeNull();
    expect(toVerificationClient(dealRow({ MC: '1234567' })).mc).toBe('1234567');
  });

  it('classifies from Stage', () => {
    expect(toVerificationClient(dealRow({ Stage: 'Card Swiped' })).classification).toBe('active');
    expect(toVerificationClient(dealRow({ Stage: 'Closed Won' })).classification).toBe('active');
    expect(toVerificationClient(dealRow({ Stage: 'Closed Lost' })).classification).toBe('closed');
    expect(
      toVerificationClient(dealRow({ Stage: 'Closed Lost to Competition' })).classification,
    ).toBe('closed');
    expect(toVerificationClient(dealRow({ Stage: 'Application Processing' })).classification).toBe(
      'in_pipeline',
    );
  });

  it('paginates and searches over the drained set, reporting an exact total', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      dealRow({ id: String(1000 + i), Account_Name: { name: `Carrier ${i}`, id: `a${i}` } }),
    );
    mocks.runCoqlAll.mockResolvedValue({ rows, truncated: false, pages: 1 });

    const page3 = await getAgentVerificationClients('42', { page: 3, pageSize: 9 });
    expect(page3.total).toBe(25);
    expect(page3.clients).toHaveLength(7);
    expect(page3.clients[0]?.companyName).toBe('Carrier 18');

    const searched = await getAgentVerificationClients('42', {
      page: 1,
      pageSize: 9,
      search: 'carrier 7',
    });
    expect(searched.total).toBe(1);
    expect(searched.clients[0]?.companyName).toBe('Carrier 7');
  });
});
