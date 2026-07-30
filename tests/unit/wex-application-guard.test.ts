import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serverCrmGetMock } = vi.hoisted(() => ({
  serverCrmGetMock: vi.fn(),
}));

vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmGet: serverCrmGetMock,
}));

import {
  assertWexApplicationActionAllowed,
  evaluateWexApplicationEligibility,
  type WexApplicationSnapshot,
} from '../../src/modules/sales/wexApplicationGuard.js';

function snapshot(patch: Partial<WexApplicationSnapshot> = {}): WexApplicationSnapshot {
  return {
    found: true,
    status: 'Submitted',
    statusGroup: 'Application in Progress',
    application: { stage: 'Adjudication' },
    ...patch,
  };
}

describe('WEX application action guard', () => {
  beforeEach(() => serverCrmGetMock.mockReset());

  it('allows an open, non-Expansion application', () => {
    expect(evaluateWexApplicationEligibility(snapshot())).toMatchObject({
      allowed: true,
      status: 'Submitted',
      stage: 'Adjudication',
    });
  });

  it.each([
    ['Closed/Lost', 'Application Closed', 'Application', 'Closed/Lost'],
    ['Closed/Fraud', 'Closed', 'Application', 'Closed/Lost'],
    ['Disqualified', 'Closed', 'Application', 'Closed/Lost'],
    ['Cards Produced', 'Carrier ID out, Cards Sent', 'Implementation', 'cards have already been sent'],
    ['Submitted', 'Application in Progress', 'Expansion', 'Expansion-stage'],
  ])('blocks status %s / group %s / stage %s', (status, statusGroup, stage, reason) => {
    const result = evaluateWexApplicationEligibility(
      snapshot({ status, statusGroup, application: { stage } }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(reason);
  });

  it('blocks records that are missing or have no verifiable status', () => {
    expect(evaluateWexApplicationEligibility(snapshot({ found: false })).allowed).toBe(false);
    expect(
      evaluateWexApplicationEligibility(snapshot({ status: null, statusGroup: null })).allowed,
    ).toBe(false);
  });

  it('reads the live WEX application once and returns an eligible state', async () => {
    serverCrmGetMock.mockResolvedValue(snapshot());

    await expect(assertWexApplicationActionAllowed('123/45', 'BOCA Link Request')).resolves
      .toMatchObject({ allowed: true });
    expect(serverCrmGetMock).toHaveBeenCalledWith('/api/wex/application/123%2F45');
  });

  it('fails closed when WEX cannot verify the application record', async () => {
    serverCrmGetMock.mockResolvedValue(snapshot({ found: false }));

    const error = await assertWexApplicationActionAllowed('123', 'Close Application')
      .catch((caught: unknown) => caught);
    expect({
      statusCode: (error as { statusCode?: number }).statusCode,
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : '',
    }).toEqual({
      statusCode: 409,
      code: 'WEX_APPLICATION_INELIGIBLE',
      message: expect.stringContaining('was not started'),
    });
  });
});
