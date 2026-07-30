import { LayoutGrid } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { CollectionPageHead } from '../CollectionBits';

/**
 * Collection → Collection Cases.
 *
 * The escalation board: hand-off → contacting → agency → payment plan → recovered / bad debt.
 *
 * This module previously shipped a working-looking board built entirely on invented cases. Those
 * fixtures were deleted. The real source is most likely the existing `retention_cases` machinery
 * plus the cmp_invoice debt figure Finance and Billing already agree on — but advancing a case is a
 * WRITE, so it needs an audited, role-gated endpoint before any of it is wired.
 */
export function CollectionCases() {
  return (
    <div className="co-page">
      <CollectionPageHead tab="cases" />
      <ComingSoon
        icon={<LayoutGrid size={26} />}
        title="Collection cases"
        body="Bad-debt escalation from hand-off through contact, payment plan and recovery. Advancing a case is a write, so this waits on an audited, role-gated endpoint rather than a board that only looks real."
        sources={['public.cmp_invoice', 'retention_cases']}
        tone="var(--tone-sky)"
      />
    </div>
  );
}
