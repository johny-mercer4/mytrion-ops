/**
 * Phase 1 retention workflow — pure transition guards + business-day helper.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { RetentionCase } from '../../src/db/schema/index.js';
import {
  addBusinessDays,
  COMMS_ATTEMPT_DEADLINE_TYPE,
  initialPhase1Deadline,
  MAX_OUT_OF_REACH_ATTEMPTS,
  nextCommsAttemptDeadline,
  resolvePhase1Transition,
} from '../../src/modules/retention/phase1.js';

function baseCase(overrides: Partial<RetentionCase> = {}): RetentionCase {
  return {
    id: 1,
    tenantId: DEFAULT_TENANT_ID,
    carrierId: '104882',
    zohoDealId: null,
    companyName: 'Ironhide',
    applicationId: null,
    agentName: 'Rep',
    contactPhone: null,
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
    currentDeadlineAt: null,
    currentDeadlineType: null,
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

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // Friday Jul 17 2026 → +2 BD = Tuesday Jul 21
    const fri = new Date(Date.UTC(2026, 6, 17, 12, 0, 0));
    const result = addBusinessDays(fri, 2);
    expect(result.getUTCDay()).toBe(2); // Tuesday
    expect(result.getUTCDate()).toBe(21);
  });

  it('stamps a 2BD agent-action deadline', () => {
    const d = initialPhase1Deadline(new Date('2026-07-20T12:00:00Z'));
    expect(d.currentDeadlineType).toBe('2BD_agent_action');
    expect(d.currentDeadlineAt.getTime()).toBeGreaterThan(Date.now() - 86_400_000 * 10);
  });
});

describe('resolvePhase1Transition', () => {
  it('rejects manual returned (auto-close via hourly sync only)', () => {
    expect(() => resolvePhase1Transition(baseCase(), { outcome: 'returned' })).toThrow(
      /automatic/i,
    );
  });

  it('requires dissatisfaction reason', () => {
    expect(() =>
      resolvePhase1Transition(baseCase(), { outcome: 'dissatisfied' }),
    ).toThrow(/reason/i);
  });

  it('requires note for switched_other', () => {
    expect(() =>
      resolvePhase1Transition(baseCase(), {
        outcome: 'dissatisfied',
        dissatisfactionReason: 'switched_other',
      }),
    ).toThrow(/note/i);
  });

  it('routes dissatisfied to Retention Phase 2 with 10BD wait', () => {
    const t = resolvePhase1Transition(baseCase(), {
      outcome: 'dissatisfied',
      dissatisfactionReason: 'low_discounts',
    });
    expect(t.phaseCode).toBe('phase_2_retention');
    expect(t.statusCode).toBe('p2_new');
    expect(t.agentOutcome).toBe('dissatisfied');
    expect(t.currentDeadlineType).toBe('10BD_retention');
  });

  it('reached stamps 5BD post-contact watch (clears OoR attempts)', () => {
    const t = resolvePhase1Transition(
      baseCase({ statusCode: 'p1_out_of_reach', outOfReachAttempts: 2 }),
      { outcome: 'reached' },
    );
    expect(t.statusCode).toBe('p1_reached');
    expect(t.agentOutcome).toBe('reached');
    expect(t.currentDeadlineType).toBe('5BD_post_contact');
    expect(t.outOfReachAttempts).toBe(0);
  });

  it('ops_confirm_vacation resets to Phase 1 Working', () => {
    const t = resolvePhase1Transition(baseCase({ statusCode: 'p1_awaiting_ops' }), {
      outcome: 'ops_confirm_vacation',
    });
    expect(t.statusCode).toBe('p1_in_progress');
    expect(t.eventType).toBe('signoff');
    expect(t.currentDeadlineType).toBe('2BD_agent_action');
  });

  it('ops_deny_vacation moves to CITI', () => {
    const t = resolvePhase1Transition(baseCase({ statusCode: 'p1_awaiting_ops' }), {
      outcome: 'ops_deny_vacation',
    });
    expect(t.phaseCode).toBe('phase_3_citi');
    expect(t.statusCode).toBe('p3_hold');
  });

  it('blocks send_to_open_pool before 5 attempts', () => {
    expect(() =>
      resolvePhase1Transition(baseCase({ outOfReachAttempts: 3, statusCode: 'p1_out_of_reach' }), {
        outcome: 'send_to_open_pool',
      }),
    ).toThrow(/5/);
  });

  it('allows send_to_open_pool at 5 attempts', () => {
    const t = resolvePhase1Transition(
      baseCase({ outOfReachAttempts: MAX_OUT_OF_REACH_ATTEMPTS, statusCode: 'p1_out_of_reach' }),
      { outcome: 'send_to_open_pool' },
    );
    expect(t.statusCode).toBe('p1_open_pool');
  });

  it('sets vacation countdown', () => {
    const now = new Date('2026-07-20T00:00:00Z');
    const t = resolvePhase1Transition(baseCase(), { outcome: 'vacation', now });
    expect(t.statusCode).toBe('p1_vacation');
    expect(t.vacationCountdownEnd?.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('escalates no_action to Retention', () => {
    const t = resolvePhase1Transition(baseCase(), { outcome: 'no_action_2bd' });
    expect(t.phaseCode).toBe('phase_2_retention');
    expect(t.agentOutcome).toBe('no_action_2bd');
  });

  it('rejects actions on closed cases', () => {
    expect(() =>
      resolvePhase1Transition(baseCase({ closedAt: new Date() }), { outcome: 'start_working' }),
    ).toThrow(/closed/i);
  });

  it('stamps 1BD deadline when marking out of reach', () => {
    const now = new Date(Date.UTC(2026, 6, 20, 12, 0, 0)); // Mon
    const t = resolvePhase1Transition(baseCase(), { outcome: 'out_of_reach', now });
    expect(t.statusCode).toBe('p1_out_of_reach');
    expect(t.currentDeadlineType).toBe(COMMS_ATTEMPT_DEADLINE_TYPE);
    // Mon + 1 BD = Tue
    expect(t.currentDeadlineAt?.toISOString().slice(0, 10)).toBe('2026-07-21');
  });

  it('nextCommsAttemptDeadline is 1 business day', () => {
    const fri = new Date(Date.UTC(2026, 6, 17, 12, 0, 0));
    const d = nextCommsAttemptDeadline(fri);
    expect(d.currentDeadlineType).toBe(COMMS_ATTEMPT_DEADLINE_TYPE);
    // Fri + 1 BD = Mon
    expect(d.currentDeadlineAt.getUTCDay()).toBe(1);
    expect(d.currentDeadlineAt.toISOString().slice(0, 10)).toBe('2026-07-20');
  });

  it('allows Reached / Dissatisfied / Vacation from OoR', () => {
    const oor = baseCase({ statusCode: 'p1_out_of_reach', outOfReachAttempts: 2 });
    expect(resolvePhase1Transition(oor, { outcome: 'reached' }).statusCode).toBe('p1_reached');
    expect(
      resolvePhase1Transition(oor, {
        outcome: 'dissatisfied',
        dissatisfactionReason: 'low_discounts',
      }).phaseCode,
    ).toBe('phase_2_retention');
    expect(resolvePhase1Transition(oor, { outcome: 'vacation' }).statusCode).toBe('p1_vacation');
  });
});
