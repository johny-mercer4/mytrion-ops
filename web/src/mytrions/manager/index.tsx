import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Manager Mytrion — NEW (no existing widget). Skeleton: shell + scoped chat. */
export default function ManagerMytrion() {
  return (
    <MytrionScaffold
      id="manager"
      buildNotes={[
        'Team oversight: per-agent metrics roll-up',
        'Cross-department KPI dashboard (scope depends on OPEN DECISION: manager hierarchy)',
        'Approvals / escalations queue',
      ]}
    />
  );
}
