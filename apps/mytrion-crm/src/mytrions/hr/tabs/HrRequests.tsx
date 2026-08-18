import { TimeOffWorkspace } from '../../_shared/TimeOffWorkspace';
import { useUserContext } from '../../../context/UserContextProvider';
import { hasFullHrAccess } from '../../../access/resolveAccess';

/** HR's full leave register: self-service, approval inbox, and tenant-wide request history. */
export function HrRequests() {
  const user = useUserContext();
  // Who sees more than their own leave:
  //  • Team leads approve THEIR team (stage 1), so they get the "To approve" inbox.
  //  • HR / admins do the final review AND read the tenant-wide register ("All requests").
  // A plain employee approves nobody and sees only Summary + My requests. UI-gating only — the
  // backend re-checks every decision and scopes every list, so this hides tabs, not the lock.
  const isHr = hasFullHrAccess(user);
  const canApprove = user.leadsTeam === true || isHr;
  return (
    <div className="hr-page hr-time-off-page">
      <TimeOffWorkspace includeAll={isHr} canApprove={canApprove} embedded />
    </div>
  );
}
