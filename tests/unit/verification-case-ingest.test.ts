import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/verification/zohoDealIngest.js', () => ({
  ingestVerificationDeals: vi.fn(),
}));

import { ingestVerificationDeals } from '../../src/modules/verification/zohoDealIngest.js';
import { runVerificationCaseIngest } from '../../src/modules/jobs/workers/verificationCaseIngest.js';

describe('verification case ingest worker', () => {
  it('no-ops while the queue is parked in DISABLED_JOB_QUEUES', async () => {
    const result = await runVerificationCaseIngest({ trigger: 'manual' });
    expect(result).toEqual({ skipped: true, reason: 'disabled' });
    expect(ingestVerificationDeals).not.toHaveBeenCalled();
  });
});
