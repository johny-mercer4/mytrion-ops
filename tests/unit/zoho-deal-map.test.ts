import { describe, expect, it } from 'vitest';
import {
  buildDealPollCoql,
  isDealAfterWatermark,
  mapZohoDeal,
  maxApplicationDate,
  resolveFreshIngestWatermark,
  toZohoDate,
  ZOHO_DEAL_POLL_LIMIT,
  ZOHO_DEAL_POLL_STAGES,
} from '../../src/modules/verification/zohoDealMap.js';

describe('buildDealPollCoql', () => {
  /**
   * The poll filters on Application_Date — when the carrier actually applied — not Created_Time.
   * A Deal created months ago that only now gets an application date has to be picked up.
   */
  it('filters Application_Date only and never selects DOT', () => {
    const q = buildDealPollCoql('2026-08-14', 50);
    expect(q.startsWith('select id, Application_Date from Deals')).toBe(true);
    expect(q).not.toMatch(/\bDOT\b/);
    expect(q).not.toContain('Created_Time');
    expect(q.match(/\band\b/g)).toHaveLength(1);
    expect(q).toContain("Application_Date >= '2026-08-14'");
    expect(q).toContain('order by Application_Date asc');
    expect(q).toContain('limit 0, 50');
    for (const stage of ZOHO_DEAL_POLL_STAGES) expect(q).toContain(`'${stage}'`);
  });

  it('truncates a leftover datetime cursor to its day', () => {
    // The old Created_Time cursor is still in the database on a running deployment.
    expect(buildDealPollCoql('2026-08-14T17:08:00+00:00')).toContain(
      "Application_Date >= '2026-08-14'",
    );
  });

  it('strips quotes and caps the limit', () => {
    const q = buildDealPollCoql("2026-08-14' OR Stage='x", 9999);
    expect(q).toContain("Application_Date >= '2026-08-14'");
    expect(q).not.toContain('Stage=');
    expect(q).toContain(`limit 0, ${ZOHO_DEAL_POLL_LIMIT}`);
  });
});

describe('fresh-only watermark', () => {
  it('starts at today when there is no usable cursor, rather than replaying history', () => {
    const now = new Date('2026-08-14T17:08:00.000Z');
    expect(resolveFreshIngestWatermark('', now)).toBe('2026-08-14');
    expect(resolveFreshIngestWatermark('not-a-date', now)).toBe('2026-08-14');
  });

  it('honours a stored cursor so a running deployment never skips an interval', () => {
    const now = new Date('2026-08-14T17:08:00.000Z');
    expect(resolveFreshIngestWatermark('2026-07-15', now)).toBe('2026-07-15');
    // A datetime left over from the Created_Time era is kept, truncated to its day.
    expect(resolveFreshIngestWatermark('2026-08-01T16:00:00+00:00', now)).toBe('2026-08-01');
  });

  it('lets VERIFICATION_INGEST_SINCE move the floor forward, never backward', () => {
    const now = new Date('2026-08-14T17:08:00.000Z');
    expect(resolveFreshIngestWatermark('2026-07-15', now, '2026-08-01')).toBe('2026-08-01');
    expect(resolveFreshIngestWatermark('2026-08-10', now, '2026-08-01')).toBe('2026-08-10');
  });

  it('compares whole days, so no timezone can shift the boundary', () => {
    expect(isDealAfterWatermark('2026-08-13', '2026-08-14')).toBe(false);
    expect(isDealAfterWatermark('2026-08-14', '2026-08-14')).toBe(true);
    expect(isDealAfterWatermark('2026-08-15', '2026-08-14')).toBe(true);
    // A deal with no application date cannot be placed against the cursor.
    expect(isDealAfterWatermark('', toZohoDate())).toBe(false);
  });

  /**
   * The cursor rests ON the last date seen, never past it: a deal applied later the same day must
   * still be picked up next run. Re-reads are absorbed by the duplicate check.
   */
  it('advances to the furthest application date and no further', () => {
    expect(maxApplicationDate(['2026-08-14', 'nope', '2026-08-16'], '2026-08-13')).toBe('2026-08-16');
    expect(maxApplicationDate([], '2026-08-13')).toBe('2026-08-13');
    expect(maxApplicationDate(['2026-08-10'], '2026-08-13')).toBe('2026-08-13');
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
