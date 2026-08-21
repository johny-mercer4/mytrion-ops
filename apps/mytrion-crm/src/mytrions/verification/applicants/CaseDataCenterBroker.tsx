/**
 * Data Center Broker Snapshot results — full warehouse row on expand.
 */
import { type BadgeIntent } from '@/ds';
import type { BrokerSnapshotSearchResult } from '@/api/verificationBrokerSnapshot';
import { ExpandRow, LoadMoreButton } from './CaseDataCenterBlacklist';
import { brokerSnapshotFacts, brokerSnapshotTitle, brokerStatusVerdict } from './caseDataCenterModel';

const STATUS_INTENT: Record<'active' | 'inactive' | 'unknown', BadgeIntent> = {
  active: 'success',
  inactive: 'danger',
  unknown: 'neutral',
};

export function BrokerResults({
  result,
  loadingMore,
  onLoadMore,
}: {
  result: BrokerSnapshotSearchResult;
  loadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
}) {
  const rows = result.records;
  if (rows.length === 0) return null;

  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {rows.length === 1 ? '1 carrier' : `${rows.length} carriers`}
        {result.matchedOn === 'name' ? ' · by name' : result.matchedOn === 'dot' ? ' · by USDOT' : ''}
      </p>
      {rows.map((row) => (
        <ExpandRow
          key={row.id}
          title={brokerSnapshotTitle(row)}
          facts={[row.dotNumber ? `USDOT ${row.dotNumber}` : null, row.phoneNumber]}
          badge={row.operatingStatus ?? 'Unknown'}
          badgeIntent={STATUS_INTENT[brokerStatusVerdict(row.operatingStatus)]}
          details={brokerSnapshotFacts(row)}
        />
      ))}
      {result.pagination.hasMore && onLoadMore ? (
        <LoadMoreButton busy={Boolean(loadingMore)} onClick={onLoadMore} />
      ) : null}
    </div>
  );
}
