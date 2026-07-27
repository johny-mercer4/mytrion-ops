import { Sheet } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { CollectionPageHead } from '../CollectionBits';

/**
 * Collection → Array Reports.
 *
 * Array is the external collections agency; this becomes the record of what was placed with them
 * and what came back. There is a servercrm-side Array sync (`jobs/arrayReportSync.js`,
 * `services/arrayReportDwh.js`) that has not been inspected yet, so the column contract is not
 * settled and nothing is guessed at here.
 */
export function CollectionArray() {
  return (
    <div className="co-page">
      <CollectionPageHead tab="array" />
      <ComingSoon
        icon={<Sheet size={26} />}
        title="Array reports"
        body="Accounts placed with the Array agency, the filings sent, and the recovery reported back. The servercrm Array sync needs inspecting before the columns here can be settled."
        sources={['servercrm · Array report sync']}
        tone="var(--tone-amber)"
      />
    </div>
  );
}
