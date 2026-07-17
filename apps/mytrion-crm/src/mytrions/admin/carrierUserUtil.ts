import type { CarrierInvitation } from '../../api/carrierUsers';

export type InviteStatus = 'pending' | 'redeemed' | 'expired' | 'cancelled';

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Pending',
  redeemed: 'Redeemed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

/**
 * What the row should actually say. The backend leaves an invite `pending` until something tries
 * to redeem it, so a link whose expiry has passed is still stored as pending — the table has to
 * work that out itself or it shows a dead link as live.
 */
export function inviteStatus(inv: CarrierInvitation, now = Date.now()): InviteStatus {
  if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < now) return 'expired';
  return inv.status;
}

/** Only a live invite can be copied or cancelled; everything else is history. */
export function isLiveInvite(inv: CarrierInvitation, now = Date.now()): boolean {
  return inviteStatus(inv, now) === 'pending';
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "in 3 days" / "2 hours ago" — an absolute timestamp alone makes the reader do the arithmetic. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(diff / 86_400_000), 'day');
}

/** A live invite inside this window is worth flagging — it may die before the carrier opens it. */
export function expiresSoon(inv: CarrierInvitation, now = Date.now()): boolean {
  return isLiveInvite(inv, now) && new Date(inv.expiresAt).getTime() - now < 24 * 3_600_000;
}

/**
 * Clipboard helper for the carrier invite links.
 *
 * Resolves to whether the text actually landed on the clipboard, so callers can tell the truth in
 * their toast. `navigator.clipboard.writeText` rejects asynchronously (permission denied, or any
 * non-secure context), which a plain try/catch around the call cannot see — the earlier version
 * swallowed nothing and leaked an unhandled rejection instead.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the execCommand path below — it still works in the contexts where the
    // async Clipboard API is unavailable or blocked.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
