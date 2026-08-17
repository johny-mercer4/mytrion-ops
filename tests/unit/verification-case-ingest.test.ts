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
  it('runs — this queue is the only path that creates an application', async () => {
    await runVerificationCaseIngest({ trigger: 'manual' });
    expect(ingestVerificationDeals).toHaveBeenCalledTimes(1);
  });

  it('is not parked, and still never reaches the credit_platform API', () => {
    expect(DISABLED_JOB_QUEUES.has('automation.verification.case-ingest')).toBe(false);
    const src = readFileSync(new URL('../../src/modules/verification/zohoDealIngest.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('createAndStartRequest');
    expect(src).not.toContain('/api/v1/requests');
    // The credit_platform-era follow-ups were REMOVED from this path, not merely flag-guarded.
    // Matched on the IMPORT, not on the word: the header explains why they are gone, and a prose
    // mention is not a call.
    expect(src).not.toMatch(/^import .*caseSync\.js/m);
    expect(src).not.toMatch(/^import .*firstRunTrigger\.js/m);
  });

  it('writes the new-era record rather than the legacy decision-desk mirror', () => {
    const src = readFileSync(new URL('../../src/modules/verification/zohoDealIngest.ts', import.meta.url), 'utf8');
    expect(src).toContain('createApplicationFromDeal');
    expect(src).not.toContain('DECISION_DESK_STAGE_IDS');
  });
});
