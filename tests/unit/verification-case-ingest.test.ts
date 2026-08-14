import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/verification/zohoDealIngest.js', () => ({
  ingestVerificationDeals: vi.fn(),
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

import { ingestVerificationDeals } from '../../src/modules/verification/zohoDealIngest.js';
import { runVerificationCaseIngest } from '../../src/modules/jobs/workers/verificationCaseIngest.js';
import { DISABLED_JOB_QUEUES } from '../../src/modules/jobs/catalog.js';

describe('verification case ingest worker', () => {
  it('no-ops while the queue is parked in DISABLED_JOB_QUEUES', async () => {
    const result = await runVerificationCaseIngest({ trigger: 'manual' });
    expect(result).toEqual({ skipped: true, reason: 'disabled' });
    expect(ingestVerificationDeals).not.toHaveBeenCalled();
  });

  it('keeps case-ingest disabled and never POSTs /api/v1/requests', () => {
    expect(DISABLED_JOB_QUEUES.has('automation.verification.case-ingest')).toBe(true);
    const src = readFileSync(new URL('../../src/modules/verification/zohoDealIngest.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('createAndStartRequest');
    expect(src).not.toContain('/api/v1/requests');
  });
});
