/**
 * SLA target resolution for the comms create path (`resolveSla` in modules/comms/ticketService.ts).
 *
 * Split from comms-ticket-service.test.ts to keep both files inside the 600-line cap; `resolveSla` is
 * its own exported function, so the seam is the module's own, not an arbitrary cut. Same mock
 * preamble — the vi.mock registry is per-file and cannot be shared from a helper.
 *
 * Why this matters: a deadline the client computes cannot be swept for breaches, and two clients on
 * different clocks disagree about whether the same ticket is late. The precedence chain (catalog row >
 * department override > tenant map > literal) plus the first-response clamp is the whole contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/salesDataCenter.js', () => ({
  fetchDealSnapshot: vi.fn(),
}));
vi.mock('../../src/repos/commsCatalogRepo.js', () => ({
  commsCatalogRepo: { byCode: vi.fn(), list: vi.fn(), buildListQuery: vi.fn() },
}));
vi.mock('../../src/repos/commsDepartmentRepo.js', () => ({
  commsDepartmentRepo: { get: vi.fn(), list: vi.fn(), buildListQuery: vi.fn() },
}));
// Partial: `slaHoursFor` and DEFAULT_COMMS_SETTINGS are pure and are part of what is under test — only
// the DB read is replaced.
vi.mock('../../src/repos/commsSettingsRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/commsSettingsRepo.js')>();
  return {
    ...mod,
    commsSettingsRepo: { ...mod.commsSettingsRepo, getEffective: vi.fn() },
  };
});
vi.mock('../../src/repos/commsTicketRepo.js', () => ({
  commsTicketRepo: { createWithThread: vi.fn() },
}));
vi.mock('../../src/repos/commsTicketEventRepo.js', () => ({
  commsTicketEventRepo: { append: vi.fn(async () => undefined) },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));
// `publishSafely` keeps its real semantics (invoke, swallow) so the fan-out call it wraps is
// observable; only the fan-out itself is replaced, since it would otherwise touch the socket hub.
vi.mock('../../src/modules/comms/publish.js', () => ({
  publishSafely: vi.fn((_label: string, fn: () => void) => {
    fn();
  }),
  publishThreadEvent: vi.fn(() => ({ thread: 0, lanes: 0 })),
}));

import {
  createClientTicket,
  resolveSla,
  resolveTicketType,
  type CreateClientTicketInput,
} from '../../src/modules/comms/ticketService.js';
import { fetchDealSnapshot } from '../../src/integrations/salesDataCenter.js';
import { commsCatalogRepo } from '../../src/repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../src/repos/commsDepartmentRepo.js';
import { commsSettingsRepo, DEFAULT_COMMS_SETTINGS } from '../../src/repos/commsSettingsRepo.js';
import { commsTicketRepo } from '../../src/repos/commsTicketRepo.js';
import { publishThreadEvent } from '../../src/modules/comms/publish.js';
import type { MytrionTicketType } from '../../src/db/schema/index.js';
import type { CreateTicketInput } from '../../src/repos/commsTicketRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';
import { createdUnit, dealSnapshot, deptConfig, T0, typeRow } from './helpers/commsFixtures.js';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:42',
    userName: 'Agent Smith',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

const dealMock = vi.mocked(fetchDealSnapshot);
const byCodeMock = vi.mocked(commsCatalogRepo.byCode);
const deptGetMock = vi.mocked(commsDepartmentRepo.get);
const settingsMock = vi.mocked(commsSettingsRepo.getEffective);
const createMock = vi.mocked(commsTicketRepo.createWithThread);
const publishMock = vi.mocked(publishThreadEvent);

/** The base body. Deliberately carries NO department and NO client fields — those are added per test. */
const baseInput: CreateClientTicketInput = {
  typeCode: 'C-7',
  subject: 'Card is not working',
  description: 'Driver says the card was declined at the pump.',
  dealId: 'deal_1',
};

/** The single arg `createWithThread` was called with — the repo boundary the service must get right. */
function createdWith(): CreateTicketInput {
  expect(createMock).toHaveBeenCalledTimes(1);
  const call = createMock.mock.calls[0];
  if (!call) throw new Error('createWithThread was not called');
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  byCodeMock.mockResolvedValue(typeRow());
  deptGetMock.mockResolvedValue(deptConfig());
  settingsMock.mockResolvedValue({ ...DEFAULT_COMMS_SETTINGS, persisted: true });
  dealMock.mockResolvedValue(dealSnapshot());
  createMock.mockImplementation(async (_ctx, input) => createdUnit(input));
  publishMock.mockReturnValue({ thread: 0, lanes: 0 });
});

// ---------------------------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------------------------

