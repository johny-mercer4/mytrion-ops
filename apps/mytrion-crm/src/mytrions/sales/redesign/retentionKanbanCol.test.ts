import { describe, expect, it } from 'vitest';
import { kanbanColOf, type RetentionCaseRow } from './retentionData';

function row(partial: Partial<RetentionCaseRow>): RetentionCaseRow {
  return {
    id: '1',
    carrierId: '5806565',
    companyName: 'Test',
    zohoDealId: null,
    applicationId: null,
    agentName: null,
    assignedAgentZohoUserId: null,
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_new',
    agentOutcome: null,
    transactionFrequency: 'low',
    daysInactive: 10,
    thresholdDays: 7,
    gallons90d: null,
    outOfReachAttempts: 0,
    assignmentCount: 1,
    openPoolAttemptCount: 0,
    dealOwnerChanged: false,
    dissatisfactionReason: null,
    reasonNote: null,
    contactPhone: null,
    isSpanishDesk: false,
    preferredLanguage: null,
    currentDeadlineAt: null,
    currentDeadlineType: null,
    vacationCountdownEnd: null,
    isOpen: true,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('kanbanColOf — Retention escalations stay on source stage', () => {
  it('keeps Dissatisfied handoff on Dissatisfied (not Closed)', () => {
    expect(
      kanbanColOf(
        row({
          phaseCode: 'phase_2_retention',
          statusCode: 'p2_new',
          agentOutcome: 'dissatisfied',
        }),
      ),
    ).toBe('dissatisfied');
  });

  it('keeps New→Retention (no_action_2bd) on New (not Closed)', () => {
    expect(
      kanbanColOf(
        row({
          phaseCode: 'phase_2_retention',
          statusCode: 'p2_new',
          agentOutcome: 'no_action_2bd',
        }),
      ),
    ).toBe('new');
  });

  it('keeps escalate_retention (null outcome) on New', () => {
    expect(
      kanbanColOf(
        row({
          phaseCode: 'phase_2_retention',
          statusCode: 'p2_new',
          agentOutcome: null,
        }),
      ),
    ).toBe('new');
  });

  it('still parks returned / closed cases on Closed', () => {
    expect(
      kanbanColOf(
        row({
          phaseCode: 'phase_1_agent',
          statusCode: 'p1_returned',
          isOpen: false,
        }),
      ),
    ).toBe('closed');
  });
});
