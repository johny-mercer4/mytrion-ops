/**
 * The Sales case header and its state banners — the desk's chrome, addressed to the applicant's agent.
 *
 * Shape is `CaseView`'s exactly (`.va-crumbs` → `.va-case-identity` → `.va-banner`), because Sales
 * and Verification are two doors onto ONE `verification_cases` row and a case that arrives looking
 * like a different object reads as a different product. Split out of `applicationIntake.tsx` to keep
 * both files inside the 600-line cap; presentational only, props in.
 *
 * THE WORDS ARE SALES'. The desk's header states the underwriting status (`STATUS_LABEL` — "Locked",
 * "In review"); this one states what the agent can DO, from `caseSurface`: Incomplete → Ready to
 * submit → With Verification → Needs documents → the decision. "Locked" is the desk telling itself
 * it cannot start; the agent needs to be told they have not finished.
 *
 * The credit agent working the case is deliberately absent. So is every finding. The only person
 * named here is a Sales colleague, and only when the Deal is theirs rather than the reader's.
 */
import { Avatar, Badge, Button, Icon, type BadgeIntent, type IconName } from '@/ds';
import { initials as personInitials } from '@/lib/initials';
import { GateBanner } from './applicationFields';
import { PrefillPanel } from './applicationIntakePanels';
import type {
  ApplicationDetail,
  PrefillResult,
  PrefillSuggestion,
  VerificationApplicantType,
} from '@/api/verificationFlow';
import {
  caseInitials,
  caseName,
  money,
  salesOwnerLabel,
  salesOwnerName,
} from '../../verification/applicants/applicantsModel';
import {
  APPLICANT_TYPE_OPTIONS,
  applicantTypeSelectValue,
  type CaseSurface,
} from './applicationIntakeState';

/** The agent-facing state of the case: one word, one glyph, one intent. */
const SURFACE_CHIP: Record<CaseSurface, { label: string; intent: BadgeIntent; icon: IconName }> = {
  intake: { label: 'Incomplete', intent: 'danger', icon: 'error' },
  ready: { label: 'Ready to submit', intent: 'info', icon: 'check_circle' },
  in_progress: { label: 'With Verification', intent: 'info', icon: 'bolt' },
  needs_more: { label: 'Needs documents', intent: 'warning', icon: 'cloud_upload' },
  // Overridden below by the decision itself — "Complete" is not a verdict.
  complete: { label: 'Decided', intent: 'success', icon: 'check_circle' },
};

