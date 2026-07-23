/**
 * Admin Deals helpers — COQL builders, mapping, id guards (no live Zoho).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import {
  assertZohoNumericId,
  buildOwnerLogsCoql,
  extractOwnerTimelineChanges,
  mapDealRow,
  mapOwnerLogRow,
} from '../../src/modules/admin/zohoDealsAdmin.js';

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  runCoql: vi.fn(async () => ({ rows: [], count: 0, moreRecords: false })),
  listActiveUsers: vi.fn(async () => []),
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: vi.fn(async () => null),
    searchRecords: vi.fn(async () => ({ rows: [], moreRecords: false })),
    getRecordTimeline: vi.fn(async () => []),
  },
}));

vi.mock('../../src/modules/retention/zohoOwnership.js', () => ({
  transferDealOwnershipToClaimant: vi.fn(),
}));

describe('assertZohoNumericId', () => {
  it('accepts numeric strings', () => {
    expect(assertZohoNumericId('6227679000031473048')).toBe('6227679000031473048');
  });

  it('rejects non-numeric input', () => {
    expect(() => assertZohoNumericId("1'; drop table")).toThrow(AppError);
  });
});

describe('mapDealRow', () => {
  it('maps lookups and dates', () => {
    const dto = mapDealRow({
      id: '111',
      Deal_Name: 'Acme LLC',
      Owner: { id: '222', name: 'Agent A' },
      Account_Name: { id: '333', name: 'Acme Co' },
      Contact_Name: { id: '444', name: 'Pat' },
      Application_Date: '2026-07-20',
      Owner_Last_Updated: '2026-07-21',
      Stage: 'Qualification',
      Carrier_ID: 99,
      Application_ID: 88,
    });
    expect(dto).toMatchObject({
      id: '111',
      dealName: 'Acme LLC',
      ownerZohoUserId: '222',
      ownerName: 'Agent A',
      accountId: '333',
      contactId: '444',
      applicationDate: '2026-07-20',
      ownerLastUpdated: '2026-07-21',
      carrierId: '99',
      applicationId: '88',
    });
  });
});

describe('mapOwnerLogRow', () => {
  it('maps Owner_Logs fields', () => {
    expect(
      mapOwnerLogRow({
        id: '9',
        Name: 'log',
        Module: 'Deals',
        Entity_ID: '111',
        New_Owner_ID: '222',
        New_Owner_Name: 'CS',
        Owner_Log_Time: '2026-07-22T10:00:00+00:00',
      }),
    ).toMatchObject({
      id: '9',
      module: 'Deals',
      entityId: '111',
      newOwnerId: '222',
      newOwnerName: 'CS',
      transferrerZohoUserId: null,
    });
  });

  it('maps Created_By as transferrer', () => {
    expect(
      mapOwnerLogRow({
        id: '10',
        Created_By: { id: '6227679000093960901', name: 'John Mercer' },
        New_Owner_ID: '999',
      }),
    ).toMatchObject({
      transferrerZohoUserId: '6227679000093960901',
      transferrerName: 'John Mercer',
    });
  });
});

describe('buildOwnerLogsCoql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to Deals module ordered by Owner_Log_Time', () => {
    const q = buildOwnerLogsCoql();
    expect(q).toContain("from Owner_Logs where Module = 'Deals'");
    expect(q).toContain('order by Owner_Log_Time desc');
    expect(q).toContain('limit 0, 100');
  });

  it('adds entity, new-owner, and transferrer filters safely', () => {
    const q = buildOwnerLogsCoql({
      entityId: '111',
      newOwnerId: '222',
      transferrerId: '6227679000093960901',
      limit: 50,
    });
    expect(q).toContain("Entity_ID = '111'");
    expect(q).toContain("New_Owner_ID = '222'");
    expect(q).toContain("Created_By = '6227679000093960901'");
    expect(q).toContain('limit 0, 50');
  });

  it('rejects injected entity ids', () => {
    expect(() => buildOwnerLogsCoql({ entityId: "1' or 1=1" })).toThrow(AppError);
  });
});

describe('extractOwnerTimelineChanges', () => {
  it('reads Owner field_history and done_by', () => {
    const changes = extractOwnerTimelineChanges([
      {
        audited_time: '2026-07-21T12:00:00+00:00',
        source: 'crm_api',
        done_by: { id: '6227679000093960901', name: 'John Mercer' },
        field_history: {
          api_name: 'Owner',
          _value: { old: 'Sales Agent', new: 'Retention CS' },
        },
      },
      {
        done_by: { id: '1', name: 'Other' },
        field_history: [{ api_name: 'Stage', _value: { old: 'A', new: 'B' } }],
      },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      transferrerZohoUserId: '6227679000093960901',
      transferrerName: 'John Mercer',
      previousOwnerName: 'Sales Agent',
      previousOwnerZohoUserId: null,
      newOwnerName: 'Retention CS',
      newOwnerZohoUserId: null,
      source: 'crm_api',
    });
  });
});
