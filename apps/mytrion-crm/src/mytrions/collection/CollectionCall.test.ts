/**
 * Click-to-dial from a collection case.
 *
 * Two things worth pinning. The number chosen has to prefer what a HUMAN verified over what the
 * finder copied off the Deal — the finder's block is overwritten every half hour and is where dead
 * numbers live. And dialling has to tag the call with the case, because the tag is the only reason
 * the finished call ends up on the timeline rather than in an untagged call log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clickToDial = vi.fn(() => true);
const setDialContext = vi.fn();
const inAppCallingSupported = vi.fn(() => true);

vi.mock('@/components/ringcentral/ringcentralDial', () => ({ clickToDial }));
vi.mock('@/components/ringcentral/rcCapability', () => ({ inAppCallingSupported }));
vi.mock('@/components/ringcentral/ringcentralEvents', () => ({ setDialContext }));

const { callPhone, dialForCase } = await import('./CollectionCall');
const { caseRowFixture } = await import('./caseRow.fixture');

beforeEach(() => {
  vi.clearAllMocks();
  clickToDial.mockReturnValue(true);
  inAppCallingSupported.mockReturnValue(true);
});

describe('callPhone', () => {
  it('prefers the number a person confirmed', () => {
    const row = caseRowFixture({
      verifiedPhone: '+18065550134',
      debtorPhone: '+15551110000',
      debtorCellPhone: '+15552220000',
    });
    expect(callPhone(row)).toBe('+18065550134');
  });

  it('falls back through the finder’s numbers, landing on null', () => {
    expect(callPhone(caseRowFixture({ debtorPhone: '+15551110000' }))).toBe('+15551110000');
    expect(callPhone(caseRowFixture({ debtorCellPhone: '+15552220000' }))).toBe('+15552220000');
    expect(callPhone(caseRowFixture())).toBeNull();
  });
});

describe('dialForCase', () => {
  it('tags the call with the case before dialling', () => {
    expect(dialForCase('cc_1', '+18065550134')).toBe(true);
    expect(setDialContext).toHaveBeenCalledWith({ collectionCaseId: 'cc_1' });
    expect(clickToDial).toHaveBeenCalledWith('+18065550134');
    // Tag first, dial second — a call that beats its own tag is logged against nothing.
    expect(setDialContext.mock.invocationCallOrder[0]).toBeLessThan(
      clickToDial.mock.invocationCallOrder[0]!,
    );
  });

  it('does nothing at all when there is no number', () => {
    expect(dialForCase('cc_1', null)).toBe(false);
    expect(dialForCase('cc_1', '   ')).toBe(false);
    expect(setDialContext).not.toHaveBeenCalled();
    expect(clickToDial).not.toHaveBeenCalled();
  });

  it('does not tag a call it cannot place', () => {
    // A stale context would otherwise be picked up by whatever the agent dials next.
    inAppCallingSupported.mockReturnValue(false);
    expect(dialForCase('cc_1', '+18065550134')).toBe(false);
    expect(setDialContext).not.toHaveBeenCalled();
  });

  it('reports the softphone refusing the dial, rather than claiming success', () => {
    clickToDial.mockReturnValue(false);
    expect(dialForCase('cc_1', '+18065550134')).toBe(false);
  });
});
