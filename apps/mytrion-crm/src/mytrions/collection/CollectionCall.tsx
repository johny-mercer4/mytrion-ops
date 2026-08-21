/**
 * Click-to-dial from a collection case.
 *
 * The softphone was already allowed to mount on Collection — both the route gate and the backend's
 * `RC_SOFTPHONE_DEPARTMENTS` list it — but nothing on the desk ever dialled with it. A collector
 * read the debtor's number off the screen and typed it into the widget, and the call reached the
 * desk only if they then filled in the Log contact dialog by hand.
 *
 * `setDialContext` is what makes the difference: it tags the next outbound call with this case, so
 * `/ringcentral/call-events` can write the finished call onto the case timeline with its duration
 * and whether anyone picked up. Without the tag the call is still logged, just not against anything.
 *
 * Renders NOTHING when there is no number, and falls back to a `tel:` link when in-app calling is
 * not supported (a browser without the widget, or a device that owns its own dialler) — a dead
 * button that silently does nothing is worse than no button.
 */
import { Button, useToast } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import { inAppCallingSupported } from '@/components/ringcentral/rcCapability';
import { setDialContext } from '@/components/ringcentral/ringcentralEvents';

/**
 * The number to dial. A phone a collector CONFIRMED on a call beats the one the finder copied off
 * the Deal — that block is overwritten every half hour and is where dead numbers live.
 */
export function callPhone(row: CollectionCaseRow): string | null {
  return row.verifiedPhone ?? row.debtorPhone ?? row.debtorCellPhone ?? null;
}

/**
 * Dial `phone`, tagged to this case, and tell the caller whether the softphone took it. Exported
 * so a surface that already owns its own button (the worklist row) can dial without rendering
 * another one.
 */
export function dialForCase(caseId: string, phone: string | null | undefined): boolean {
  const number = (phone ?? '').trim();
  if (!number || !inAppCallingSupported()) return false;
  setDialContext({ collectionCaseId: caseId });
  return clickToDial(number);
}

export function CallButton({
  caseId,
  phone,
  label = 'Call',
  size = 'sm',
  variant = 'secondary',
}: {
  caseId: string;
  phone: string | null | undefined;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { toast } = useToast();
  const number = (phone ?? '').trim();
  if (!number) return null;

  // A plain tel: link, not a disabled Button: on a phone this is the better affordance anyway,
  // and `ds/Button` does not render as an anchor.
  if (!inAppCallingSupported()) {
    return (
      <a className="co-tel" href={`tel:${number}`}>
        {label}
      </a>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      icon="call"
      onClick={() => {
        setDialContext({ collectionCaseId: caseId });
        if (!clickToDial(number)) {
          toast({
            intent: 'warning',
            title: 'The softphone is not ready',
            description: 'Open the RingCentral widget and sign in, then try again.',
          });
        }
      }}
    >
      {label}
    </Button>
  );
}
