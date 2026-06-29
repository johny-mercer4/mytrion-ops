import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Verification Mytrion — NEW (no existing widget). Skeleton: shell + scoped chat. */
export default function VerificationMytrion() {
  return (
    <MytrionScaffold
      id="verification"
      buildNotes={[
        'Application / document verification queue',
        'Verification checklist & status transitions',
        'Audit trail of verification decisions',
      ]}
    />
  );
}
