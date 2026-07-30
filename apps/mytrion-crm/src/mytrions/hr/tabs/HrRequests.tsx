import { TimeOffWorkspace } from '../../_shared/TimeOffWorkspace';

/** HR's full leave register: self-service, approval inbox, and tenant-wide request history. */
export function HrRequests() {
  return (
    <div className="hr-page hr-time-off-page">
      <TimeOffWorkspace includeAll embedded />
    </div>
  );
}
