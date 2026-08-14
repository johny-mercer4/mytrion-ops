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
  it('runs ingest when the queue is enabled', async () => {
    vi.mocked(ingestVerificationDeals).mockResolvedValue({
      created: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      watermark: '2026-08-14T17:08:00+00:00',
    });
    const result = await runVerificationCaseIngest({ trigger: 'manual' });
    expect(result).toMatchObject({ created: 0, watermark: '2026-08-14T17:08:00+00:00' });
    expect(ingestVerificationDeals).toHaveBeenCalledOnce();
  });

  it('enables case-ingest and never POSTs /api/v1/requests', () => {
    expect(DISABLED_JOB_QUEUES.has('automation.verification.case-ingest')).toBe(false);
    const src = readFileSync(new URL('../../src/modules/verification/zohoDealIngest.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('createAndStartRequest');
    expect(src).not.toContain('/api/v1/requests');
  });
});
