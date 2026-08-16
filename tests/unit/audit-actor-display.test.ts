import { describe, expect, it } from 'vitest';
import {
  CI_TEST_ACTOR_NAME,
  CI_TEST_ACTOR_USER_ID,
  displayAuditUserName,
  isCiTestAuditActor,
} from '../../src/modules/audit/auditActorDisplay.js';

describe('displayAuditUserName', () => {
  it('relabels every short Zoho fixture id', () => {
    expect(displayAuditUserName(CI_TEST_ACTOR_USER_ID, 'Robiya')).toBe(CI_TEST_ACTOR_NAME);
    expect(displayAuditUserName('zoho:888', 'Rep Riley')).toBe('CI Test Admin');
    expect(displayAuditUserName('zoho:777', 'Rep Riley')).toBe('CI Test Admin');
  });

  it('relabels leftover fixture facet labels', () => {
    expect(displayAuditUserName(null, 'Robiya')).toBe(CI_TEST_ACTOR_NAME);
    expect(displayAuditUserName(null, 'Rep Riley')).toBe(CI_TEST_ACTOR_NAME);
  });

  it('treats short Zoho ids as fixtures and 19-digit ids as people', () => {
    expect(isCiTestAuditActor('zoho:42')).toBe(true);
    expect(isCiTestAuditActor('zoho:888')).toBe(true);
    expect(isCiTestAuditActor('zoho:6227679000031473048')).toBe(false);
  });

  it('leaves real Zoho workers alone', () => {
    expect(displayAuditUserName('zoho:6227679000031473048', 'John Mercer')).toBe('John Mercer');
    expect(displayAuditUserName(null, 'John Mercer')).toBe('John Mercer');
  });
});
