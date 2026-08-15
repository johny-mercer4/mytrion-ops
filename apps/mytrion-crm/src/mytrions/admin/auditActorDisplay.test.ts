import { describe, expect, it } from 'vitest';
import { auditActorDisplay } from './auditActorDisplay';

describe('auditActorDisplay', () => {
  it('relabels every short Zoho fixture id', () => {
    expect(auditActorDisplay({ userId: 'zoho:42', userName: 'Robiya' })).toBe('CI Test Admin');
    expect(auditActorDisplay({ userId: 'zoho:888', userName: 'Rep Riley' })).toBe('CI Test Admin');
  });

  it('leaves real workers alone', () => {
    expect(auditActorDisplay({ userId: 'zoho:6227679000031473048', userName: 'John Mercer' })).toBe(
      'John Mercer',
    );
  });
});