/** A decided case wears its decision, not the word "decided". */
function decisionChip(statusCode: string): { intent: BadgeIntent; icon: IconName } {
  if (statusCode.startsWith('declined')) return { intent: 'danger', icon: 'block' };
  if (statusCode === 'routed_wex') return { intent: 'info', icon: 'open_in_new' };
  return { intent: 'success', icon: 'check_circle' };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function ApplicationCaseHead({
  detail,
  surface,
  viewerZohoId,
  typeBusy,
  typeLocked,
  onBack,
  onChangeType,
}: {
  detail: ApplicationDetail;
  surface: CaseSurface;
  /** Whose list this is, so a colleague's Deal can be named and the reader's cannot. */
  viewerZohoId: string | null;
  typeBusy: boolean;
  typeLocked: boolean;
  onBack: (() => void) | undefined;
  onChangeType: (next: VerificationApplicantType) => void;
}) {
  const c = detail.case;
  const name = caseName(c);
  const submitted = Boolean(c.verificationProcess);
  const chip =
    surface === 'complete'
      ? { ...decisionChip(c.statusCode), label: c.statusLabel ?? 'Decided' }
      : SURFACE_CHIP[surface];

  /**
   * The DEAL's owner against the reader — never the row's assignee, which is the Verification desk's
   * own agent on any case whose Deal arrived unowned in Zoho.
   */
  const dealOwner = salesOwnerName(c);
  const othersDeal = Boolean(c.zohoOwnerId) && c.zohoOwnerId !== viewerZohoId;

  const facts: Array<{ k: string; v: string | null }> = [
    { k: 'EIN', v: text(c.ein) },
    { k: 'MC', v: text(c.mc) },
    { k: 'USDOT', v: text(c.dot) },
    { k: 'Trucks', v: c.trucksCount == null ? null : String(c.trucksCount) },
    { k: 'Cards requested', v: c.fuelCardsRequested == null ? null : String(c.fuelCardsRequested) },
    {
      k: c.approvedLimitAmount ? 'Approved limit' : 'Requested limit',
      v: c.approvedLimitAmount
        ? money(c.approvedLimitAmount)
        : c.requestedLimit
          ? money(c.requestedLimit)
          : null,
    },
  ];

  const appliedOn = c.createdAt
    ? new Date(c.createdAt).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'America/New_York',
      })
    : null;

  return (
    <section className="va-case-head" data-locked={!submitted}>
      <div className="va-crumbs">
        {onBack ? (
          <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
            All applications
          </Button>
        ) : null}
        <span className="va-crumb">Verification</span>
        <Icon name="chevron_right" size="sm" className="va-crumb-sep" />
        <span className="va-crumb-current">{name}</span>
        <span className="va-crumbs-gap" />
        {/* The id an agent quotes when they ring the desk about this application. */}
        <span className="va-case-id num">CASE {c.id}</span>
      </div>

      <div className="va-case-identity">
        <div className="va-case-who">
          <span className="va-case-mono" data-locked={!submitted} aria-hidden="true">
            {caseInitials(c)}
          </span>
          <div className="va-case-titles">
            <div className="va-case-title-row">
              <h1 className="va-case-name">{name}</h1>
              <Badge intent={chip.intent} icon={chip.icon}>
                {chip.label}
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
          {/* Named only when the Deal is somebody else's: on your own application this chip would say
              your own name, which tells you nothing you did not already know. */}
          {othersDeal && dealOwner ? (
            <div className="va-case-owner">
              <Avatar initials={personInitials(dealOwner)} size="md" />
              <span className="va-case-owner-text">
                <span className="t-eyebrow">Sales owner</span>
                <span className="va-case-owner-name">{salesOwnerLabel(c)}</span>
              </span>
            </div>
          ) : null}
          <div className="va-case-meta-line">
            {appliedOn ? (
              <span>
                Applied <strong className="num">{appliedOn}</strong>
              </span>
            ) : null}
            <span className="va-meta-sep" aria-hidden="true" />
            {/* The one editable thing in the header, because it decides which form the agent fills.
                A select rather than a label: the Zoho poller leaves the type unset whenever the Deal
                does not state one, and this is where a human who has spoken to the applicant says. */}
            <select
              aria-label="Applicant type"
              className="va-type-select"
              value={applicantTypeSelectValue(c.applicantType)}
              disabled={typeLocked || typeBusy}
              aria-busy={typeBusy || undefined}
              onChange={(e) => {
                const next = e.currentTarget.value as VerificationApplicantType;
                if (next === applicantTypeSelectValue(c.applicantType)) return;
                onChangeType(next);
              }}
            >
              {APPLICANT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The state banner — at most one, and only when there is something to say.
 *
 * Three states earn a banner: the agent still owes intake, the desk has asked them for documents,
 * and the case is decided. "With Verification" gets none — the status chip in the header and the
 * read-only note in the aside already say it, and a third restatement of the quiet state is the
 * banner an agent learns to stop reading.
 */
export function ApplicationCaseBanner({
  detail,
  surface,
  outstanding,
}: {
  detail: ApplicationDetail;
  surface: CaseSurface;
  /** The SERVER's count of what is still missing, never a browser re-derivation. */
  outstanding: number;
}) {
  const c = detail.case;

  if (surface === 'complete') {
    const decided = decisionChip(c.statusCode);
    const limit = c.approvedLimitAmount ? money(c.approvedLimitAmount) : null;
    return (
      <div
        className="va-banner"
        data-tone={decided.intent === 'danger' ? 'danger' : 'success'}
        role="status"
      >
        <span className="va-banner-glyph" aria-hidden="true">
          <Icon name={decided.icon} size="sm" />
        </span>
        <span className="va-banner-text">
          <span className="va-banner-title">
            {c.statusLabel ?? 'Decided'}
            {limit ? ` — ${limit}` : ''}
          </span>
          <p className="va-banner-body">Read-only from here.</p>
        </span>
      </div>
    );
  }

  if (surface === 'needs_more') {
    return (
      <div className="va-banner" data-tone="warning" role="status">
        <span className="va-banner-glyph" aria-hidden="true">
          <Icon name="cloud_upload" size="sm" />
        </span>
        <span className="va-banner-text">
          <span className="va-banner-title">Verification asked you for documents</span>
          <p className="va-banner-body">
            Attach them below. Underwriting carries on once the desk has them — nothing else is needed
            from you.
          </p>
        </span>
      </div>
    );
  }

  if (surface === 'intake') {
    return (
      <div className="va-banner" data-tone="danger" role="status">
        <span className="va-banner-glyph" aria-hidden="true">
          <Icon name="error" size="sm" />
        </span>
        <span className="va-banner-text">
          <span className="va-banner-title">
            {outstanding > 0
              ? `${outstanding} item${outstanding === 1 ? '' : 's'} still needed from you`
              : 'Not submitted yet'}
          </span>
          <p className="va-banner-body">
            Verification cannot start until this is complete. Fill in the details below, attach the
            documents, then submit.
          </p>
        </span>
      </div>
    );
  }

  return null;
}

/**
 * The case aside — "can I submit yet", and the one thing that can fill the form for you.
 *
 * The desk's aside is Documents and the phase log; Sales' is the GATE. It answers one question the
 * agent asks on every visit — is anything still outstanding, and what — and it sits beside the Submit
 * button rather than above the form, because that is the pairing: the button and the reason it will
 * not move.
 *
 * `GateBanner` and `PrefillPanel` keep their own markup; the blocks around them are the desk's
 * (`.va-aside-block[data-divided]`), so the rail reads as one column of related answers rather than
 * three loose cards.
 */
export function ApplicationCaseAside({
  surface,
  complete,
  submitted,
  locked,
  gateMissing,
  prefill,
  applicantType,
  applied,
  busy,
  onApplySuggestion,
}: {
  surface: CaseSurface;
  complete: boolean;
  submitted: boolean;
  locked: boolean;
  /** What the SERVER says is outstanding, minus anything the agent has typed but not saved. */
  gateMissing: Array<{ field: string; label: string }>;
  prefill: PrefillResult | null;
  applicantType: VerificationApplicantType;
  applied: Set<string>;
  busy: boolean;
  onApplySuggestion: (suggestion: PrefillSuggestion) => void;
}) {
  return (
    <aside className="va-aside">
      <div className="va-aside-block">
        <div className="va-aside-head">
          <h3 className="t-eyebrow va-aside-title">Ready to submit?</h3>
        </div>
        <GateBanner
          complete={complete}
          missing={gateMissing}
          submitted={submitted}
          awaitingSave={!complete && gateMissing.length === 0}
        />
      </div>

      {surface === 'needs_more' ? (
        <div className="va-aside-block" data-divided="true">
          <p className="va-aside-note">
            Verification asked for more documents. Attach them in the form and they go straight to the
            desk — there is nothing to submit again.
          </p>
        </div>
      ) : null}

      {locked ? (
        <div className="va-aside-block" data-divided="true">
          <p className="va-aside-note">
            Read-only while Verification is underwriting. If something on the application is wrong,
            ring the desk — they can correct it from their side.
          </p>
        </div>
      ) : null}

      {prefill?.match && prefill.suggestions.length > 0 ? (
        <div className="va-aside-block" data-divided="true">
          <PrefillPanel
            result={prefill}
            applicantType={applicantType}
            applied={applied}
            locked={locked || busy}
            onApply={onApplySuggestion}
          />
        </div>
      ) : null}
    </aside>
  );
}
