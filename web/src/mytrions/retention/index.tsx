import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Retention Mytrion — NEW (no existing widget). Skeleton: shell + scoped chat. */
export default function RetentionMytrion() {
  return (
    <MytrionScaffold
      id="retention"
      buildNotes={[
        'Churn-risk signals / at-risk client list (data source TBD)',
        'Win-back workflows & outreach tracking',
        'Retention metrics dashboard',
      ]}
    />
  );
}
