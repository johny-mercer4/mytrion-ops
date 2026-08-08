/**
 * "Test as" is chat-scoped and sends only the id. The whole security argument rests on the backend
 * resolving profile/role from the CRM directory, so shipping those as headers would be misleading at
 * best — they are ignored server-side and only produce a log line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { chatTestAsHeaders, getChatTestAs, setChatTestAs } from './testAs';

describe('chat "Test as" target', () => {
  beforeEach(() => {
    localStorage.clear();
    setChatTestAs(null);
  });

  it('sends no act-as header when testing as yourself', () => {
    expect(getChatTestAs()).toBeNull();
    expect(chatTestAsHeaders()).toEqual({});
  });

  it('sends ONLY the zoho user id — never a client-chosen profile or role', () => {
    setChatTestAs({ zohoUserId: '42', name: 'Test CS Agent', profile: 'Customer Retention', role: 'Agent' });
    expect(chatTestAsHeaders()).toEqual({ 'x-act-as-zoho-user-id': '42' });
  });

  it('survives a reload through localStorage', () => {
    setChatTestAs({ zohoUserId: '7', name: 'Daniel Brown' });
    expect(JSON.parse(localStorage.getItem('octane.chatTestAs.v1') ?? 'null')).toMatchObject({
      zohoUserId: '7',
    });
  });

  it('clears back to your own access', () => {
    setChatTestAs({ zohoUserId: '7', name: 'Daniel Brown' });
    setChatTestAs(null);
    expect(getChatTestAs()).toBeNull();
    expect(chatTestAsHeaders()).toEqual({});
    expect(localStorage.getItem('octane.chatTestAs.v1')).toBeNull();
  });

  it('does not touch the per-Mytrion View-as store', () => {
    setChatTestAs({ zohoUserId: '9', name: 'Someone Else' });
    expect(localStorage.getItem('octane.actAs.byMytrion.v1')).toBeNull();
  });
});
