/**
 * Retention pilot allow-list — create gated to listed Sales Zoho user ids.
 */
import { describe, expect, it } from 'vitest';
import {
  isRetentionPilotAgentAllowed,
  parsePilotAgentZohoUserIds,
} from '../../src/modules/retention/retentionSync.js';

describe('retention pilot filter', () => {
  it('parses comma-separated Zoho ids', () => {
    expect([...parsePilotAgentZohoUserIds(' a ,b,')].sort()).toEqual(['a', 'b']);
    expect(parsePilotAgentZohoUserIds('').size).toBe(0);
  });

  it('allows all agents when pilot flag is off', () => {
    expect(
      isRetentionPilotAgentAllowed('6227679000031473048', {
        pilotOnly: false,
        allowIds: new Set(),
      }),
    ).toBe(true);
    expect(
      isRetentionPilotAgentAllowed(null, { pilotOnly: false, allowIds: new Set(['x']) }),
    ).toBe(true);
  });

  it('when pilot on, only allow-listed agents create cases', () => {
    const allow = parsePilotAgentZohoUserIds('6227679000031473048');
    expect(
      isRetentionPilotAgentAllowed('6227679000031473048', { pilotOnly: true, allowIds: allow }),
    ).toBe(true);
    expect(
      isRetentionPilotAgentAllowed('6227679000000000001', { pilotOnly: true, allowIds: allow }),
    ).toBe(false);
    expect(isRetentionPilotAgentAllowed(null, { pilotOnly: true, allowIds: allow })).toBe(false);
  });

  it('when pilot on with empty allow-list, creates none', () => {
    expect(
      isRetentionPilotAgentAllowed('6227679000031473048', {
        pilotOnly: true,
        allowIds: new Set(),
      }),
    ).toBe(false);
  });
});
