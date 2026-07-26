/**
 * Production kill-switches — Open Pool / Phase 2 / claim Zoho transfer off.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { RetentionCase } from '../../src/db/schema/index.js';
import { resolveExpiry } from '../../src/modules/retention/deadlineSweep.js';
import {
  enterOpenPool,
  handoffToRetention,
  POST_CONTACT_DEADLINE_TYPE,
} from '../../src/modules/retention/deadlines.js';
import {
  RETENTION_OPEN_POOL_CLAIM_ZOHO_TRANSFER_ENABLED,
  RETENTION_OPEN_POOL_ESCALATION_ENABLED,
  RETENTION_PHASE2_ESCALATION_ENABLED,
} from '../../src/modules/retention/killSwitches.js';
import { resolvePhase1Transition } from '../../src/modules/retention/phase1.js';

function baseCase(overrides: Partial<RetentionCase> = {}): RetentionCase {
  return {
    id: 1,
    tenantId: DEFAULT_TENANT_ID,
    carrierId: '104882',
    zohoDealId: 'deal-1',
    companyName: 'Ironhide',
    applicationId: null,
    agentName: 'Rep',
    contactPhone: null,
    assignedAgentZohoUserId: '777',
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_new',
    agentOutcome: null,
    dissatisfactionReason: null,
    reasonNote: null,
    outOfReachAttempts: 0,
    assignmentCount: 1,
    openPoolAttemptCount: 0,
    retentionToPoolCount: 0,
    dealOwnerChanged: false,
    daysInactive: 20,
    thresholdDays: 7,
    gallons90d: null,
    transactionFrequency: 'low',
    isSpanishDesk: false,
    preferredLanguage: null,
    currentDeadlineAt: new Date('2026-07-01T00:00:00Z'),
    currentDeadlineType: '2BD_agent_action',
    vacationCountdownEnd: null,
    citiFolderEnteredAt: null,
    citiFolderHoldUntil: null,
    // NOT NULL DEFAULT now() in the schema and in every migration that touches it
    // (0020 / 0023 / 0027) — a null here was a fixture bug, not a nullable column.
    phaseChangedAt: new Date('2026-07-01T00:00:00Z'),
    closedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('retention kill-switches (production defaults)', () => {
  it('keeps Open Pool / Phase 2 / claim Zoho transfer disabled', () => {
    expect(RETENTION_OPEN_POOL_ESCALATION_ENABLED).toBe(false);
    expect(RETENTION_PHASE2_ESCALATION_ENABLED).toBe(false);
    expect(RETENTION_OPEN_POOL_CLAIM_ZOHO_TRANSFER_ENABLED).toBe(false);
  });

  it('Dissatisfied stays Phase 1 (no Retention desk handoff)', () => {
    const t = resolvePhase1Transition(baseCase(), {
      outcome: 'dissatisfied',
      dissatisfactionReason: 'low_discounts',
    });
    expect(t.phaseCode).toBe('phase_1_agent');
    expect(t.statusCode).toBe('p1_dissatisfied');
    expect(t.agentOutcome).toBe('dissatisfied');
  });

  it('blocks no_action / escalate Retention handoff', () => {
    expect(() =>
      resolvePhase1Transition(baseCase(), { outcome: 'no_action_2bd' }),
    ).toThrow(/temporarily disabled/i);
    expect(() => handoffToRetention({})).toThrow(/temporarily disabled/i);
  });

  it('blocks enterOpenPool', () => {
    expect(() => enterOpenPool({})).toThrow(/temporarily disabled/i);
  });

  it('deadline sweep skips Open Pool / Retention escalations', () => {
    const now = new Date('2026-07-20T12:00:00Z');
    expect(resolveExpiry(baseCase(), now)).toBeNull();
    expect(
      resolveExpiry(
        baseCase({
          statusCode: 'p1_reached',
          currentDeadlineType: POST_CONTACT_DEADLINE_TYPE,
          agentOutcome: 'reached',
        }),
        now,
      ),
    ).toBeNull();
  });
});
