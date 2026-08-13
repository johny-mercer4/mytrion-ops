/**
 * Verification record + live compliance timeline. Split from the roster tab so the card list and
 * this workspace stay under the file cap and share field presenters in verificationFields.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { s } from './dc';
import { Icon, type IconName } from './icons';
import { badge } from './salesData';
import { useCachedLoad } from './dcCache';
import {
  getPipeline,
  generatePlaidLink,
  downloadVerificationAttachment,
  type VerificationClient,
  type PipelineStage,
  type PipelineStageStatus,
  type PipelineSnapshot,
  type PipelineDecision,
} from '@/api/verification';
import { VerificationActionRequest } from './VerificationActionRequest';
import { EditApplicantPanel, BankStatementUpload, PlaidLinkShare } from './VerificationWriteActions';
import { VerificationDetailSkeleton } from './DataCenterSkeletons';
import { SalesErrorNote } from './SalesPage';
import { DetailSheet } from './dataCenterSheet';
import {
  CheckpointRail,
  CLASSIFICATION_VIS,
  CopyValue,
  creditScoreTone,
  creditVerificationNote,
  ApplicationStatusFacts,
  FactChip,
  FactTile,
  FieldProceedFlag,
  gradeTone,
  money,
  parseAuthorityId,
  pipelineIsApproved,
  applicantFieldFlags,
  deskDecisionLabel,
  platformCreditLabel,
  zohoCreditDisplay,
  riskTone,
  TONE_COLOR,
  VerificationStateLine,
} from './verificationFields';

const FOOT_BTN = 'height:38px;padding:0 18px;border-radius:var(--radius-md);font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:7px';
const GHOST_BTN = `${FOOT_BTN};border:1px solid var(--border);background:var(--alt);color:var(--text)`;

const STAGE_VIS: Record<PipelineStageStatus, { color: string; icon: IconName; label: string }> = {
  done: { color: 'var(--ok)', icon: 'check', label: 'Passed' },
  failed: { color: 'var(--danger)', icon: 'close', label: 'Failed' },
  pending: { color: 'var(--warn)', icon: 'clock', label: 'In progress' },
  skipped: { color: 'var(--muted)', icon: 'ban', label: 'Skipped' },
  not_started: { color: 'var(--muted)', icon: 'clock', label: 'Not started' },
};

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

function PendingPipeline() {
  const vis = STAGE_VIS.not_started;
  return (
    <div className="ss-vf-timeline">
      <div className="ss-vf-intake">
        <div>
          <div className="ss-vf-note-lbl">Compliance pipeline</div>
          <div className="ss-vf-intake-copy">The application is visible to Sales; Verification has not created its live request yet.</div>
        </div>
        <span style={s(`${badge('Awaiting intake', 'var(--warn)').style};font-size:12px;flex-shrink:0`)}>Awaiting intake</span>
      </div>
      <div className="ss-vf-stages">
        {PENDING_STAGES.map((label, index) => {
          const last = index === PENDING_STAGES.length - 1;
          return (
            <div key={label} className="ss-vf-stage is-idle">
              <div className="ss-vf-stage-rail">
                <span className="ss-vf-stage-dot" style={{ background: `color-mix(in srgb,${vis.color} 16%,transparent)`, color: vis.color }}>
                  <Icon name={vis.icon} size={12} strokeWidth={2.6} />
                </span>
                {!last && <span className="ss-vf-stage-line" />}
              </div>
              <div className="ss-vf-stage-body">
                <div className="ss-vf-stage-head">
                  <span className="ss-vf-stage-n">{index + 1}</span>
                  <span className="ss-vf-stage-label">{label}</span>
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

function prePlaidPassed(stages: PipelineStage[]): boolean {
  return ['stop-factor-pre', 'blacklist', 'fmcsa'].every((id) => {
    const st = stages.find((row) => row.id === id);
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
    <div className="ss-vf-plaid">
      <div className="ss-vf-note-lbl">Plaid link</div>
      {children}
      {error || actionError ? <div className="ss-vf-plaid-err">{error || `Failed: ${actionError}`}</div> : null}
    </div>
  );

  if (passed) {
    return shell(<div className="ss-vf-plaid-ok"><Icon name="check" size={14} /> Plaid passed — bank data verified.</div>);
  }
  if (analyzing) {
    return shell(<div className="ss-vf-plaid-copy"><Icon name="clock" size={14} /> Bank connected — analyzing…</div>);
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
    <button type="button" onClick={() => run(regenerate)} disabled={busy || !snapshot.requestId || !dealId} className="ss-vf-plaid-btn">
      {busy ? generating : <><Icon name="link" size={14} /> {label}</>}
    </button>
  );

  if (waiting && linkUrl) {
    return shell(<><PlaidLinkShare url={linkUrl} />{btn(true, 'Generate new link')}</>);
  }
  if (dead) {
    return shell(<><div className="ss-vf-plaid-copy">The Plaid link has expired. Generate a fresh one for the applicant.</div>{btn(true, 'Generate new link')}</>);
  }
  return shell(<><div className="ss-vf-plaid-copy">All pre-Plaid checks passed. Generate a Plaid link for the applicant to connect their bank.</div>{btn(false, 'Generate Plaid link')}</>);
}

function PipelineTimeline({
  client,
  snapshot,
  onReload,
}: {
  client: VerificationClient;
  snapshot: PipelineSnapshot | null;
  onReload: () => void;
}) {
  if (!snapshot) return <PendingPipeline />;

  const { stages, requirements, attachments } = snapshot;
  const shownStages = stages.filter((st) => st.used !== false);
  const openRequirements = requirements.filter((item) => !item.response).length;

  return (
    <div className="ss-vf-timeline">
      <div className="ss-vf-live-head">
        <div>
          <div className="ss-vf-note-lbl">Live verification</div>
          <div className="ss-vf-live-id">Request {snapshot.requestId}</div>
        </div>
        <div className="ss-vf-live-badges">
          {openRequirements ? (
            <span style={s(`${badge(`${openRequirements} action required`, 'var(--danger)').style};font-size:12px`)}>
              <Icon name="warn" size={12} /> {openRequirements} action required
            </span>
          ) : null}
          <span style={s(`${badge(snapshot.status, 'var(--accent)').style};font-size:12px`)}>{snapshot.status}</span>
        </div>
      </div>

      {requirements.length ? (
        <div className="ss-vf-reqs">
          {requirements.map((requirement) => (
            <VerificationActionRequest
              key={requirement.id}
              requestId={snapshot.requestId}
              dealId={client.dealId}
              requirement={requirement}
              onSent={onReload}
            />
          ))}
        </div>
      ) : null}

      <div className="ss-vf-stages">{shownStages.map((st, i) => {
        const vis = STAGE_VIS[st.status];
        const last = i === shownStages.length - 1;
        const idle = st.status === 'skipped' || st.status === 'not_started';
        return (
          <div key={st.id} className={`ss-vf-stage${idle ? ' is-idle' : ''}`}>
            <div className="ss-vf-stage-rail">
              <span className="ss-vf-stage-dot" style={{ background: `color-mix(in srgb,${vis.color} 16%,transparent)`, color: vis.color }}>
                <Icon name={vis.icon} size={12} strokeWidth={2.6} />
              </span>
              {!last && <span className="ss-vf-stage-line" />}
            </div>
            <div className="ss-vf-stage-body">
              <div className="ss-vf-stage-head">
                <span className="ss-vf-stage-n">{st.order}</span>
                <span className="ss-vf-stage-label">{st.label}</span>
                <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
              </div>
              {st.stoppedBy ? (
                <div className="ss-vf-stage-stop">Stopped: {st.stoppedBy}</div>
              ) : st.detail && !st.related?.length ? (
                <div className="ss-vf-stage-detail">{st.detail}</div>
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

      <PlaidLinkAction snapshot={snapshot} dealId={client.dealId} onChanged={onReload} />
      {shownStages.some((st) => st.id === 'plaid') ? (
        <BankStatementUpload requestId={snapshot.requestId} dealId={client.dealId} onUploaded={onReload} />
      ) : null}

      {attachments.length ? (
        <div className="ss-vf-files">
          <div className="ss-vf-note-lbl">Uploaded files</div>
          <div className="ss-vf-file-list">
            {attachments.map((file) => (
              <div key={file.id} className="ss-vf-file">
                <Icon name="file" size={14} />
                <span className="ss-vf-file-name">{file.fileName}</span>
                <span className={`ss-vf-file-scope${file.scope === 'sales_bank_statement' ? ' is-sales' : ''}`}>
                  {file.scope === 'sales_bank_statement' ? 'Sales' : file.scope === 'analyst_note' ? 'Analyst' : 'File'}
                </span>
                <span className="ss-vf-file-size">{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
                <button
                  type="button"
                  onClick={() => { void downloadVerificationAttachment(file.id, file.fileName); }}
                  className="ss-vf-file-dl"
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

function initialsOf(name: string): string {
  return name.split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function ApprovedResult({
  client,
  snapshot,
}: {
  client: VerificationClient;
  snapshot: PipelineSnapshot | null;
}) {
  const desk = snapshot ? deskDecisionLabel(snapshot.decision) : platformCreditLabel(client, null);
  return (
    <div className="ss-vf-approved" data-testid="vf-approved-result">
      <div className="ss-vf-approved-head">
        <span className="ss-vf-approved-icon" aria-hidden>
          <Icon name="check" size={18} strokeWidth={2.6} />
        </span>
        <div>
          <div className="ss-vf-note-lbl">Verification result</div>
          <div className="ss-vf-approved-val" style={{ color: TONE_COLOR[desk.tone] }}>{desk.text}</div>
        </div>
      </div>
      {client.cpLimit != null || client.cpPaymentType || client.cpBillingCycle ? (
        <div className="ss-vf-chips">
          {client.cpLimit != null ? <FactChip label="Limit" value={money(client.cpLimit)} tone="ok" /> : null}
          {client.cpPaymentType ? <FactChip label="Type" value={client.cpPaymentType} /> : null}
          {client.cpBillingCycle ? <FactChip label="Cycle" value={client.cpBillingCycle} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function AuthorityTile({
  label,
  raw,
  proceedFlag,
}: {
  label: string;
  raw: string | null | undefined;
  proceedFlag?: string;
}) {
  const parsed = parseAuthorityId(raw);
  const flag = parsed.flag ?? proceedFlag ?? null;
  if (!parsed.value && !flag) return null;
  return (
    <div className={`ss-vf-tile${flag ? ' is-flagged' : ''}`}>
      <div className="ss-vf-tile-lbl">{label}</div>
      {parsed.value ? <div className="ss-vf-tile-val is-id">{parsed.value}</div> : null}
      {flag ? <FieldProceedFlag id={`vf-record-${label.toLowerCase()}`} text={flag} /> : null}
    </div>
  );
}

function CrmVerificationRecord({
  client,
  decision,
  fieldFlags,
}: {
  client: VerificationClient;
  decision: PipelineDecision | null;
  fieldFlags?: { mcNumber?: string; dotNumber?: string };
}) {
  const credit = zohoCreditDisplay(client.creditDecision);
  const desk = decision ? deskDecisionLabel(decision) : null;
  const note = creditVerificationNote(client);
  const reason = decision && decision.outcome !== 'undecided' ? decision.reason : null;
  return (
    <div className="ss-vf-sheet-body">
      <div className="ss-vf-credit-hero">
        <div className="ss-vf-tile-lbl">Credit Decision</div>
        <div
          className={`ss-vf-credit-hero-val${credit.empty ? ' is-empty' : ''}`}
          data-testid="vf-credit-decision"
          style={{ color: TONE_COLOR[credit.tone] }}
        >
          {credit.text}
        </div>
        {desk ? (
          <div className="ss-vf-desk" data-testid="vf-desk-decision">
            <span className="ss-vf-desk-lbl">Verification desk</span>
            <span className="ss-vf-desk-val" style={{ color: TONE_COLOR[desk.tone] }}>{desk.text}</span>
            {reason ? <span className="ss-vf-desk-reason">{reason}</span> : null}
          </div>
        ) : null}
        {note ? <div className="ss-vf-explain" data-testid="vf-credit-note">{note}</div> : null}
      </div>

      <ApplicationStatusFacts client={client} includeCredit={false} />

      <div className="ss-vf-sheet-grid">
        <FactTile
          label="Applied"
          value={client.appFillDate ? <CopyValue text={client.appFillDate}>{client.appFillDate}</CopyValue> : null}
        />
        <FactTile label="Stage updated" value={client.stageUpdatedAt} />
        <FactTile label="Cards requested" value={client.cardsRequested} />
        <FactTile label="Carrier ID" value={client.carrierId} kind="id" />
        <FactTile
          label="Application"
          value={client.applicationId ? <CopyValue text={String(client.applicationId)}>#{client.applicationId}</CopyValue> : null}
          kind="id"
        />
        <AuthorityTile label="DOT" raw={client.dot} {...(fieldFlags?.dotNumber ? { proceedFlag: fieldFlags.dotNumber } : {})} />
        <AuthorityTile label="MC" raw={client.mc} {...(fieldFlags?.mcNumber ? { proceedFlag: fieldFlags.mcNumber } : {})} />
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

      {client.verificationNotes ? (
        <div className="ss-vf-note">
          <div className="ss-vf-note-lbl">From Verification</div>
          <p>{client.verificationNotes}</p>
        </div>
      ) : null}
      <CheckpointRail client={client} />
    </div>
  );
}

export function ClientDetailPage({ client, onBack }: { client: VerificationClient; onBack: () => void }) {
  const cls = CLASSIFICATION_VIS[client.classification];
  const pipe = useCachedLoad(
    `sales:verification:detail:${client.dealId ?? ''}:${client.carrierId ?? ''}:${client.applicationId ?? ''}`,
    () => getPipeline({
      dealId: client.dealId,
      carrierId: client.carrierId,
      applicationId: client.applicationId,
      dot: parseAuthorityId(client.dot).value || null,
    }),
    { staleMs: 90_000 },
  );
  const snapshot = pipe.data ?? null;
  const approved = pipelineIsApproved(snapshot, client.verificationState);
  const subtitle = [
    client.dealStage,
    client.appFillDate ? `Applied ${client.appFillDate}` : null,
  ].filter(Boolean).join(' · ');
  const pipeLoading = pipe.loading && !pipe.data;

  return (
    <DetailSheet
      accent="var(--accent)"
      title={client.companyName}
      subtitle={subtitle}
      avatar={<div className="ss-vf-avatar">{initialsOf(client.companyName)}</div>}
      badges={
        <div className="ss-vf-header-actions">
          <span style={s(`${badge(cls.label, cls.color).style};font-size:12px;flex-shrink:0`)}>{cls.label}</span>
          {snapshot?.requestId ? (
            <EditApplicantPanel
              requestId={snapshot.requestId}
              dealId={client.dealId}
              initial={snapshot.applicant}
              fieldFlags={applicantFieldFlags(snapshot)}
            />
          ) : null}
        </div>
      }
      onClose={onBack}
      maxWidth={820}
      ariaLabel={`Verification ${client.companyName}`}
      footer={
        <div className="ss-vf-sheet-foot">
          <button type="button" onClick={onBack} style={s(GHOST_BTN)}>Close</button>
        </div>
      }
    >
      <CrmVerificationRecord
        client={client}
        decision={snapshot?.decision ?? null}
        fieldFlags={applicantFieldFlags(snapshot)}
      />
      {pipeLoading && !approved ? (
        <VerificationDetailSkeleton />
      ) : pipe.error && !pipe.data && !approved ? (
        <SalesErrorNote>{pipe.error}</SalesErrorNote>
      ) : approved ? (
        <ApprovedResult client={client} snapshot={snapshot} />
      ) : (
        <div className="ss-vf-pipeline-block">
          {client.workingOn ? <span className="ss-vf-verdict">Verificator: {client.workingOn}</span> : null}
          <VerificationStateLine state={client.verificationState} />
          <PipelineTimeline client={client} snapshot={snapshot} onReload={pipe.reload} />
        </div>
      )}
    </DetailSheet>
  );
}
