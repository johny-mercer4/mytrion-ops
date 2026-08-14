import { describe, expect, it } from 'vitest';
import {
  buildDealPollCoql,
  mapZohoDeal,
  maxApplicationDate,
  ZOHO_DEAL_POLL_LIMIT,
  ZOHO_DEAL_POLL_STAGES,
} from '../../src/modules/verification/zohoDealMap.js';

describe('buildDealPollCoql', () => {
  it('uses two predicates only and never selects DOT', () => {
    const q = buildDealPollCoql('2026-07-15', 50);
    expect(q.startsWith('select id, Application_Date from Deals')).toBe(true);
    expect(q).not.toMatch(/\bDOT\b/);
    expect(q.match(/\band\b/g)).toHaveLength(1);
    expect(q).toContain("Application_Date >= '2026-07-15'");
    expect(q).toContain('order by Application_Date asc');
    expect(q).toContain('limit 0, 50');
    for (const stage of ZOHO_DEAL_POLL_STAGES) expect(q).toContain(`'${stage}'`);
  });

  it('takes YYYY-MM-DD, strips quotes, and caps the limit', () => {
    const q = buildDealPollCoql("2026-07-1' OR Stage='x", 9999);
    expect(q).toContain("Application_Date >= '2026-07-1'");
    expect(q).not.toContain('Stage=');
    expect(q).toContain(`limit 0, ${ZOHO_DEAL_POLL_LIMIT}`);
  });
});

describe('mapZohoDeal', () => {
  it('maps DOT1 / Trucks1 / First_name / Cell / Birth_Of_Date', () => {
    const mapped = mapZohoDeal({
      id: '555',
      Account_Name: { name: 'Acme Haul' },
      First_name: 'Ada',
      Last_Name: 'Lovelace',
      Email: 'ada@acme.test',
      Cell: '555-0100',
      Address: '1 Main',
      City: 'Austin',
      State: 'TX',
      Zip_Code: '78701',
      Birth_Of_Date: '1980-05-01T00:00:00+00:00',
      DOT1: '1234567',
      Trucks1: '12',
      MC: '999',
      Stage: 'Application Filled',
      Application_Date: '2026-08-01',
      Application_ID: 'APP-1',
      Owner: { id: '88', name: 'Deal Owner' },
    });
    expect(mapped).toMatchObject({
      zohoDealId: '555',
      companyName: 'Acme Haul',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0100',
      cell: '555-0100',
      dateOfBirth: '1980-05-01',
      dot: '1234567',
      truckCount: '12',
      mc: '999',
      zohoStage: 'Application Filled',
      applicationDate: '2026-08-01',
      zohoOwnerId: '88',
    });
    expect(mapped.zohoRaw.DOT).toBe('1234567');
  });

  it('prefers DOT1 over a leftover DOT field', () => {
    const mapped = mapZohoDeal({ id: '1', DOT1: '222', DOT: 'should-not-win' });
    expect(mapped.dot).toBe('222');
  });
});

describe('maxApplicationDate', () => {
  it('returns the latest valid YYYY-MM-DD', () => {
    expect(maxApplicationDate(['2026-01-01', 'nope', '2026-03-02'], '2026-01-15')).toBe(
      '2026-03-02',
    );
    expect(maxApplicationDate(['2025-12-01'], '2026-01-15')).toBe('2026-01-15');
  });
});
