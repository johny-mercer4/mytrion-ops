/**
 * The applicant case — breadcrumb, identity, the ten-phase spine, and one phase at a time.
 *
 * SHAPE FROM THE DESIGN, BODIES FROM THE PRODUCT. The chrome here is the new design exactly: the
 * breadcrumb bar, the mono identity tile and fact strip, the locked banner, the horizontal spine
 * with its progress line, and the phase section split into a working pane and an aside. What the
 * design could not specify is the INSIDE of that working pane for the six phases that carry real
 * forms — screening verdicts, the credit and banking reviews, hard stops, the risk assessment and
 * the final decision are the desk's actual write surface, and the mock had two sample cases and
 * four generic pane variants. Those panes (`../flow/*`) keep their behaviour and are rendered into
 * the design's slot; the design's own variants cover intake, the recorded-so-far summary and the
 * not-applicable state.
 *
 * A RED case (intake incomplete) is readable but not decidable: every pane renders, the decision
 * bar does not. The desk must see what it is waiting on without being able to sign it off.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Icon,
  Skeleton,
  SkeletonRegion,
  type BadgeIntent,
  type IconName,
} from '@/ds';
import { initials as personInitials } from '@/lib/initials';
import {
  decidePhase,
  getDeskCase,
  getPolicy,
  patchDeskIntake,
  requestDocuments,
  uploadDeskDocuments,
  type VerificationDeskDetail,
  type VerificationPhaseOutcome,
  type VerificationRailPhase,
} from '@/api/verificationFlow';
import { useCachedLoad } from '../../_shared/swrCache';
import '../flow/verificationFlow.css';
import { CaseAside } from './CaseAside';
import { AuthorityFallbackPane } from './CaseAuthorityPane';
import { SkippedPane } from './CasePanes';
import type { CaseActionKey } from './caseActions';
import {
  allIdentityOk,
  caseMovedPastPhase,
  identityChecksFor,
  missingIdentityDocs,
  showPhaseDecideActions,
  type IdentityMark,
} from './caseIdentity';
import {
  EMPTY_SCREENING_MARKS,
  screeningCanPass,
  screeningDeclineOutcome,
  type ScreeningMarks,
} from './caseScreening';
import {
  EMPTY_AUTHORITY_MARKS,
  authorityCanPass,
  missingAuthorityDocs,
  type AuthorityMarks,
} from './caseAuthority';
import {
  EMPTY_CREDIT_BANKING,
  creditBankingCanPass,
  missingBankingDocs,
  type CreditBankingMarks,
} from './caseCreditBanking';
import { CaseDecideBar } from './CaseDecideBar';
import { deskReviewOrder } from './caseRouting';
import { PhaseBody } from './PhaseBody';
import { PhaseSpine } from './PhaseSpine';
import { useVerificationCaseLive } from './useVerificationCaseLive';
import {
  APPLICANT_LABEL,
  caseInitials,
  caseName,
  PHASE_STATE_LABEL,
  routeLabel,
  routeOf,
  salesOwnerLabel,
  salesOwnerName,
  STATUS_LABEL,
  verificationOwnerName,
} from './applicantsModel';
import './applicants.css';
import './applicantsCase.css';

/** Phase state → chip treatment. Each intent carries a glyph, so tone is never colour alone. */
const STATE_CHIP: Record<string, { intent: BadgeIntent; icon: IconName }> = {
  passed: { intent: 'success', icon: 'check_circle' },
  in_progress: { intent: 'info', icon: 'bolt' },
  not_started: { intent: 'neutral', icon: 'schedule' },
  pending_docs: { intent: 'warning', icon: 'cloud_upload' },
  manager_review: { intent: 'warning', icon: 'gavel' },
  failed: { intent: 'danger', icon: 'block' },
  skipped: { intent: 'neutral', icon: 'block' },
};

