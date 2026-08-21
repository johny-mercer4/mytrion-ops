/**
 * Data Center FMCSA / Motus result lists. Split from CaseDataCenter so that file
 * stays under the 600-line cap after Load more landed.
 */
import { type ReactNode } from 'react';
import { Skeleton, type BadgeIntent } from '@/ds';
import type { FmcsaCarrierRow, FmcsaSearchBy, FmcsaStatusVerdict } from '@/api/verificationFmcsa';
import type { MotusCensusRecord, MotusSearchResult } from '@/api/verificationMotus';
import {
  fmcsaCarrierTitle,
  fmcsaCityState,
  fmcsaDetailFacts,
  fmcsaStatusLabel,
  flattenFields,
  motusCensusFacts,
  motusCensusTitle,
  motusMcLabel,
} from './caseDataCenterModel';
import { ExpandRow } from './CaseDataCenterBlacklist';

const STATUS_INTENT: Record<FmcsaStatusVerdict, BadgeIntent> = {
  active: 'success',
  inactive: 'danger',
  unknown: 'neutral',
};

function censusStatus(code: MotusCensusRecord['statusCode']): FmcsaStatusVerdict {
  if (code === 'A') return 'active';
  if (code === 'I') return 'inactive';
  return 'unknown';
}

export function ResultsSkeleton({ label }: { label: string }) {
  return (
    <div className="va-dc-list" aria-busy="true" aria-label={label}>
      <Skeleton variant="rect" height="64px" radius="control" />
      <Skeleton variant="rect" height="64px" radius="control" />
    </div>
  );
}

export function FmcsaResults({
  rows,
  truncated,
  matchedOn,
}: {
  rows: FmcsaCarrierRow[];
  truncated: boolean;
  matchedOn: FmcsaSearchBy | null;
}) {
  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {rows.length === 1 ? '1 carrier' : `${rows.length} carriers`}
        {matchedOn === 'name' ? ' · by name' : matchedOn === 'mc' ? ' · by MC' : matchedOn === 'dot' ? ' · by USDOT' : ''}
        {truncated ? ' · first 50 — refine the name' : ''}
      </p>
      {rows.map((row, index) => (
        <ExpandRow
          key={row.dotNumber ?? `${row.legalName ?? 'row'}-${index}`}
          title={fmcsaCarrierTitle(row)}
          facts={[
            row.dotNumber ? `USDOT ${row.dotNumber}` : null,
            row.dbaName && row.dbaName !== row.legalName ? `DBA ${row.dbaName}` : null,
            fmcsaCityState(row),
          ]}
          badge={fmcsaStatusLabel(row.status)}
          badgeIntent={STATUS_INTENT[row.status]}
          details={fmcsaDetailFacts(row)}
        />
      ))}
    </div>
  );
}

export function MotusResults({ result }: { result: MotusSearchResult }) {
  const census = result.census.records;
  const filings = result.insurance?.filings ?? [];
  const agents = result.processAgents?.agents ?? [];
  if (census.length === 0 && filings.length === 0 && agents.length === 0) return null;

  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {census.length === 1 ? '1 carrier' : `${census.length} carriers`}
        {result.matchedOn === 'name' ? ' · by name' : result.matchedOn === 'dot' ? ' · by USDOT' : ''}
        {result.census.truncated ? ' · first page — refine the name' : ''}
      </p>
      {result.census.error && result.census.available === false ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {result.census.error}
        </p>
      ) : null}
      {census.map((row) => (
        <ExpandRow
          key={row.dotNumber}
          title={motusCensusTitle(row)}
          facts={[
            `USDOT ${row.dotNumber}`,
            motusMcLabel(row),
            row.dbaName && row.dbaName !== row.legalName ? `DBA ${row.dbaName}` : null,
            [row.address.city, row.address.state].filter(Boolean).join(', ') || null,
          ]}
          badge={row.statusLabel ?? 'Unknown'}
          badgeIntent={STATUS_INTENT[censusStatus(row.statusCode)]}
          details={motusCensusFacts(row)}
        />
      ))}
      {result.insurance ? (
        <FrozenBlock
          title="Insurance filings"
          asOf={result.insurance.dataAsOf}
          error={!result.insurance.available ? result.insurance.error : null}
          empty={result.insurance.available && filings.length === 0}
          emptyText="No insurance filings in the snapshot."
        >
          {filings.map((filing, index) => (
            <ExpandRow
              key={`${filing.docketNumber}-${filing.formCode}-${index}`}
              title={filing.formLabel ?? filing.formCode}
              facts={[filing.docketNumber, filing.insurer, filing.status]}
              details={flattenFields(filing.fields, [])}
            />
          ))}
        </FrozenBlock>
      ) : null}
      {result.processAgents ? (
        <FrozenBlock
          title="Process agents"
          asOf={result.processAgents.dataAsOf}
          error={!result.processAgents.available ? result.processAgents.error : null}
          empty={result.processAgents.available && agents.length === 0}
          emptyText="No process-agent rows in the snapshot."
        >
          {agents.map((agent, index) => (
            <ExpandRow
              key={`${agent.docketNumber ?? 'agent'}-${index}`}
              title={agent.agentName ?? 'Process agent'}
              facts={[agent.docketNumber, agent.attnTo, [agent.address.city, agent.address.state].filter(Boolean).join(', ') || null]}
              details={flattenFields(agent.fields, ['co_name'])}
            />
          ))}
        </FrozenBlock>
      ) : null}
    </div>
  );
}

function FrozenBlock({
  title,
  asOf,
  error,
  empty,
  emptyText,
  children,
}: {
  title: string;
  asOf: string;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="va-dc-block">
      <p className="va-dc-meta">
        {title} · frozen as of {asOf || '—'}
      </p>
      {error ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {error}
        </p>
      ) : null}
      {empty ? (
        <p className="va-dc-status" role="status">
          {emptyText}
        </p>
      ) : null}
      {children}
    </section>
  );
}
