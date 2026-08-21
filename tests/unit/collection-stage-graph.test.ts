/**
 * The Blueprint graph.
 *
 * Its job is to be a faithful copy of what Zoho enforces, so the tests check shape and totality
 * rather than restating every edge — a restatement would just be the same table typed twice.
 */
import { describe, expect, it } from 'vitest';
import { COLLECTION_STAGES } from '../../src/db/schema/collection.js';
import {
  LEGAL_SMALL_CLAIMS_CEILING_USD,
  STAGE_TRANSITIONS,
  canTransition,
  suggestedCourt,
  transitionFor,
  transitionsFrom,
} from '../../src/modules/collection/stageGraph.js';

describe('stage graph', () => {
  it('covers every stage, and every target is a real stage', () => {
    expect(Object.keys(STAGE_TRANSITIONS).sort()).toEqual([...COLLECTION_STAGES].sort());
    for (const [from, edges] of Object.entries(STAGE_TRANSITIONS)) {
      expect(edges.length, `${from} has no way out`).toBeGreaterThan(0);
      for (const edge of edges) {
        expect(COLLECTION_STAGES, `${from} -> ${edge.to}`).toContain(edge.to);
        expect(edge.label.trim(), `${from} -> ${edge.to} has no label`).not.toBe('');
      }
    }
  });

  it('holds all 39 connections Zoho returned', () => {
    const total = Object.values(STAGE_TRANSITIONS).reduce((n, e) => n + e.length, 0);
    // 39 in Zoho, minus the one from `-None-` (New Case), which the finder performs on create
    // and which has no source stage on our side.
    expect(total).toBe(38);
  });

  it('lets a debtor who picks up re-enter from anywhere', () => {
    for (const stage of COLLECTION_STAGES) {
      if (stage === 'connected') continue;
      expect(canTransition(stage, 'connected'), `${stage} cannot reach connected`).toBe(true);
    }
  });

  it('refuses the moves the Blueprint refuses', () => {
    expect(canTransition('intake', 'with_agency')).toBe(false);
    expect(canTransition('intake', 'closed_successfully')).toBe(false);
    expect(canTransition('connected', 'skip_tracing')).toBe(false);
    expect(canTransition('payment_plan', 'legal_action')).toBe(false);
    expect(canTransition('nc_attempt_1', 'nc_attempt_3')).toBe(false);
  });

  it('keeps With Agency’s self-edge — pick the next agency, stay in the lane', () => {
    expect(canTransition('with_agency', 'with_agency')).toBe(true);
    expect(transitionFor('with_agency', 'with_agency')?.label).toContain('next agency');
  });

  it('orders each stage’s moves the way Zoho does', () => {
    expect(transitionsFrom('connected').map((t) => t.to)).toEqual([
      'payment_plan',
      'with_agency',
      'closed_successfully',
    ]);
    expect(transitionsFrom('intake')[0]?.to).toBe('nc_attempt_1');
  });

  it('routes Legal Action by the $8,000 line the Blueprint draws', () => {
    expect(LEGAL_SMALL_CLAIMS_CEILING_USD).toBe(8_000);
    expect(suggestedCourt(7_999.99)).toBe('small_claims');
    expect(suggestedCourt(8_000)).toBe('civil_court');
    const legal = transitionsFrom('legal_action');
    expect(legal.filter((t) => t.hint).length).toBe(2);
  });

  it('lets a closed case be reopened only through Connected', () => {
    expect(transitionsFrom('closed_successfully').map((t) => t.to)).toEqual(['connected']);
    expect(transitionsFrom('case_lost').map((t) => t.to)).toEqual(['connected']);
  });
});
