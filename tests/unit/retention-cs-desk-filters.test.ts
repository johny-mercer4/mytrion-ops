import { describe, expect, it } from 'vitest';
import {
  CS_DESK_FILTERS,
  CS_DESK_PHASES,
  CS_DESK_STATUSES,
} from '../../src/repos/retentionCaseCsRepo.js';

describe('CS desk filter enums', () => {
  it('keeps legacy flat filters', () => {
    expect(CS_DESK_FILTERS).toContain('all_open');
    expect(CS_DESK_FILTERS).toContain('new');
    expect(CS_DESK_FILTERS).toContain('working');
  });

  it('exposes phase + status for hierarchical desk UI', () => {
    expect(CS_DESK_PHASES).toEqual(['any', 'sales', 'retention', 'citi']);
    expect(CS_DESK_STATUSES).toContain('to_claim');
    expect(CS_DESK_STATUSES).toContain('calling');
    expect(CS_DESK_STATUSES).toContain('hold');
  });
});
