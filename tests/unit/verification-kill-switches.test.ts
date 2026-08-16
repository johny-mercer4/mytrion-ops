/**
 * Proves the credit-platform quarantine actually holds.
 *
 * The flags in `killSwitches.ts` are only worth having if flipping them off really stops the code
 * from reaching the external system. This asserts that with the switches in their SHIPPED position
 * every seam reports "not configured" even when the environment is fully populated — because the
 * realistic mistake is a deployment that still has `VERIFICATION_DATABASE_URL` and
 * `CREDIT_PLATFORM_BASE_URL` set from before the rebuild.
 *
 * Mirrors `retention-kill-switches.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

// Fully populated env — exactly the state a not-yet-cleaned deployment would be in.
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      VERIFICATION_DATABASE_URL: 'postgres://user:pass@cp.example/credit_platform',
      VERIFICATION_WRITE_ENABLED: true,
      CREDIT_PLATFORM_BASE_URL: 'https://cp.example',
      CREDIT_PLATFORM_API_KEY: 'live-key',
      CREDIT_PLATFORM_ANALYST_API_KEY: 'analyst-key',
    },
  };
});

import { isCreditPlatformConfigured } from '../../src/integrations/creditPlatformClient.js';
import { isWriteConfigured } from '../../src/integrations/creditPlatformWriteDb.js';
import { verificationDb } from '../../src/integrations/verificationDb.js';
import {
  VERIFICATION_CP_WRITEBACK_ENABLED,
  VERIFICATION_LEGACY_DESK_ENABLED,
  VERIFICATION_ZOHO_INGEST_ENABLED,
} from '../../src/modules/verification/killSwitches.js';
import { DISABLED_JOB_QUEUES, verificationCaseIngestJob } from '../../src/modules/jobs/catalog.js';

describe('shipped switch positions', () => {
  it('has the credit-platform desk parked', () => {
    expect(VERIFICATION_LEGACY_DESK_ENABLED).toBe(false);
  });

  /**
   * The ingest is ON and is the ONLY creation path — neither desk hand-creates an application.
   * The legacy desk beside it stays parked; the poller writes the new-era record instead.
   */
  it('has Zoho deal ingest LIVE — it is the only way an application is created', () => {
    expect(VERIFICATION_ZOHO_INGEST_ENABLED).toBe(true);
  });

  it('has credit-platform write-back parked', () => {
    expect(VERIFICATION_CP_WRITEBACK_ENABLED).toBe(false);
  });

  it('keeps the ingest job OUT of DISABLED_JOB_QUEUES so the flag and the queue cannot drift', () => {
    // A live flag against a parked queue silently creates nothing, which is the worst of both.
    expect(DISABLED_JOB_QUEUES.has(verificationCaseIngestJob.name)).toBe(false);
  });
});

describe('the switches beat a populated environment', () => {
  it('reports the verification read pool as unconfigured despite a live DSN', () => {
    expect(verificationDb.isConfigured()).toBe(false);
  });

  it('reports the credit-platform HTTP client as unconfigured despite a live base URL and key', () => {
    expect(isCreditPlatformConfigured()).toBe(false);
  });

  it('refuses write-back despite VERIFICATION_WRITE_ENABLED being on', () => {
    // Two independent conditions guard this one; the kill switch is the outer of the two, so it
    // holds even when the older env flag says writes are allowed.
    expect(isWriteConfigured()).toBe(false);
  });
});
