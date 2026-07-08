import { describe, expect, it } from 'vitest';
import {
  agentRunJob,
  ALL_JOBS,
  CRON_SCHEDULES,
  DEAD_LETTER_QUEUE,
  payloadToContext,
  tenantContextSchema,
} from '../../src/modules/jobs/catalog.js';
import { buildSystemContext, SCHEDULER_USER_ID } from '../../src/modules/jobs/systemContext.js';
import { makeContext } from '../fixtures/seed.js';

describe('job catalog', () => {
  it('every cron schedule points at a defined queue', () => {
    const names = new Set(ALL_JOBS.map((j) => j.name));
    for (const s of CRON_SCHEDULES) expect(names.has(s.name)).toBe(true);
  });

  it('agent.run is retry-bounded and dead-letters', () => {
    expect(agentRunJob.queue.retryLimit).toBe(1);
    expect(agentRunJob.queue.deadLetter).toBe(DEAD_LETTER_QUEUE);
    expect(agentRunJob.queue.expireInSeconds).toBeLessThanOrEqual(900);
  });

  it('agent.run payload round-trips a full TenantContext verbatim', () => {
    const ctx = makeContext({
      scopes: ['*'],
      departments: ['collection'],
      allDepartmentAccess: false,
      userName: 'Alice',
      bypassRbac: true,
    });
    const parsed = agentRunJob.schema.parse({
      taskId: 't1',
      ctx,
      message: 'sweep debtors',
      agent: 'collection',
    });
    const rebuilt = payloadToContext(parsed.ctx);
    expect(rebuilt).toEqual(ctx); // exact authority — never widened, never narrowed
  });

  it('payloadToContext drops explicit-undefined optionals (exactOptionalPropertyTypes)', () => {
    const parsed = tenantContextSchema.parse({
      tenantId: 't',
      userId: 'u',
      audience: 'internal',
      role: 'admin',
      scopes: [],
      departments: [],
      allDepartmentAccess: false,
      requestId: 'r',
    });
    const rebuilt = payloadToContext(parsed);
    expect('bypassRbac' in rebuilt).toBe(false);
    expect('userName' in rebuilt).toBe(false);
  });

  it('rejects malformed payloads at parse time', () => {
    expect(() => agentRunJob.schema.parse({ taskId: 't', message: 'x' })).toThrow();
  });
});

describe('buildSystemContext (cron authority)', () => {
  it('is department-scoped, normalized, and carries NO global bypass', () => {
    const ctx = buildSystemContext([' Collection ', 'collection']);
    expect(ctx.userId).toBe(SCHEDULER_USER_ID);
    expect(ctx.departments).toEqual(['collection']);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(ctx.bypassRbac).toBeUndefined();
    expect(ctx.audience).toBe('internal');
  });
});
