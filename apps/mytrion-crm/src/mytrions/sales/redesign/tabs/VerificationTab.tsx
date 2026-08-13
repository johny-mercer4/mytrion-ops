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
import { useEffect, useState, type ReactNode } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge, NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { getImpersonation } from '@/api/impersonation';
import { copyToClipboard } from '@/mytrions/admin/carrierUserUtil';
import {
  getVerificationClients,
  getPipeline,
  generatePlaidLink,
  downloadVerificationAttachment,
  type VerificationClient,
  type VerificationClientPage,
  type VerificationStateFilter,
  type PipelineStage,
  type PipelineStageStatus,
  type PipelineSnapshot,
  type PipelineDecision,
} from '@/api/verification';
import { VerificationActionRequest } from '../VerificationActionRequest';
import { EditApplicantPanel, BankStatementUpload, PlaidLinkShare } from '../VerificationWriteActions';
import { VerificationDetailSkeleton } from '../DataCenterSkeletons';
import { SalesEmpty, SalesErrorNote, SalesPage, SalesPageHead, SalesPager } from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import {
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
  wexStatusBucket,
} from '../verificationFields';

const STAGE_VIS: Record<PipelineStageStatus, { color: string; icon: IconName; label: string }> = {
  done: { color: 'var(--ok)', icon: 'check', label: 'Passed' },
  failed: { color: 'var(--danger)', icon: 'close', label: 'Failed' },
  pending: { color: 'var(--warn)', icon: 'clock', label: 'In progress' },
  skipped: { color: 'var(--muted)', icon: 'ban', label: 'Skipped' },
  not_started: { color: 'var(--muted)', icon: 'clock', label: 'Not started' },
};

const CLASS_VIS: Record<VerificationClient['classification'], { label: string; color: string }> = {
  in_pipeline: { label: 'In Pipeline', color: 'var(--accent)' },
  active: { label: 'Active', color: 'var(--ok)' },
  closed: { label: 'Closed', color: 'var(--muted)' },
};