describe('resolveSla — precedence and clamping', () => {
  const typeFor = async (over: Partial<MytrionTicketType> = {}, priority?: 'high') => {
    byCodeMock.mockResolvedValue(typeRow(over));
    return resolveTicketType(ctxOf(), 'C-7', priority);
  };
  const H = 3_600_000;

  it('FALLS BACK TO THE SETTINGS MAP when the catalog row sla_hours is NULL', async () => {
    // All 60 seeded rows have sla_hours NULL, so this is the path that actually runs.
    const type = await typeFor({ slaHours: null, defaultPriority: 'medium' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: null }));
    const sla = await resolveSla(ctxOf(), type, T0);
    expect(sla.slaHours).toBe(DEFAULT_COMMS_SETTINGS.slaHoursByPriority.medium);
    expect(sla.dueAt.getTime()).toBe(T0.getTime() + 24 * H);
  });

  it('the map is read per PRIORITY, not as one number', async () => {
    const type = await typeFor({ slaHours: null, defaultPriority: 'medium' }, 'high');
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: null }));
    expect((await resolveSla(ctxOf(), type, T0)).slaHours).toBe(
      DEFAULT_COMMS_SETTINGS.slaHoursByPriority.high,
    );
  });

  it("A DEPARTMENT slaHoursOverride WINS OVER THE TENANT MAP", async () => {
    const type = await typeFor({ slaHours: null, defaultPriority: 'medium' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: 6 }));
    const sla = await resolveSla(ctxOf(), type, T0);
    expect(sla.slaHours).toBe(6);
    expect(sla.slaHours).not.toBe(DEFAULT_COMMS_SETTINGS.slaHoursByPriority.medium);
    expect(sla.dueAt.getTime()).toBe(T0.getTime() + 6 * H);
  });

  it('the CATALOG row wins over both, when it is set', async () => {
    const type = await typeFor({ slaHours: 2, defaultPriority: 'medium' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: 6 }));
    expect((await resolveSla(ctxOf(), type, T0)).slaHours).toBe(2);
  });

  it('a tenant with no settings row still gets a due date (defaults, not NULL)', async () => {
    settingsMock.mockResolvedValue({ ...DEFAULT_COMMS_SETTINGS, persisted: false });
    const type = await typeFor({ slaHours: null, defaultPriority: 'medium' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: null }));
    const sla = await resolveSla(ctxOf(), type, T0);
    expect(sla.slaHours).toBeGreaterThan(0);
    expect(Number.isNaN(sla.dueAt.getTime())).toBe(false);
  });

  it('a half-filled map falls through medium and then to the literal fallback', async () => {
    settingsMock.mockResolvedValue({
      ...DEFAULT_COMMS_SETTINGS,
      slaHoursByPriority: { medium: 12 },
      firstResponseHoursByPriority: {},
      persisted: true,
    });
    const type = await typeFor({ slaHours: null, defaultPriority: 'critical' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: null }));
    const sla = await resolveSla(ctxOf(), type, T0);
    expect(sla.slaHours).toBe(12); // no 'critical' key -> medium
    // firstResponse map is empty -> the 8h literal, clamped below the 12h resolution target.
    expect(sla.firstResponseDueAt.getTime()).toBe(T0.getTime() + 8 * H);
  });

  it('FIRST RESPONSE IS CLAMPED so it can never exceed the resolution deadline', async () => {
    // A misconfigured map (first response 8h against a 1h resolution target) must not promise a first
    // response after the ticket is already due.
    const type = await typeFor({ slaHours: null, defaultPriority: 'medium' });
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: 1 }));
    const sla = await resolveSla(ctxOf(), type, T0);
    expect(sla.slaHours).toBe(1);
    expect(sla.firstResponseDueAt.getTime()).toBe(sla.dueAt.getTime());
    expect(sla.firstResponseDueAt.getTime()).toBeLessThanOrEqual(sla.dueAt.getTime());
  });

  it('the clamp holds for every priority in the shipped defaults', async () => {
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      byCodeMock.mockResolvedValue(typeRow({ slaHours: null, defaultPriority: priority }));
      deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: null }));
      const type = await resolveTicketType(ctxOf(), 'C-7');
      const sla = await resolveSla(ctxOf(), type, T0);
      expect(
        sla.firstResponseDueAt.getTime(),
        `priority ${priority} promised a first response after the due date`,
      ).toBeLessThanOrEqual(sla.dueAt.getTime());
      expect(sla.firstResponseDueAt.getTime()).toBeGreaterThan(T0.getTime());
    }
  });

  it('the deadlines are absolute Dates derived from `from`, not from the wall clock', async () => {
    const type = await typeFor({ slaHours: 5 });
    const from = new Date('2020-01-01T00:00:00.000Z');
    const sla = await resolveSla(ctxOf(), type, from);
    expect(sla.dueAt.toISOString()).toBe('2020-01-01T05:00:00.000Z');
  });

  it('the computed SLA is what reaches the repo', async () => {
    deptGetMock.mockResolvedValue(deptConfig({ slaHoursOverride: 3 }));
    await createClientTicket(ctxOf(), baseInput);
    const input = createdWith();
    expect(input.slaHours).toBe(3);
    expect(input.dueAt).toBeInstanceOf(Date);
    expect(input.firstResponseDueAt).toBeInstanceOf(Date);
    expect(input.firstResponseDueAt!.getTime()).toBeLessThanOrEqual(input.dueAt!.getTime());
  });
});

