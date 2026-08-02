/**
 * Sales "Verification" tab — the agent's applications straight from Zoho CRM Deals, freshest
 * application first. A card opens to the full verification record: the credit decision, the three
 * verification checkpoints, the application facts, and (when Verification has opened a live request)
 * the 9-stage compliance timeline with any action requests addressed to Sales.
 *
 * Data source note: this used to read `octane.agent_deals` in the DWH, which lagged Zoho and carried
 * almost none of the fields below. Everything on this screen is now a Zoho `Deals` field — see
 * `src/integrations/salesVerificationDeals.ts`. The compliance TIMELINE is separate: it comes from
 * the credit_platform provider via /v1/verification/pipeline.
 *
 * Chrome is the shared Sales scaffold (SalesPage / SalesPageHead / SalesEmpty / SalesPager).
 */
import { useEffect, useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { getImpersonation } from '@/api/impersonation';
import {
  getVerificationClients,
  getPipeline,
  type VerificationClient,
  type VerificationClientPage,
  type PipelineStageStatus,
  type PipelineDecision,
} from '@/api/verification';
import { VerificationActionRequest } from '../VerificationActionRequest';
import { VerificationDetailSkeleton } from '../DataCenterSkeletons';
import { SalesEmpty, SalesErrorNote, SalesPage, SalesPageHead, SalesPager } from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import {
  applicationStatusTone,
  CheckpointRail,
  creditDecisionTone,
  creditScoreTone,
  FactChip,
  FactTile,
  gradeTone,
  money,
  riskTone,
  stageTone,
  TONE_COLOR,
} from '../verificationFields';

// ---- status → visual ----
const STAGE_VIS: Record<PipelineStageStatus, { color: string; icon: IconName; label: string }> = {
  done: { color: 'var(--ok)', icon: 'check', label: 'Passed' },
  failed: { color: 'var(--danger)', icon: 'close', label: 'Failed' },
  pending: { color: 'var(--warn)', icon: 'clock', label: 'In progress' },
  skipped: { color: 'var(--muted)', icon: 'ban', label: 'Skipped' },
  not_started: { color: 'var(--border2)', icon: 'clock', label: 'Not started' },
};

const CLASS_VIS: Record<VerificationClient['classification'], { label: string; color: string }> = {
  in_pipeline: { label: 'In Pipeline', color: 'var(--accent)' },
  active: { label: 'Active', color: 'var(--ok)' },
  closed: { label: 'Closed', color: 'var(--muted)' },
};

function decisionBadge(d: PipelineDecision): { text: string; color: string } {
  switch (d.outcome) {
    case 'loc':
      return { text: 'LOC Approved', color: 'var(--ok)' };
    case 'prepaid':
      return { text: 'Prepaid', color: 'var(--accent)' };
    case 'rejected':
      return { text: 'Not Accepted', color: 'var(--danger)' };
    default:
      return { text: 'Undecided', color: 'var(--warn)' };
  }
}

const PAGE_SIZE = 9;
const PENDING_STAGES = [
  'Pre Stop Factors',
  'FMCSA',
  'Plaid / Bank Statement',
  'Highway',
  'iSoft Pull — Credit Score',
  'Black List Match',
  'AntiFraud',
  'CrossCheck',
  'Post Stop Factors',
] as const;

/** Preserve the original nine-stage workspace without pretending a live request already exists. */
function PendingPipeline() {
  const vis = STAGE_VIS.not_started;
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
        <div>
          <div style={s('font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800')}>Compliance pipeline</div>
          <div style={s('font-size:13px;color:var(--text2);margin-top:4px')}>The application is visible to Sales; Verification has not created its live request yet.</div>
        </div>
        <span style={s(`${badge('Awaiting intake', 'var(--warn)').style};font-size:12px;flex-shrink:0`)}>Awaiting intake</span>
      </div>
      <div style={s('display:flex;flex-direction:column;gap:2px')}>
        {PENDING_STAGES.map((label, index) => {
          const last = index === PENDING_STAGES.length - 1;
          return (
            <div key={label} style={s('display:flex;gap:12px')}>
              <div style={s('display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0')}>
                <span style={s(`width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${vis.color} 16%,transparent);color:${vis.color};flex-shrink:0`)}>
                  <Icon name={vis.icon} size={12} strokeWidth={2.6} />
                </span>
                {!last && <span style={s('flex:1;width:2px;min-height:14px;background:var(--border2)')} />}
              </div>
              <div style={s('flex:1;min-width:0;padding-bottom:14px')}>
                <div style={s('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
                  <span style={s('font-size:12px;color:var(--muted);font-family:JetBrains Mono,monospace')}>{index + 1}</span>
                  <span style={s('font-size:14px;font-weight:700')}>{label}</span>
                  <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 9-stage vertical timeline + decision (credit_platform provider, NOT Zoho) ----
function PipelineTimeline({ client }: { client: VerificationClient }) {
  const pipe = useCachedLoad(
    `sales:verification:detail:${client.dealId ?? ''}:${client.carrierId ?? ''}:${client.applicationId ?? ''}`,
    () => getPipeline({ dealId: client.dealId, carrierId: client.carrierId, applicationId: client.applicationId, dot: client.dot }),
    { staleMs: 90_000 },
  );

  if (pipe.loading && !pipe.data) {
    return <VerificationDetailSkeleton />;
  }
  if (pipe.error) {
    return <SalesErrorNote>{pipe.error}</SalesErrorNote>;
  }
  if (!pipe.data) {
    return <PendingPipeline />;
  }

  const { stages, decision, requirements, attachments, events } = pipe.data;
  const dec = decisionBadge(decision);
  const openRequirements = requirements.filter((item) => !item.response).length;

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800')}>Live verification</div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text2);margin-top:4px")}>Request {pipe.data.requestId}</div>
        </div>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          {openRequirements ? (
            <span style={s(`${badge(`${openRequirements} action required`, 'var(--danger)').style};font-size:12px`)}>
              <Icon name="warn" size={12} /> {openRequirements} action required
            </span>
          ) : null}
          <span style={s(`${badge(pipe.data.status, 'var(--accent)').style};font-size:12px`)}>{pipe.data.status}</span>
        </div>
      </div>

      {requirements.length ? (
        <div style={s('display:flex;flex-direction:column;gap:12px')}>
          {requirements.map((requirement) => (
            <VerificationActionRequest
              key={requirement.id}
              requestId={pipe.data!.requestId}
              dealId={client.dealId}
              requirement={requirement}
              onSent={pipe.reload}
            />
          ))}
        </div>
      ) : null}

      <div style={s('display:flex;flex-direction:column;gap:2px')}>{stages.map((st, i) => {
        const vis = STAGE_VIS[st.status];
        const last = i === stages.length - 1;
        return (
          <div key={st.id} style={s('display:flex;gap:12px')}>
            {/* rail: dot + connector */}
            <div style={s('display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0')}>
              <span style={s(`width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${vis.color} 16%,transparent);color:${vis.color};flex-shrink:0`)}>
                <Icon name={vis.icon} size={12} strokeWidth={2.6} />
              </span>
              {!last && <span style={s('flex:1;width:2px;min-height:14px;background:var(--border2)')} />}
            </div>
            {/* body */}
            <div style={s('flex:1;min-width:0;padding-bottom:14px')}>
              <div style={s('display:flex;align-items:center;gap:8px')}>
                <span style={s('font-size:12px;color:var(--muted);font-family:JetBrains Mono,monospace')}>{st.order}</span>
                <span style={s('font-size:14px;font-weight:700')}>{st.label}</span>
                <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
              </div>
              {st.detail && <div style={s('font-size:12px;color:var(--text2);margin-top:3px')}>{st.detail}</div>}
            </div>
          </div>
        );
      })}</div>

      <div style={s('padding:14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
          <span style={s('font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>Platform decision</span>
          <span style={s(`${badge(dec.text, dec.color).style};font-size:13px`)}>{dec.text}</span>
        </div>
        {decision.outcome === 'loc' && (
          <div className="ss-vf-grid" style={{ marginTop: 12 }}>
            <FactTile label="Credit Score" value={decision.creditScore ?? null} tone={creditScoreTone(decision.creditScore ?? null)} />
            <FactTile label="Approved Limit" value={decision.approvedLimit != null ? money(decision.approvedLimit) : null} tone="ok" />
            <FactTile label="Billing Cycle" value={decision.billingCycle ?? null} />
          </div>
        )}
        {decision.reason && decision.outcome !== 'loc' && (
          <div style={s('font-size:13px;color:var(--text2);margin-top:8px')}>{decision.reason}</div>
        )}
      </div>

      {attachments.length || events.length ? (
        <div style={s('display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px')}>
          <div style={s('padding:14px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
            <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Files received</div>
            <div style={s('display:flex;flex-direction:column;gap:8px;margin-top:10px')}>
              {attachments.length ? attachments.slice(0, 6).map((file) => (
                <div key={file.id} style={s('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)')}>
                  <Icon name="file" size={14} />
                  <span style={s('min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.fileName}</span>
                  <span style={s('margin-left:auto;color:var(--muted);white-space:nowrap')}>{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
                </div>
              )) : <span style={s('font-size:12px;color:var(--muted)')}>No files received.</span>}
            </div>
          </div>
          <div style={s('padding:14px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
            <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Recent activity</div>
            <div style={s('display:flex;flex-direction:column;gap:8px;margin-top:10px')}>
              {events.slice(0, 5).map((event) => (
                <div key={event.id} style={s('display:flex;gap:8px;font-size:12px;color:var(--text2)')}>
                  <span style={s('width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:5px;flex:0 0 auto')} />
                  <span>{event.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The Zoho-sourced verification record: decision, checkpoints, application facts, narrative. */
function CrmVerificationRecord({ client }: { client: VerificationClient }) {
  const hasNarrative = Boolean(client.rejectReason || client.verificationNotes);
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <section className="ss-vf-section">
        <div className="ss-vf-section-head">
          <span>Credit decision</span>
          {client.creditDecision ? (
            <span
              className="ss-vf-verdict"
              style={{ color: TONE_COLOR[creditDecisionTone(client.creditDecision)] }}
            >
              {client.creditDecision}
            </span>
          ) : (
            <span className="ss-vf-verdict is-empty">Not decided yet</span>
          )}
        </div>
        <div className="ss-vf-grid">
          <FactTile
            label="Credit score"
            value={client.creditScore}
            tone={creditScoreTone(client.creditScore)}
            {...(client.creditScore == null ? {} : { hint: 'iSoft pull' })}
          />
          <FactTile label="Credit line approved" value={client.creditLineApproved ? money(client.creditLineApproved) : null} tone="ok" />
          <FactTile label="Credit limit" value={client.creditLimit ? money(client.creditLimit) : null} />
          <FactTile label="Risk score" value={client.riskScore} tone={riskTone(client.riskScore)} />
          <FactTile label="CreditSafe grade" value={client.creditSafeGrade} tone={gradeTone(client.creditSafeGrade)} />
          <FactTile label="Money code limit" value={client.moneyCodeLimit ? money(client.moneyCodeLimit) : null} />
          <FactTile label="Payment type" value={client.paymentTerms} tone="accent" />
          <FactTile label="Billing cycle" value={client.billingCycle} />
        </div>
        <CheckpointRail client={client} />
      </section>

      <section className="ss-vf-section">
        <div className="ss-vf-section-head">
          <span>Application</span>
          {client.applicationId ? <span className="ss-vf-verdict is-mono">#{client.applicationId}</span> : null}
        </div>
        <div className="ss-vf-grid">
          <FactTile label="Deal stage" value={client.dealStage} tone={stageTone(client.dealStage)} />
          <FactTile label="Application stage" value={client.applicationStage} tone="accent" />
          <FactTile
            label="Application status"
            value={client.applicationStatus}
            tone={applicationStatusTone(client.applicationStatus)}
          />
          <FactTile label="Applied" value={client.appFillDate} />
          <FactTile label="Stage updated" value={client.stageUpdatedAt} />
          <FactTile label="Cards requested" value={client.cardsRequested} />
          <FactTile label="Carrier ID" value={client.carrierId} />
          <FactTile label="DOT" value={client.dot} />
          <FactTile label="MC" value={client.mc} />
        </div>
      </section>

      {hasNarrative ? (
        <section className="ss-vf-section">
          <div className="ss-vf-section-head">
            <span>From Verification</span>
          </div>
          {client.rejectReason ? (
            <div className="ss-vf-note is-danger">
              <div className="ss-vf-note-lbl">Reject reason</div>
              <p>{client.rejectReason}</p>
            </div>
          ) : null}
          {client.verificationNotes ? (
            <div className="ss-vf-note">
              <div className="ss-vf-note-lbl">Notes</div>
              <p>{client.verificationNotes}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

// ---- in-page detail (replaces the list; the page scrolls naturally — no modal, no inner scrollbox) ----
function ClientDetailPage({ client, onBack }: { client: VerificationClient; onBack: () => void }) {
  const cls = CLASS_VIS[client.classification];
  return (
    <SalesPage className="ss-verification-page">
      {/* A record title IS allowed to be a page title — it names the thing being inspected, which the
          top bar (still "Verification") cannot. */}
      <SalesPageHead
        title={client.companyName}
        description={
          <>
            {client.dealStage}
            {client.applicationStage ? ` · ${client.applicationStage}` : ''}
            {client.appFillDate ? ` · applied ${client.appFillDate}` : ''}
            {client.carrierId ? ` · carrier #${client.carrierId}` : ''}
          </>
        }
        actions={
          <>
            <span style={s(`${badge(cls.label, cls.color).style};font-size:12px;flex-shrink:0`)}>{cls.label}</span>
            <button type="button" onClick={onBack} className="ss-pager-btn" style={s('display:inline-flex;align-items:center;gap:6px;padding:0 15px 0 11px')}>
              <Icon name="chevronLeft" size={15} strokeWidth={2.4} /> Back to pipeline
            </button>
          </>
        }
      />

      <CrmVerificationRecord client={client} />

      <section className="ss-vf-section">
        <div className="ss-vf-section-head">
          <span>Compliance pipeline</span>
        </div>
        <PipelineTimeline client={client} />
      </section>
    </SalesPage>
  );
}

/** One roster card — company, where the application sits, and the decision so far. */
function VerificationCard({
  client,
  onOpen,
}: {
  client: VerificationClient;
  onOpen: () => void;
}) {
  const cls = CLASS_VIS[client.classification];
  const tone = client.attentionCount ? 'var(--danger)' : cls.color;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="verification-card"
      className="ss-verification-card"
      style={s(`--verification-tone:${tone};border-color:${client.attentionCount ? 'color-mix(in srgb,var(--danger) 48%,var(--border))' : 'var(--border)'}`)}
    >
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:10px')}>
        <div className="ss-verification-card-title">{client.companyName}</div>
        <span style={s(`${badge(cls.label, cls.color).style};flex-shrink:0`)}>{cls.label}</span>
      </div>

      <div className="ss-vf-chips">
        <FactChip label="Stage" value={client.dealStage} tone={stageTone(client.dealStage)} />
        {client.applicationStage ? (
          <FactChip label="App" value={client.applicationStage} tone="accent" />
        ) : null}
        {client.applicationStatus ? (
          <FactChip
            label="Status"
            value={client.applicationStatus}
            tone={applicationStatusTone(client.applicationStatus)}
          />
        ) : null}
      </div>

      {/* The decision line is the reason an agent opens this tab, so it gets its own row rather than
          being one chip among many. */}
      <div className="ss-vf-card-decision">
        {client.creditDecision ? (
          <span style={{ color: TONE_COLOR[creditDecisionTone(client.creditDecision)] }}>
            {client.creditDecision}
          </span>
        ) : (
          <span className="is-empty">Awaiting credit decision</span>
        )}
        {client.creditScore != null ? (
          <em style={{ color: TONE_COLOR[creditScoreTone(client.creditScore)] }}>
            Score {client.creditScore}
          </em>
        ) : null}
        {client.creditLineApproved ? <em>{money(client.creditLineApproved)} line</em> : null}
      </div>

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
  const [selected, setSelected] = useState<VerificationClient | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const load = useCachedLoad<VerificationClientPage>(
    `sales:verification:${actAs}:${page}:${encodeURIComponent(debouncedQuery)}`,
    () => getVerificationClients({
      ...(viewAsUserId ? { zohoUserId: viewAsUserId } : {}),
      page,
      pageSize: PAGE_SIZE,
      query: debouncedQuery,
    }),
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

  if (selected) {
    return <ClientDetailPage client={selected} onBack={() => setSelected(null)} />;
  }

  const emptyMsg = debouncedQuery ? 'No applications match your search.' : 'No verification applications yet.';

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
            placeholder="Search by company, stage, decision, carrier ID or application #…"
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
      </div>

      {/* Degraded-source notice only when there IS data to qualify — with no data the error state
          below already says the page could not load, and printing both read as contradictory. */}
      {showingFallback && load.data ? (
        <div className="ss-source-health" role="status">
          <Icon name="warn" size={16} color="var(--warn)" />
          <span>
            Showing the latest available pipeline data
            {degradedSources.length ? ` while ${degradedSources.join(' and ')} recovers` : ''}.
          </span>
        </div>
      ) : null}

      {/* content */}
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
    </SalesPage>
  );
}