function statusChipFor(statusCode: string, locked: boolean): { intent: BadgeIntent; icon: IconName } {
  if (locked) return { intent: 'danger', icon: 'lock' };
  if (statusCode.startsWith('declined')) return { intent: 'danger', icon: 'block' };
  if (statusCode === 'approved' || statusCode === 'deposit_prepaid') {
    return { intent: 'success', icon: 'check_circle' };
  }
  if (statusCode === 'manager_review' || statusCode === 'additional_verification') {
    return { intent: 'warning', icon: 'gavel' };
  }
  if (statusCode === 'pending_docs') return { intent: 'warning', icon: 'cloud_upload' };
  return { intent: 'info', icon: 'bolt' };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function moneyOrNull(value: unknown): string | null {
  const raw = text(value);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

export function CaseView({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<VerificationDeskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * WHICH action is in flight, not merely THAT one is.
   *
   * A single boolean put every control on the case into its loading state at once: attaching one
   * file spun Pass phase, Send to manager, Decline, Save corrections and the request button
   * together — five spinners for one request, which reads as a hung screen rather than a busy
   * button. `pending` names the action, so exactly one region reports.
   */
  const [pending, setPending] = useState<CaseActionKey | null>(null);
  /**
   * The failure, WITH the action that produced it. A 415 from the aside's Attach control belongs
   * beside that control; a refused decision belongs on the decision bar. One error, rendered where
   * the click was.
   */
  const [error, setError] = useState<{ scope: CaseActionKey; message: string } | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [identityMarks, setIdentityMarks] = useState<Record<string, IdentityMark>>({});
  const [screeningMarks, setScreeningMarks] = useState<ScreeningMarks>(EMPTY_SCREENING_MARKS);
  const [authorityMarks, setAuthorityMarks] = useState<AuthorityMarks>(EMPTY_AUTHORITY_MARKS);
  const [creditBankingMarks, setCreditBankingMarks] = useState<CreditBankingMarks>(EMPTY_CREDIT_BANKING);

  // Same cache key the queue warms, so the NSF threshold is already in hand on arrival.
  const loadPolicy = useCallback(() => getPolicy(), []);
  const policy = useCachedLoad('verification:flow:policy', loadPolicy, { staleMs: 60 * 60_000 });
  const wexCardCutoff = policy.data?.wexCardCutoff ?? null;

  const adopt = useCallback((next: VerificationDeskDetail) => {
    setDetail(next);
    // Follow the case forward when it advances, but never yank the reviewer off a pane they chose.
    setActiveCode((current) => current ?? next.case.phaseCode);
    setError(null);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getDeskCase(caseId)
      .then((d) => live && adopt(d))
      .catch(
        (e: unknown) =>
          live &&
          setError({
            scope: 'load',
            message: e instanceof Error ? e.message : 'Could not load the case.',
          }),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [caseId, adopt]);

  useEffect(() => {
    setIdentityMarks({});
    setScreeningMarks(EMPTY_SCREENING_MARKS);
    setAuthorityMarks(EMPTY_AUTHORITY_MARKS);
    setCreditBankingMarks(EMPTY_CREDIT_BANKING);
  }, [caseId]);

  const refetchLive = useCallback(() => {
    void getDeskCase(caseId)
      .then(adopt)
      .catch(() => undefined);
  }, [caseId, adopt]);
  useVerificationCaseLive(caseId, refetchLive);

  const run = useCallback(
    async (scope: CaseActionKey, fn: () => Promise<VerificationDeskDetail>): Promise<void> => {
      setPending(scope);
      try {
        adopt(await fn());
      } catch (e) {
        setError({ scope, message: e instanceof Error ? e.message : 'That action could not be completed.' });
      } finally {
        setPending(null);
      }
    },
    [adopt],
  );

  const active: VerificationRailPhase | null = useMemo(() => {
    if (!detail) return null;
    return detail.rail.find((p) => p.code === activeCode) ?? detail.rail[0] ?? null;
  }, [detail, activeCode]);

  if (loading) {
    return (
      <SkeletonRegion busy label="Loading the application" className="va-case">
        <Skeleton variant="rect" height="112px" radius="panel" />
        <Skeleton variant="rect" height="104px" radius="panel" />
        <Skeleton variant="rect" height="420px" radius="panel" />
      </SkeletonRegion>
    );
  }

  if (!detail || !active) {
    return (
      <div className="va-case">
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-title">Could not open this application</span>
          <p className="va-banner-body">{error?.message ?? 'The case could not be found.'}</p>
        </div>
        <Button variant="secondary" icon="chevron_left" onClick={onBack}>
          All cases
        </Button>
      </div>
    );
  }

  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const locked = !c.verificationProcess;
  const closed = Boolean(c.closedAt);
  /**
   * Whether the case is DECIDABLE — a property of the case, not of the network.
   *
   * `busy` used to be folded in here, which is how one in-flight upload disabled every other
   * control on the page. Each control now disables itself while ITS action runs (`pending`), and
   * `canAct` answers only "is this case open and green".
   */
  const canAct = !locked && !closed;
  const idle = pending === null;
  const name = caseName(c);
  const missing = c.intakeMissing?.length ?? 0;
  /**
   * Who the desk chases for intake — the Sales agent, i.e. the DEAL's owner.
   *
   * Falls back to the department when Zoho has nobody on the Deal, because "Waiting on Unassigned in
   * Zoho" is not a sentence. It never falls back to `ownerName`: that is the row's assignee, which is
   * the Verification desk's own agent on an unowned Deal, and telling a reviewer to chase themselves
   * is how the wrong person got named in the first place.
   */
  const chaseTarget = salesOwnerName(c) ?? 'Sales';
  /** The credit agent on this case — the row's own, else the desk's configured one. */
  const deskAgent = verificationOwnerName(c, policy.data?.verificationOwner?.name ?? null);
  const statusText = STATUS_LABEL[c.statusCode] ?? c.statusCode;
  const chip = statusChipFor(c.statusCode, locked);
  const state = active.status;
  const stateChip = STATE_CHIP[state] ?? STATE_CHIP.not_started!;

  const passed = detail.rail.filter((p) => p.status === 'passed').length;
  const notApplicable = detail.rail.filter((p) => !p.applies || p.status === 'skipped').length;
  const remaining = detail.rail.length - passed - notApplicable;

  const facts: Array<{ k: string; v: string | null }> = [
    { k: 'EIN', v: text(c.ein) },
    { k: 'MC', v: text(c.mc) },
    { k: 'USDOT', v: text(c.dot) },
    { k: 'Trucks', v: c.trucksCount == null ? null : String(c.trucksCount) },
    { k: 'Cards requested', v: c.fuelCardsRequested == null ? null : String(c.fuelCardsRequested) },
    { k: 'Requested limit', v: moneyOrNull(c.requestedLimit) },
  ];

  const DECIDE_KEY: Record<string, CaseActionKey> = {
    pass: 'pass',
    manager_review: 'manager',
    deposit_prepaid: 'deposit',
    decline: 'decline',
    decline_blacklist: 'decline',
  };
  const routing = deskReviewOrder(detail);
  const onDecide = (outcome: VerificationPhaseOutcome, note?: string): void => {
    const findings =
      active.code === 'p5_routing' && outcome === 'pass' ? { reviewOrder: routing.order } : undefined;
    void run(DECIDE_KEY[outcome] ?? 'pass', () =>
      decidePhase(caseId, active.code, {
        outcome,
        ...(note ? { note } : {}),
        ...(findings ? { findings } : {}),
      }),
    );
  };

  const movedPast = caseMovedPastPhase(active.order, c.phaseCode);
  const showDecide = showPhaseDecideActions({
    phaseStatus: active.status,
    applies: active.applies,
    closed,
    locked,
    movedPast,
  });
  const identityPhase = active.code === 'p2_identity';
  const screeningPhase = active.code === 'p3_screening';
  const authorityPhase = active.code === 'p4_authority';
  const creditBankingPhase = active.code === 'p6_credit_banking';
  const identityChecks = identityChecksFor(c.applicantType);
  const identityReady = !identityPhase || allIdentityOk(identityChecks, identityMarks);
  const screeningReady = !screeningPhase || screeningCanPass(screeningMarks);
  const authorityReady = !authorityPhase || authorityCanPass(authorityMarks);
  const creditBankingReady = !creditBankingPhase || creditBankingCanPass(creditBankingMarks);
  const pendingDocs = identityPhase
    ? missingIdentityDocs(identityChecks, identityMarks)
    : authorityPhase
      ? missingAuthorityDocs(authorityMarks)
      : creditBankingPhase
        ? missingBankingDocs(creditBankingMarks.banking)
        : [];
  const decideNote = locked
    ? 'Locked while intake is incomplete.'
    : closed
      ? 'Decided.'
      : !active.applies || active.status === 'skipped'
        ? 'Not applicable — no decision here.'
        : active.status === 'passed' || movedPast
          ? 'This phase is signed off.'
          : identityPhase
            ? 'OK on every check passes. Missing asks Sales for documents.'
            : screeningPhase
              ? 'No blacklist and no duplicate passes. A confirmed match declines and informs Collections.'
              : authorityPhase
                ? 'Active authority and insurance pass. Inactive goes to the manager. Missing asks Sales.'
                : active.code === 'p5_routing'
                  ? 'Confirm the order. Passing stores it for Credit & banking.'
                  : creditBankingPhase
                    ? 'Strong or Acceptable credit plus complete banking passes. Borderline goes to the manager. Unacceptable is deposit / prepaid.'
                    : `Passing advances to phase ${Math.min(10, active.order + 1)}.`;

  return (
    <div className="va-case">
      <section className="va-case-head" data-locked={locked}>
        <div className="va-crumbs">
          <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
            All cases
          </Button>
          <span className="va-crumb">Verification Case</span>
          <Icon name="chevron_right" size="sm" className="va-crumb-sep" />
          <span className="va-crumb-current">{name}</span>
          <span className="va-crumbs-gap" />
          <span className="va-case-id num">CASE {c.id}</span>
        </div>

        <div className="va-case-identity">
          <div className="va-case-who">
            <span className="va-case-mono" data-locked={locked} aria-hidden="true">
              {caseInitials(c)}
            </span>
            <div className="va-case-titles">
              <div className="va-case-title-row">
                <h1 className="va-case-name">{name}</h1>
                <Badge intent={chip.intent} icon={chip.icon}>
                  {statusText}
                </Badge>
              </div>
              <div className="va-case-facts">
                {facts.map((f) => (
                  <span className="va-fact" key={f.k}>
                    <span className="t-eyebrow">{f.k}</span>
                    <span className="va-fact-v num" data-empty={f.v == null}>
                      {f.v ?? 'Not recorded'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="va-case-meta">
            {/* BOTH sides of the case, as identified people rather than words in an 11px corner
                line. Every red case is waiting on the Sales agent — they are who the reviewer picks
                up the phone to — and the second chip answers "who on this desk has it", which is the
                pool until a credit agent is actually assigned. Two chips and not one label: on the
                rows where they differ, one name under one heading is what caused the confusion. */}
            <div className="va-case-owner">
              <Avatar initials={personInitials(salesOwnerName(c) ?? '?')} size="md" />
              <span className="va-case-owner-text">
                <span className="t-eyebrow">Sales owner</span>
                <span className="va-case-owner-name">{salesOwnerLabel(c)}</span>
              </span>
            </div>
            {deskAgent ? (
              <div className="va-case-owner" data-desk="true">
                <Avatar initials={personInitials(deskAgent)} size="md" />
                <span className="va-case-owner-text">
                  <span className="t-eyebrow">Verification agent</span>
                  <span className="va-case-owner-name">{deskAgent}</span>
                </span>
              </div>
            ) : null}
            <div className="va-case-meta-line">
              <span>
                Opened{' '}
                <strong className="num">
                  {new Date(c.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </strong>
              </span>
              <span className="va-meta-sep" aria-hidden="true" />
              <span>
                {APPLICANT_LABEL[c.applicantType ?? ''] ?? 'Type not set'} ·{' '}
                {routeLabel(routeOf(c, wexCardCutoff))}
              </span>
            </div>
          </div>
        </div>
      </section>

      {locked ? (
        <div className="va-banner" data-tone="danger" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="lock" size="sm" />
          </span>
          <span className="va-banner-text">
            {/* Names the agent, not just the department: "waiting on Sales" is not an action, and
                the desk should not have to scan the header to find out who to chase. */}
            <span className="va-banner-title">
              {missing > 0
                ? `Waiting on ${chaseTarget} — ${missing} item${missing === 1 ? '' : 's'} outstanding`
                : `Waiting on ${chaseTarget} — intake not started`}
            </span>
            <span className="va-banner-body">
              Not decidable yet. You can still correct the application below.
            </span>
          </span>
        </div>
      ) : null}

      {closed ? (
        <div className="va-banner" data-tone="success" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="check_circle" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">Decided — {statusText}</span>
            <span className="va-banner-body">Read-only from here.</span>
          </span>
        </div>
      ) : null}

      {/* Errors from the aside render INSIDE the aside, beside the control that failed — a 415 on
          an attach belongs at the attach button, not in a banner three sections above it. Everything
          else has no region of its own and reports here. */}
      {error && error.scope !== 'attach' && error.scope !== 'request' ? (
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="error" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">That action could not be completed</span>
            <span className="va-banner-body">{error.message}</span>
          </span>
        </div>
      ) : null}

      <PhaseSpine
        rail={detail.rail}
        activeCode={active.code}
        passed={passed}
        remaining={remaining}
        notApplicable={notApplicable}
        onPick={setActiveCode}
      />

      <section className="va-phase">
        <header className="va-phase-head">
          <div className="va-phase-titles">
            <span className="t-eyebrow va-phase-kicker">
              Phase <span className="num">{active.order}</span> of 10
            </span>
            <h2 className="va-phase-title">{active.label}</h2>
            <p className="va-phase-desc">{active.description}</p>
          </div>
          <Badge intent={stateChip.intent} icon={stateChip.icon}>
            {PHASE_STATE_LABEL[state]}
          </Badge>
        </header>

        <div className="va-phase-body">
          <div className="va-phase-main">
            {!active.applies && active.code === 'p4_authority' ? (
              <AuthorityFallbackPane
                detail={detail}
                closed={closed}
                busy={pending === 'intake'}
                skipReason={active.skipReason}
                onSave={(body) => run('intake', () => patchDeskIntake(caseId, body))}
              />
            ) : !active.applies ? (
              <SkippedPane phase={active} />
            ) : (
              <PhaseBody
                detail={detail}
                phase={active}
                caseId={caseId}
                pending={pending}
                canAct={canAct}
                wexCardCutoff={wexCardCutoff}
                onRun={run}
                identityMarks={identityMarks}
                onIdentityMarks={setIdentityMarks}
                screeningMarks={screeningMarks}
                onScreeningMarks={setScreeningMarks}
                authorityMarks={authorityMarks}
                onAuthorityMarks={setAuthorityMarks}
                creditBankingMarks={creditBankingMarks}
                onCreditBankingMarks={setCreditBankingMarks}
              />
            )}
          </div>

          <CaseAside
            detail={detail}
            caseId={caseId}
            phase={active}
            canAct={canAct && idle}
            requesting={pending === 'request'}
            uploading={pending === 'attach'}
            /* The aside's own failure, so a refused attach reports at the attach control. */
            error={
              error && (error.scope === 'attach' || error.scope === 'request') ? error.message : null
            }
            onRequestDocs={(items, note) =>
              void run('request', () =>
                requestDocuments(caseId, { phaseCode: active.code, items, ...(note ? { note } : {}) }),
              )
            }
            onUpload={(file, docType) =>
              void run('attach', () => uploadDeskDocuments(caseId, [file], { docType }))
            }
            /* Locked is when the desk MOST needs to attach — a locked case is one waiting on
               documents. Only a decided case refuses. */
            canAttach={!closed && idle}
          />
        </div>

        <CaseDecideBar
          note={decideNote}
          showDecide={showDecide}
          canAct={canAct}
          idle={idle}
          passReady={identityReady && screeningReady && authorityReady && creditBankingReady}
          pending={pending}
          pendingDocs={pendingDocs.length > 0}
          showDeposit={creditBankingPhase && creditBankingMarks.credit === 'unacceptable'}
          onDecide={onDecide}
          onRequestDocs={() =>
            void run('request', () =>
              requestDocuments(caseId, { phaseCode: active.code, items: pendingDocs }),
            )
          }
          declineOutcome={screeningPhase ? screeningDeclineOutcome(screeningMarks) : 'decline'}
        />
      </section>
    </div>
  );
}