const CP_STATE: Record<'queued' | 'in_progress' | 'approved' | 'rejected', { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  queued: { label: 'Queued', tone: 'warn' },
  in_progress: { label: 'In progress', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

function decisionBadge(d: PipelineDecision): { text: string; color: string } {
  switch (d.outcome) {
    case 'loc':
      return { text: 'LOC Approved', color: 'var(--ok)' };
    case 'prepaid':
      return { text: 'Prepaid', color: 'var(--accent)' };
    case 'rejected':
      return /^\s*prepay/i.test(d.reason ?? '')
        ? { text: 'Prepay', color: 'var(--warn)' }
        : { text: 'Not Accepted', color: 'var(--danger)' };
    default:
      return { text: 'Undecided', color: 'var(--warn)' };
  }
}

function CopyValue({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const run = () => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={className}
      title="Click to copy"
      onClick={(e) => { e.stopPropagation(); run(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); run(); } }}
      style={{ cursor: 'pointer' }}
    >
      {copied ? '✓ Copied' : children}
    </span>
  );
}

const PAGE_SIZE = 9;
const STATE_FILTERS: ReadonlyArray<{ id: VerificationStateFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected (prepay)' },
];
const PENDING_STAGES = [
  'Pre Stop Factors',
  'Black List Match',
  'FMCSA',
  'Plaid / Bank Statement',
  'Highway',
  'CreditSafe',
  'iSoft Pull — Credit Score',
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
                  <span style={s('font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{index + 1}</span>
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

const PLAID_WAITING = new Set(['CREATED', 'CLICKED']);
const PLAID_ANALYZING = new Set(['COMPLETED', 'REPORT_REQUESTED', 'REPORT_READY']);
const PLAID_DEAD = new Set(['EXPIRED', 'FAILED']);
const PLAID_BTN = 'height:36px;padding:0 15px;border:0;border-radius:9px;background:var(--accent-strong);color:var(--on-accent);font-size:13px;font-weight:800;display:inline-flex;align-items:center;gap:7px;align-self:flex-start';

function prePlaidPassed(stages: PipelineStage[]): boolean {
  return ['stop-factor-pre', 'blacklist', 'fmcsa'].every((id) => {
    const st = stages.find((s) => s.id === id);
    return !!st && (st.status === 'done' || st.status === 'skipped');
  });
}

function PlaidLinkAction({ snapshot, dealId, onChanged }: { snapshot: PipelineSnapshot; dealId: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plaid = snapshot.plaid;
  const status = String(plaid?.status ?? '').toLowerCase();
  const linkState = String(plaid?.linkState ?? '').toUpperCase();
  const linkUrl = plaid?.linkUrl || null;
  const actionError = String(plaid?.lastActionStatus ?? '').toLowerCase() === 'error' ? (plaid?.lastActionError || 'Generation failed.') : null;
  const plaidStage = snapshot.stages.find((st) => st.id === 'plaid');
  const passed = plaidStage?.status === 'done';
  const dead = !passed && (PLAID_DEAD.has(linkState) || status === 'expired' || status === 'failed');
  const analyzing = !passed && !dead && (status === 'verified' || (status === 'pending' && PLAID_ANALYZING.has(linkState)));
  const waiting = !passed && !dead && !analyzing && !!linkUrl && (PLAID_WAITING.has(linkState) || status === 'pending');

  useEffect(() => {
    if (busy && (linkUrl || status === 'pending' || passed || dead || actionError)) setBusy(false);
  }, [busy, linkUrl, status, passed, dead, actionError]);

  if (!prePlaidPassed(snapshot.stages)) return null;

  const shell = (children: ReactNode) => (
    <div style={s('padding:14px 16px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt);display:flex;flex-direction:column;gap:10px')}>
      <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Plaid link</div>
      {children}
      {error || actionError ? <div style={s('font-size:12px;color:var(--danger);font-weight:600')}>{error || `Failed: ${actionError}`}</div> : null}
    </div>
  );

  if (passed) {
    return shell(<div style={s('font-size:13px;color:var(--ok);font-weight:700;display:flex;align-items:center;gap:6px')}><Icon name="check" size={14} /> Plaid passed — bank data verified.</div>);
  }
  if (analyzing) {
    return shell(<div style={s('font-size:13px;color:var(--text2);display:flex;align-items:center;gap:6px')}><Icon name="clock" size={14} /> Bank connected — analyzing…</div>);
  }

  const run = (regenerate: boolean) => {
    if (!snapshot.requestId || !dealId || busy) return;
    setError(null);
    setBusy(true);
    generatePlaidLink({ requestId: snapshot.requestId, dealId, regenerate })
      .then(() => {
        let n = 0;
        const tick = () => { n += 1; onChanged(); if (n < 8) window.setTimeout(tick, 2500); else setBusy(false); };
        window.setTimeout(tick, 2500);
      })
      .catch((e) => { setBusy(false); setError(e instanceof Error ? e.message : 'Could not queue the Plaid link.'); });
  };

  const generating = <><Icon name="spinner" size={14} /> Generating…</>;
  const btn = (regenerate: boolean, label: string) => (
    <button type="button" onClick={() => run(regenerate)} disabled={busy || !snapshot.requestId || !dealId}
      style={s(`${PLAID_BTN};opacity:${busy || !snapshot.requestId || !dealId ? '.6' : '1'};cursor:${busy ? 'wait' : (!snapshot.requestId || !dealId) ? 'not-allowed' : 'pointer'}`)}>
      {busy ? generating : <><Icon name="link" size={14} /> {label}</>}
    </button>
  );

  if (waiting && linkUrl) {
    return shell(<><PlaidLinkShare url={linkUrl} />{btn(true, 'Generate new link')}</>);
  }
  if (dead) {
    return shell(<><div style={s('font-size:13px;color:var(--warn)')}>The Plaid link has expired. Generate a fresh one for the applicant.</div>{btn(true, 'Generate new link')}</>);
  }
  return shell(<><div style={s('font-size:13px;color:var(--text2)')}>All pre-Plaid checks passed. Generate a Plaid link for the applicant to connect their bank.</div>{btn(false, 'Generate Plaid link')}</>);
}

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

  const { stages, requirements, attachments } = pipe.data;
  const shownStages = stages.filter((st) => st.used !== false);
  const openRequirements = requirements.filter((item) => !item.response).length;

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800')}>Live verification</div>
          <div style={s("font-family:var(--font-mono);font-size:13px;color:var(--text2);margin-top:4px")}>Request {pipe.data.requestId}</div>
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

      <div style={s('display:flex;flex-direction:column;gap:2px')}>{shownStages.map((st, i) => {
        const vis = STAGE_VIS[st.status];
        const last = i === shownStages.length - 1;
        return (
          <div key={st.id} style={s('display:flex;gap:12px')}>
            <div style={s('display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0')}>
              <span style={s(`width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${vis.color} 16%,transparent);color:${vis.color};flex-shrink:0`)}>
                <Icon name={vis.icon} size={12} strokeWidth={2.6} />
              </span>
              {!last && <span style={s('flex:1;width:2px;min-height:14px;background:var(--border2)')} />}
            </div>
            <div style={s('flex:1;min-width:0;padding-bottom:14px')}>
              <div style={s('display:flex;align-items:center;gap:8px')}>
                <span style={s('font-size:12px;color:var(--muted);font-family:var(--font-mono)')}>{st.order}</span>
                <span style={s('font-size:14px;font-weight:700')}>{st.label}</span>
                <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
              </div>
              {st.stoppedBy ? (
                <div style={s('font-size:12px;color:var(--danger);font-weight:600;margin-top:3px')}>⛔ {st.stoppedBy}</div>
              ) : st.detail && !st.related?.length ? (
                <div style={s('font-size:12px;color:var(--text2);margin-top:3px')}>{st.detail}</div>
              ) : null}
              {st.related?.length ? (
                <div className="ss-vf-stage-facts">
                  {st.related.map((f) => (
                    <span key={f.label} className="ss-vf-stage-fact">
                      <b>{f.label}</b> {f.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}</div>

      <PlaidLinkAction snapshot={pipe.data} dealId={client.dealId} onChanged={pipe.reload} />
      {shownStages.some((st) => st.id === 'plaid') ? (
        <BankStatementUpload requestId={pipe.data.requestId} dealId={client.dealId} onUploaded={pipe.reload} />
      ) : null}

      {attachments.length ? (
        <div style={s('padding:14px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
          <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Uploaded files</div>
          <div style={s('display:flex;flex-direction:column;gap:6px;margin-top:10px')}>
            {attachments.map((file) => (
              <div key={file.id} style={s('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);padding:6px 8px;border:1px solid var(--border2);border-radius:8px;background:var(--surface)')}>
                <Icon name="file" size={14} />
                <span style={s('min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.fileName}</span>
                <span style={s(`font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap;background:${file.scope === 'sales_bank_statement' ? 'color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)' : 'var(--alt);color:var(--muted)'}`)}>
                  {file.scope === 'sales_bank_statement' ? 'Sales' : file.scope === 'analyst_note' ? 'Analyst' : 'File'}
                </span>
                <span style={s('color:var(--muted);white-space:nowrap')}>{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
                <button
                  type="button"
                  onClick={() => { void downloadVerificationAttachment(file.id, file.fileName); }}
                  style={s('margin-left:auto;height:28px;padding:0 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0')}
                >
                  <Icon name="download" size={13} /> Download
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The Zoho-sourced verification record: decision, checkpoints, application facts, narrative. */
function CrmVerificationRecord({ client, decision }: { client: VerificationClient; decision: PipelineDecision | null }) {
  const isRejected = client.verificationState === 'rejected';
  const platformBadge = decision ? decisionBadge(decision) : null;
  const creditDecisionText =
    platformBadge?.text ||
    client.creditDecision ||
    (isRejected ? 'Rejected' : client.verificationState === 'approved' ? 'Approved' : null);
  const creditDecisionColor =
    platformBadge?.color ||
    (creditDecisionText ? TONE_COLOR[creditDecisionTone(creditDecisionText)] : undefined);
  const platformReason = decision && decision.outcome === 'rejected' ? decision.reason : null;
  const wexStatus = wexStatusBucket(client.applicationStatus);
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <section className="ss-vf-section">
        <div className="ss-vf-section-head">
          <span>Credit decision</span>
          {creditDecisionText ? (
            <span className="ss-vf-verdict" style={{ color: creditDecisionColor }}>
              {creditDecisionText}
            </span>
          ) : (
            <span className="ss-vf-verdict is-empty">Not decided yet</span>
          )}
        </div>
        {platformReason ? (
          <div style={s('margin-top:8px')}>
            <div className="ss-vf-note-lbl">Requirements / notes</div>
            <p style={s('font-size:13px;color:var(--text2);margin:0;white-space:pre-line')}>{platformReason}</p>
          </div>
        ) : null}
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
          {client.applicationId ? (
            <CopyValue text={String(client.applicationId)} className="ss-vf-verdict is-mono">#{client.applicationId}</CopyValue>
          ) : null}
        </div>
        <div className="ss-vf-grid">
          <FactTile label="Deal Pipeline" value={client.dealStage} tone={stageTone(client.dealStage)} />
          <FactTile label="WEX Status" value={wexStatus?.label ?? null} tone={wexStatus?.tone ?? 'muted'} />
          <FactTile
            label="Applied"
            value={client.appFillDate ? <CopyValue text={client.appFillDate}>{client.appFillDate}</CopyValue> : null}
          />
          <FactTile label="Stage updated" value={client.stageUpdatedAt} />
          <FactTile label="Cards requested" value={client.cardsRequested} />
          <FactTile label="Carrier ID" value={client.carrierId} />
          <FactTile label="DOT" value={client.dot} />
          <FactTile label="MC" value={client.mc} />
        </div>
      </section>

      {client.verificationNotes ? (
        <section className="ss-vf-section">
          <div className="ss-vf-section-head">
            <span>From Verification</span>
          </div>
          <div className="ss-vf-note">
            <div className="ss-vf-note-lbl">Notes</div>
            <p>{client.verificationNotes}</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ClientDetailPage({ client, onBack }: { client: VerificationClient; onBack: () => void }) {
  const cls = CLASS_VIS[client.classification];
  const pipe = useCachedLoad(
    `sales:verification:detail:${client.dealId ?? ''}:${client.carrierId ?? ''}:${client.applicationId ?? ''}`,
    () => getPipeline({ dealId: client.dealId, carrierId: client.carrierId, applicationId: client.applicationId, dot: client.dot }),
    { staleMs: 90_000 },
  );
  return (
    <SalesPage className="ss-verification-page">
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
            {pipe.data?.requestId ? (
              <EditApplicantPanel requestId={pipe.data.requestId} dealId={client.dealId} initial={pipe.data.applicant} />
            ) : null}
            <button type="button" onClick={onBack} className="ss-pager-btn" style={s('display:inline-flex;align-items:center;gap:6px;padding:0 15px 0 11px')}>
              <Icon name="chevronLeft" size={15} strokeWidth={2.4} /> Back to pipeline
            </button>
          </>
        }
      />

      <CrmVerificationRecord client={client} decision={pipe.data?.decision ?? null} />

      <section className="ss-vf-section">
        <div className="ss-vf-section-head">
          <span>Compliance pipeline</span>
          {client.workingOn ? <span className="ss-vf-verdict">Verificator: {client.workingOn}</span> : null}
        </div>
        <PipelineTimeline client={client} />
      </section>
    </SalesPage>
  );
}

/** One roster card — company, where the application sits, and the verification state so far. */
function VerificationCard({
  client,
  onOpen,
}: {
  client: VerificationClient;
  onOpen: () => void;
}) {
  const cls = CLASS_VIS[client.classification];
  const tone = client.attentionCount ? 'var(--danger)' : cls.color;
  const wexStatus = wexStatusBucket(client.applicationStatus);
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
        <FactChip label="Deal Pipeline" value={client.dealStage} tone={stageTone(client.dealStage)} />
        {wexStatus ? (
          <FactChip label="WEX Status" value={wexStatus.label} tone={wexStatus.tone} />
        ) : null}
        {client.creditDecision ? (
          <FactChip label="Credit decision" value={client.creditDecision} tone={creditDecisionTone(client.creditDecision)} />
        ) : null}
      </div>

      <div className="ss-vf-cp">
        <div
          className="ss-vf-cp-state"
          style={{ color: client.verificationState ? TONE_COLOR[CP_STATE[client.verificationState].tone] : 'var(--faint)' }}
        >
          <Icon
            name={client.verificationState === 'rejected' ? 'close' : client.verificationState === 'approved' ? 'check' : 'clock'}
            size={14}
            strokeWidth={2.6}
          />
          Verification: {client.verificationState ? CP_STATE[client.verificationState].label : 'Not in verification'}
        </div>
        {client.verificationState === 'approved' && (client.cpLimit != null || client.cpPaymentType || client.cpBillingCycle) ? (
          <div className="ss-vf-chips">
            {client.cpLimit != null ? <FactChip label="Limit" value={money(client.cpLimit)} tone="ok" /> : null}
            {client.cpPaymentType ? <FactChip label="Type" value={client.cpPaymentType} /> : null}
            {client.cpBillingCycle ? <FactChip label="Cycle" value={client.cpBillingCycle} /> : null}
          </div>
        ) : null}
        {client.verificationState === 'in_progress' ? (
          <>
            {client.missingFields.length ? (
              <div className="ss-vf-card-missing">
                <Icon name="warn" size={13} /> Missing: {client.missingFields.slice(0, 4).join(', ')}
                {client.missingFields.length > 4 ? '…' : ''}
              </div>
            ) : null}
            {client.plaidLinkUrl || client.docsUploaded > 0 ? (
              <div className="ss-vf-chips">
                {client.plaidLinkUrl ? <FactChip label="Plaid" value="Link ready" tone="accent" icon="link" /> : null}
                {client.docsUploaded > 0 ? <FactChip label="Docs" value={String(client.docsUploaded)} tone="accent" icon="doc" /> : null}
              </div>
            ) : null}
          </>
        ) : null}
        {client.workingOn ? (
          <div className="ss-vf-card-verificator">
            <Icon name="user" size={14} /> Verificator: {client.workingOn}
          </div>
        ) : null}
      </div>

      {client.attentionCount ? (
        <div className="ss-vf-card-attention">
          <Icon name="warn" size={14} /> {client.attentionCount} Verification action
          {client.attentionCount === 1 ? '' : 's'} required
        </div>
      ) : null}

      <div className="ss-vf-card-foot">
        <span>
          {client.appFillDate ? (
            <>Applied <CopyValue text={client.appFillDate}>{client.appFillDate}</CopyValue></>
          ) : (
            'No application date'
          )}
        </span>
        {client.applicationId ? (
          <CopyValue text={String(client.applicationId)} className="is-mono">#{client.applicationId}</CopyValue>
        ) : null}
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
    </SalesPage>
  );
}
