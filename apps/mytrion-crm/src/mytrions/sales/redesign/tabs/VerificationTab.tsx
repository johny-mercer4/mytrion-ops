/**
 * Sales "Verification" tab — the agent's applications straight from Zoho CRM Deals, freshest
 * application first. A card opens the verification record + compliance timeline.
 *
 * Card and detail share presenters in `verificationFields` so Deal Pipeline, WEX Status, and
 * Zoho Credit Decision cannot disagree. Detail opens as the Data Center client sheet over the roster.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { getImpersonation } from '@/api/impersonation';
import {
  getVerificationClients,
  type VerificationClient,
  type VerificationClientPage,
  type VerificationStateFilter,
} from '@/api/verification';
import { SalesEmpty, SalesErrorNote, SalesPage, SalesPageHead, SalesPager } from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import { ClientDetailPage } from '../VerificationDetail';
import {
  ApplicationStatusFacts,
  CLASSIFICATION_VIS,
  FactChip,
  money,
  VerificationStateLine,
} from '../verificationFields';

const PAGE_SIZE = 9;
const STATE_FILTERS: ReadonlyArray<{ id: VerificationStateFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected (prepay)' },
];

function VerificationCard({
  client,
  onOpen,
}: {
  client: VerificationClient;
  onOpen: () => void;
}) {
  const cls = CLASSIFICATION_VIS[client.classification];
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="verification-card"
      className="ss-card-h ss-verification-card"
      aria-label={`Open verification pipeline for ${client.companyName}`}
    >
      <div className="ss-verification-card-top">
        <div className="ss-verification-card-heading">
          <div className="ss-verification-card-title">{client.companyName}</div>
          <span className="ss-vf-open">
            Open pipeline <Icon name="chevronRight" size={14} strokeWidth={2.4} />
          </span>
        </div>
        <span className="ss-vf-class" style={{ color: cls.color, borderColor: `color-mix(in srgb,${cls.color} 40%,var(--border))` }}>
          {cls.label}
        </span>
      </div>

      <div className="ss-vf-cp">
        <VerificationStateLine state={client.verificationState} />
        {client.verificationState === 'approved' && (client.cpLimit != null || client.cpPaymentType || client.cpBillingCycle) ? (
          <div className="ss-vf-chips">
            {client.cpLimit != null ? <FactChip label="Limit" value={money(client.cpLimit)} tone="ok" /> : null}
            {client.cpPaymentType ? <FactChip label="Type" value={client.cpPaymentType} /> : null}
            {client.cpBillingCycle ? <FactChip label="Cycle" value={client.cpBillingCycle} /> : null}
          </div>
        ) : null}
        {client.verificationState === 'in_progress' && client.missingFields.length ? (
          <div className="ss-vf-card-missing">
            <Icon name="warn" size={13} /> Missing: {client.missingFields.slice(0, 4).join(', ')}
            {client.missingFields.length > 4 ? '…' : ''}
          </div>
        ) : null}
        {client.verificationState === 'in_progress' && (client.plaidLinkUrl || client.docsUploaded > 0) ? (
          <div className="ss-vf-chips">
            {client.plaidLinkUrl ? <FactChip label="Plaid" value="Link ready" tone="accent" icon="link" /> : null}
            {client.docsUploaded > 0 ? <FactChip label="Docs" value={String(client.docsUploaded)} tone="accent" icon="doc" /> : null}
          </div>
        ) : null}
        {client.workingOn ? (
          <div className="ss-vf-card-verificator">
            <Icon name="user" size={14} /> Verificator: {client.workingOn}
          </div>
        ) : null}
      </div>

      <ApplicationStatusFacts client={client} />

      {client.attentionCount ? (
        <div className="ss-vf-card-attention">
          <Icon name="warn" size={14} /> {client.attentionCount} Verification action
          {client.attentionCount === 1 ? '' : 's'} required
        </div>
      ) : null}

      <div className="ss-vf-card-foot">
        <span>{client.appFillDate ? `Applied ${client.appFillDate}` : 'No application date'}</span>
        {client.applicationId ? <span className="is-mono">#{client.applicationId}</span> : null}
      </div>
    </button>
  );
}

export function VerificationTab() {
  const viewAsUserId = getImpersonation()?.zohoUserId;
  const actAs = viewAsUserId ?? 'self';
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<VerificationStateFilter>('all');
  const [selected, setSelected] = useState<VerificationClient | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const load = useCachedLoad<VerificationClientPage>(
    `sales:verification:${actAs}:${stateFilter}:${page}:${encodeURIComponent(debouncedQuery)}`,
    () => getVerificationClients({
      ...(viewAsUserId ? { zohoUserId: viewAsUserId } : {}),
      page,
      pageSize: PAGE_SIZE,
      query: debouncedQuery,
      state: stateFilter,
    }),
    { staleMs: 90_000 },
  );
  const clients = load.data?.clients ?? [];
  const total = load.data?.pagination.total ?? 0;
  const pageCount = load.data?.pagination.pageCount ?? 1;
  const pageStart = (page - 1) * PAGE_SIZE;
  const degradedSources = load.data?.sourceHealth
    ? Object.entries(load.data.sourceHealth)
        .filter(([, health]) => health === 'degraded')
        .map(([source]) => source)
    : [];
  const showingFallback = Boolean(load.data?.partial || load.data?.freshness === 'stale');

  const emptyMsg = debouncedQuery
    ? 'No applications match your search.'
    : stateFilter !== 'all'
      ? 'No applications in this state.'
      : 'No verification applications yet.';

  return (
    <SalesPage
      className="ss-verification-page"
      busy={(load.loading && !load.data) || load.revalidating}
    >
      <SalesPageHead description={NAV_DESC.verification} />

      <div className="ss-toolbar">
        <div className="ss-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => { setQuery(e.currentTarget.value); setPage(1); }}
            aria-label="Search verification applications"
            placeholder="Search by company, deal name, stage, decision, carrier ID or application #…"
          />
          {query ? (
            <button
              type="button"
              className="ss-search-clear"
              aria-label="Clear search"
              onClick={() => { setQuery(''); setPage(1); }}
            >
              <Icon name="close" size={13} strokeWidth={2.4} />
            </button>
          ) : null}
        </div>
        <div className="ss-vf-filters" role="group" aria-label="Filter by verification state">
          {STATE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`ss-vf-filter${stateFilter === filter.id ? ' is-active' : ''}`}
              aria-pressed={stateFilter === filter.id}
              onClick={() => { setStateFilter(filter.id); setPage(1); }}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {showingFallback && load.data ? (
        <div className="ss-source-health" role="status">
          <Icon name="warn" size={16} color="var(--warn)" />
          <span>
            Showing the latest available pipeline data
            {degradedSources.length ? ` while ${degradedSources.join(' and ')} recovers` : ''}.
          </span>
        </div>
      ) : null}

      {load.loading && !load.data ? (
        <SalesBodySkeleton variant="grid" rows={9} label="verification applications" />
      ) : load.error && !load.data ? (
        <SalesErrorNote>{load.error}</SalesErrorNote>
      ) : clients.length === 0 ? (
        <SalesEmpty
          icon="verification"
          title={debouncedQuery ? 'No matching applications' : 'No applications yet'}
          body={emptyMsg}
        />
      ) : (
        <>
        <div className="ss-verification-grid" data-testid="verification-grid">
          {clients.map((client, index) => (
            <VerificationCard
              key={client.dealId ?? client.carrierId ?? `application-${index}`}
              client={client}
              onOpen={() => setSelected(client)}
            />
          ))}
        </div>
        {total > 0 ? (
          <SalesPager
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            summary={`Showing ${pageStart + 1}–${Math.min(pageStart + clients.length, total)} of ${total}${load.data?.pagination.truncated ? '+' : ''} pipeline applications`}
          />
        ) : null}
        </>
      )}
      {selected ? <ClientDetailPage client={selected} onBack={() => setSelected(null)} /> : null}
    </SalesPage>
  );
}
