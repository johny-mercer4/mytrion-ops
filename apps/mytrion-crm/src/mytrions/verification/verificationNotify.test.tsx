/**
 * The desk's arrival notice.
 *
 * Two defects this pins. The socket was subscribed inside the Inbox TAB, and `ModuleShell` unmounts
 * inactive tabs — so a new application arriving while the agent worked a case reached nobody. And
 * `caseNotify` publishes news and refresh-pings on the same tag, so toasting everything would pop a
 * card each time a Sales agent saved a field.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OctaneInboxEvent } from '../sales/redesign/useOctaneRealtime';
import { VerificationNotifications } from './verificationNotify';

const bus = vi.hoisted(() => ({ emit: null as null | ((e: OctaneInboxEvent) => void) }));

vi.mock('../sales/redesign/useOctaneRealtime', () => ({
  useOctaneRealtime: (opts: { onInboxEvent?: (e: OctaneInboxEvent) => void }) => {
    bus.emit = opts.onInboxEvent ?? null;
  },
}));

function event(over: Partial<OctaneInboxEvent> = {}): OctaneInboxEvent {
  return {
    id: 'inb_1',
    type: 'verification.case.created',
    tag: 'verification',
    ownerKind: 'worker',
    ownerId: 'credit-42',
    title: 'New application — Kaiser Freight LLC',
    detail: 'caseId=vc_1',
    priority: 'low',
    readAt: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

/**
 * The frames arrive from a socket, i.e. outside React's event system, so the `setToasts` they cause
 * is not flushed by the time the next line asserts. `act` is what makes the render deterministic —
 * the alternative is a `waitFor` on every assertion, which hides a real ordering bug behind a retry.
 */
function emit(e: OctaneInboxEvent): void {
  act(() => bus.emit!(e));
}

let onOpenCase: ReturnType<typeof vi.fn>;
let onEvent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  bus.emit = null;
  onOpenCase = vi.fn();
  onEvent = vi.fn();
  render(<VerificationNotifications onOpenCase={onOpenCase} onEvent={onEvent} />);
});

describe('what earns a popup', () => {
  it('announces a new case, and offers the case behind it', () => {
    emit(event());
    expect(screen.getByText('New application — Kaiser Freight LLC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open case' }));
    expect(onOpenCase).toHaveBeenCalledWith('vc_1');
  });

  /**
   * `verification.application.updated` and `…documents_uploaded` are refresh pings, not news — they
   * fire whenever Sales saves a field or attaches a file. They still refresh the desk; they must not
   * pop a card, or the channel becomes noise the agent learns to dismiss unread.
   */
  it('refreshes without announcing on a Sales write', () => {
    emit(event({ id: 'inb_2', type: 'verification.application.updated', title: 'Application updated' }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Application updated')).not.toBeInTheDocument();
  });

  it('ignores another desk’s traffic entirely', () => {
    emit(event({ id: 'inb_3', tag: 'retention', type: 'retention.case.assigned', title: 'Retention case' }));
    expect(onEvent).not.toHaveBeenCalled();
    expect(screen.queryByText('Retention case')).not.toBeInTheDocument();
  });

  /**
   * `publishInboxEvent` fans every frame out to the owner's topic AND the admin firehose, so an admin
   * on both receives the same event twice. Without the seen-set they read every notice in stereo.
   */
  it('announces a frame once even when it arrives twice', () => {
    emit(event());
    emit(event());
    expect(screen.getAllByText('New application — Kaiser Freight LLC')).toHaveLength(1);
    // Both copies still refresh — a duplicate frame is cheap to re-read and always current.
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('prints a real detail line but never the caseId marker', () => {
    emit(event({ id: 'inb_4', detail: '5 items outstanding from Sales' }));
    expect(screen.getByText('5 items outstanding from Sales')).toBeInTheDocument();
    emit(event({ id: 'inb_5', title: 'Another case', detail: 'caseId=vc_9' }));
    expect(screen.queryByText(/caseId=/)).not.toBeInTheDocument();
  });

  it('has no action to offer when the event names no case', () => {
    emit(event({ id: 'inb_6', detail: null }));
    expect(screen.queryByRole('button', { name: 'Open case' })).not.toBeInTheDocument();
  });
});
