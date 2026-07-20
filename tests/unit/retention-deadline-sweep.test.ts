/**
 * Deadline sweeper transition table — pure resolveExpiry cases.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { RetentionCase } from '../../src/db/schema/index.js';
import {
  NEW_OWNER_DEADLINE_TYPE,
  POOL_CLAIM_DEADLINE_TYPE,
  POST_CONTACT_DEADLINE_TYPE,
  RETENTION_WAIT_DEADLINE_TYPE,
  VACATION_COUNTDOWN_TYPE,
  VACATION_FOLLOWUP_DEADLINE_TYPE,
} from '../../src/modules/retention/deadlines.js';
import { resolveExpiry } from '../../src/modules/retention/deadlineSweep.js';
import { PHASE1_DEADLINE_TYPE } from '../../src/modules/retention/phase1.js';

function baseCase(overrides: Partial<RetentionCase> = {}): RetentionCase {
  return {
    id: 1,
    tenantId: DEFAULT_TENANT_ID,
    carrierId: '104882',
    zohoDealId: null,
    companyName: 'Ironhide',
    applicationId: null,
    agentName: 'Rep',
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_new',
    phaseChangedAt: new Date('2026-07-01T00:00:00Z'),
    transactionFrequency: 'high',
    agentOutcome: null,
    dissatisfactionReason: null,
    reasonNote: null,
    assignedAgentZohoUserId: '777',
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    assignmentCount: 1,
    openPoolAttemptCount: 0,
    outOfReachAttempts: 0,
    dealOwnerChanged: false,
    currentDeadlineAt: new Date('2026-07-01T00:00:00Z'),
    currentDeadlineType: PHASE1_DEADLINE_TYPE,
    vacationCountdownEnd: null,
    citiFolderEnteredAt: null,
    citiFolderHoldUntil: null,
    lastReviewCycleAt: null,
    salesManagerZohoUserId: null,
    thresholdDays: 2,
    lastTransactionAt: null,
    daysInactive: 10,
    txCount90d: 40,
    gallons90d: 8000,
    activeCards: 5,
    source: 'auto',
    lastSyncedAt: null,
    closedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

const now = new Date('2026-07-20T12:00:00Z');

describe('resolveExpiry', () => {
  it('2BD agent action → Retention with 10BD wait', () => {
    const t = resolveExpiry(baseCase(), now);
    expect(t?.phaseCode).toBe('phase_2_retention');
    expect(t?.statusCode).toBe('p2_new');
    expect(t?.agentOutcome).toBe('no_action_2bd');
    expect(t?.currentDeadlineType).toBe(RETENTION_WAIT_DEADLINE_TYPE);
  });

  it('5BD post-contact → Open Pool', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_reached',
        currentDeadlineType: POST_CONTACT_DEADLINE_TYPE,
        agentOutcome: 'returned',
      }),
      now,
    );
    expect(t?.statusCode).toBe('p1_open_pool');
    expect(t?.currentDeadlineType).toBe(POOL_CLAIM_DEADLINE_TYPE);
  });

  it('3BD pool unclaimed → Retention', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_open_pool',
        currentDeadlineType: POOL_CLAIM_DEADLINE_TYPE,
        assignedAgentZohoUserId: null,
      }),
      now,
    );
    expect(t?.phaseCode).toBe('phase_2_retention');
    expect(t?.currentDeadlineType).toBe(RETENTION_WAIT_DEADLINE_TYPE);
  });

  it('3BD new owner with assignmentCount 3 → CITI', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_pool_assigned',
        currentDeadlineType: NEW_OWNER_DEADLINE_TYPE,
        assignmentCount: 3,
      }),
      now,
    );
    expect(t?.phaseCode).toBe('phase_3_citi');
    expect(t?.statusCode).toBe('p3_hold');
  });

  it('3BD new owner under cap → back to Open Pool', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_pool_assigned',
        currentDeadlineType: NEW_OWNER_DEADLINE_TYPE,
        assignmentCount: 2,
      }),
      now,
    );
    expect(t?.statusCode).toBe('p1_open_pool');
  });

  it('10BD Retention wait → CITI', () => {
    const t = resolveExpiry(
      baseCase({
        phaseCode: 'phase_2_retention',
        statusCode: 'p2_new',
        currentDeadlineType: RETENTION_WAIT_DEADLINE_TYPE,
      }),
      now,
    );
    expect(t?.phaseCode).toBe('phase_3_citi');
  });

  it('14D vacation → follow-up task', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_vacation',
        currentDeadlineType: VACATION_COUNTDOWN_TYPE,
        agentOutcome: 'vacation',
      }),
      now,
    );
    expect(t?.statusCode).toBe('p1_vacation_followup');
    expect(t?.currentDeadlineType).toBe(VACATION_FOLLOWUP_DEADLINE_TYPE);
  });

  it('2BD vacation follow-up → awaiting Ops', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_vacation_followup',
        currentDeadlineType: VACATION_FOLLOWUP_DEADLINE_TYPE,
        agentOutcome: 'vacation',
      }),
      now,
    );
    expect(t?.statusCode).toBe('p1_awaiting_ops');
    expect(t?.currentDeadlineAt).toBeNull();
  });

  it('skips 1BD comms attempt (SLA only)', () => {
    const t = resolveExpiry(
      baseCase({
        statusCode: 'p1_out_of_reach',
        currentDeadlineType: '1BD_comms_attempt',
      }),
      now,
    );
    expect(t).toBeNull();
  });
});
