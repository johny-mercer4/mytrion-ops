/**
 * Data Center CITI Fuel results — one Deal row, Citifuel status as the badge.
 *
 * Expand lists leftover keys from the existing Deal COQL. No CMP live API.
 */
import { type BadgeIntent, type TabItem } from '@/ds';
import type { CitiSearchBy, CitiSearchResult, CitiVerdict } from '@/api/verificationCiti';
import { ExpandRow } from './CaseDataCenterBlacklist';
import { citiDealFacts, citiDealTitle } from './caseDataCenterModel';

export const CITI_KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'mc', label: 'MC' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Name' },
];

export const CITI_PLACEHOLDER: Record<CitiSearchBy, string> = {
  dot: 'USDOT',
  mc: 'MC number',
  email: 'Email',
  name: 'Legal name',
};

const CITI_INTENT: Record<CitiVerdict, BadgeIntent> = {
  flagged: 'danger',
  clear: 'success',
  unknown: 'warning',
  absent: 'neutral',
};

export function CitiResults({ result }: { result: CitiSearchResult }) {
  const rows = result.records;
  if (rows.length === 0) return null;

  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {rows.length === 1 ? '1 deal' : `${rows.length} deals`}
        {result.matchedOn === 'name'
          ? ' · by name'
          : result.matchedOn === 'mc'
            ? ' · by MC'
            : result.matchedOn === 'email'
              ? ' · by email'
              : result.matchedOn === 'dot'
                ? ' · by USDOT'
                : ''}
        {result.truncated ? ' · first 50 — refine the search' : ''}
      </p>
      {rows.map((row) => (
        <ExpandRow
          key={row.dealId}
          title={citiDealTitle(row)}
          facts={[
            row.dotNumber ? `USDOT ${row.dotNumber}` : null,
            row.mcNumber ? `MC ${row.mcNumber}` : null,
            row.stage,
          ]}
          badge={row.citifuelStatus ?? 'No status'}
          badgeIntent={CITI_INTENT[row.citifuelVerdict]}
          details={citiDealFacts(row)}
        />
      ))}
    </div>
  );
}
