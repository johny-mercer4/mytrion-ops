import { Inbox } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { HrPageHead } from '../HrBits';

/**
 * HR → Requests.
 *
 * Approving or rejecting leave MOVES A RECORD, so this needs an audited, role-gated write endpoint
 * behind it before any button appears — the same rule the backend applies to every other write.
 */
export function HrRequests() {
  return (
    <div className="hr-page">
      <HrPageHead tab="requests" />
      <ComingSoon
        icon={<Inbox size={26} />}
        title="Requests"
        body="Leave, time-off and remote-work requests awaiting a decision. Approving is a write, so this waits on an audited, role-gated endpoint rather than shipping buttons that only look real."
        sources={['Zoho People · leave']}
        tone="var(--tone-amber)"
      />
    </div>
  );
}
