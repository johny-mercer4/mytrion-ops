import { describe, expect, it } from 'vitest';
import { evaluateWexActionContext } from './AutoWexEligibility';

describe('Sales WEX action eligibility display', () => {
  it('surfaces owner and permits an active application', () => {
    expect(evaluateWexActionContext({
      found: true,
      status: 'Submitted',
      statusGroup: 'Application in Progress',
      application: { stage: 'Adjudication', ownerName: 'WEX Owner' },
    })).toMatchObject({
      allowed: true,
      ownerName: 'WEX Owner',
      stage: 'Adjudication',
    });
  });

  it.each([
    [{ status: 'Closed/Lost', statusGroup: 'Closed', stage: 'Application' }, 'Closed/Lost'],
    [{ status: 'Cards Produced', statusGroup: 'Carrier ID out, Cards Sent', stage: 'Implementation' }, 'already been sent'],
    [{ status: 'Submitted', statusGroup: 'Application in Progress', stage: 'Expansion' }, 'Expansion-stage'],
  ])('shows the blocking reason for %o', (state, reason) => {
    const result = evaluateWexActionContext({
      found: true,
      status: state.status,
      statusGroup: state.statusGroup,
      application: { stage: state.stage },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(reason);
  });
});
