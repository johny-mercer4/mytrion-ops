/**
 * Retention Phase 2 caps + Spanish desk signal helpers.
 */
import { describe, expect, it } from 'vitest';
import { resolveSpanishDesk } from '../../src/integrations/dwhRetention.js';
import {
  formatCallRoleNote,
  parseCallRoleFromNotes,
  CS_MAX_DEALS_PER_DAY,
  CS_MAX_PENDING_RATIO,
} from '../../src/modules/retention/csCaps.js';
import { resolvePhase2Transition } from '../../src/modules/retention/phase2.js';

describe('resolveSpanishDesk', () => {
  it('prefers main_language Spanish', () => {
    const r = resolveSpanishDesk({ mainLanguage: 'Spanish', nationality: 'Mexican' });
    expect(r.isSpanishDesk).toBe(true);
    expect(r.preferredLanguage).toBe('Spanish');
  });

  it('falls back to nationality Spanish', () => {
    const r = resolveSpanishDesk({ mainLanguage: null, nationality: 'Spanish' });
    expect(r.isSpanishDesk).toBe(true);
    expect(r.preferredLanguage).toBe('Spanish');
  });

  it('is false when neither is Spanish', () => {
    const r = resolveSpanishDesk({ mainLanguage: 'English', nationality: 'Uzbek' });
    expect(r.isSpanishDesk).toBe(false);
  });
});

describe('call role notes', () => {
  it('round-trips listen / solution markers', () => {
    expect(parseCallRoleFromNotes(formatCallRoleNote('listen', 'hi'))).toBe('listen');
    expect(parseCallRoleFromNotes(formatCallRoleNote('solution'))).toBe('solution');
    expect(parseCallRoleFromNotes('plain note')).toBeNull();
  });
});

describe('phase2 mark_pending', () => {
  it('transitions to p2_offer_pending', () => {
    const patch = resolvePhase2Transition(
      {
        closedAt: null,
        phaseCode: 'phase_2_retention',
        statusCode: 'p2_working',
        assignedAgentZohoUserId: 'u1',
        assignmentCount: 1,
      },
      'mark_pending',
    );
    expect(patch.statusCode).toBe('p2_offer_pending');
  });
});

describe('cap constants', () => {
  it('matches RetentionFinal numbers', () => {
    expect(CS_MAX_DEALS_PER_DAY).toBe(40);
    expect(CS_MAX_PENDING_RATIO).toBe(0.15);
  });
});
