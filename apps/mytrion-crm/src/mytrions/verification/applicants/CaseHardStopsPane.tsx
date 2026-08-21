/**
 * Phase 7 — the two financial hard stops, and the indicators a manager weighs.
 *
 * WHY THIS REPLACES THE OLD PANE. The previous one lived in `flow/PhasePanes.tsx` and was built from
 * inline `style={s('padding:14px 16px;border:1px solid …')}` strings — a different visual language
 * mid-screen from every `.va-*` pane around it, and not even a class to correct. It was also entirely
 * READ-ONLY: it printed the derived verdict and gave the reviewer nothing to record, on the phase whose
 * whole job is a decision.
 *
 * A HARD STOP IS NOT A DECLINE, and the copy has to keep saying so. It rules out a STANDARD UNSECURED
 * line and routes to Deposit 1:1, Prepaid or Manager Review — the applicant may be entirely
 * legitimate. The SOP is explicit, and it is the easiest thing on this screen to read wrongly.
 *
 * BOTH STOPS ARE DERIVED, NOT TYPED HERE. `avgWeeklyNetCashFlow` is computed by the server from the
 * two recurring figures in Phase 6, and `bureauNoHit` is the toggle on Phase 6's credit step. This
 * pane therefore has no fields of its own — what it has is an acknowledgement, because the reviewer's
 * own read of the outcome is the thing this phase records and nothing was capturing it.
 */
import { Badge, Button, Icon } from '@/ds';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  HARD_STOP_COPY,
  hardStopTone,
  type HardStopAck,
} from './caseHardStops';

/**
 * What the reviewer records here.
 *
 * `continue` and `restricted` are the SOP's two branches. `unresolved` exists because the third real
 * state is neither: the figure has not been recorded, so there is nothing to agree or disagree with
 * yet, and forcing a choice would put a name against a judgement nobody made.
 */
const ACKS: ReadonlyArray<MarkOption<HardStopAck>> = [
  {
    id: 'continue',
    label: 'Continue',
    icon: 'check_circle',
    tone: 'good',
    hint: 'Neither stop applies — a standard unsecured line stays on the table',
  },
  {
    id: 'restricted',
    label: 'No standard LOC',
    icon: 'block',
    tone: 'bad',
    hint: 'Deposit 1:1, prepaid or manager review',
  },
  {
    id: 'unresolved',
    label: 'Not settled',
    icon: 'warning',
    tone: 'warn',
    hint: 'Something is still missing from Phase 6',
  },
];

/** Money as the reviewer reads it. The stored value is a numeric string like "1800.00". */
function money(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

function count(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null && b == null) return '—';
  return String((a ?? 0) + (b ?? 0));
}

export function HardStopsPane({
  detail,
  ack,
  onAck,
  canAct,
  onGoToPhase,
}: {
  detail: VerificationDeskDetail;
  ack: HardStopAck | null;
  onAck: (next: HardStopAck) => void;
  canAct: boolean;
  /** Jumping back to Phase 6 is the recovery for an unrecorded figure, so the pane offers it. */
  onGoToPhase: (code: string) => void;
}) {
  const { hardStops, indicators, banking } = detail;
  const b = (banking ?? {}) as unknown as Record<string, unknown>;
  const netCashFlow = b.avgWeeklyNetCashFlow as string | null | undefined;
  const unrecorded = hardStops.triggered.some((s) => s.code === 'cash_flow_unrecorded');

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Financial hard stops</h3>
        <span className="va-pane-note">
          {hardStops.passed
            ? 'Neither stop applies'
            : `${hardStops.triggered.length} stop${hardStops.triggered.length === 1 ? '' : 's'} — no standard unsecured line`}
        </span>
      </div>

      {/* THE THREE FIGURES THE STOPS AND THE INDICATORS TURN ON, read off Phase 6 rather than retyped.
          Net cash flow leads because it is the stop; the other two are the indicators most often
          decisive beside it. */}
      <div className="va-figs">
        <span className="va-fig">
          <span className="t-eyebrow">Avg weekly net cash flow</span>
          <span className="va-fig-v" data-empty={netCashFlow ? undefined : true}>
            {money(netCashFlow)}
          </span>
        </span>
        <span className="va-fig">
          <span className="t-eyebrow">Avg daily balance</span>
          <span
            className="va-fig-v"
            data-empty={b.avgDailyBalance ? undefined : true}
          >
            {money(b.avgDailyBalance as string | null)}
          </span>
        </span>
        <span className="va-fig">
          <span className="t-eyebrow">NSF / returned ACH</span>
          <span className="va-fig-v">
            {count(b.nsfCount as number | null, b.achReturnCount as number | null)}
          </span>
        </span>
      </div>

      {/* THE FORMULA, because the number above is derived and a reviewer checking it needs to know
          from what. It is the SOP's definition verbatim, including the exclusion. */}
      <p className="va-aside-note">
        Average weekly net cash flow = recurring weekly income − recurring weekly expenses, with
        one-time and unexplained deposits excluded. Recorded in Phase 6; the server derives it, so it
        always equals what those two figures say.
      </p>

      {/* BOTH STOPS, ALWAYS BOTH, whether they fired or not. A pane that listed only what triggered
          left the reviewer unable to tell "checked and clear" from "not checked". */}
      <div className="va-id-checks">
        {HARD_STOP_COPY.map((stop) => {
          const hit = hardStops.triggered.find((t) => stop.codes.includes(t.code));
          return (
            <div className="va-id-check" key={stop.id} data-mark={hardStopTone(Boolean(hit))}>
              <div className="va-id-check-copy">
                <span className="va-id-check-label">
                  {hit ? hit.label : stop.clearLabel}
                  {hit ? (
                    <Badge
                      intent={hit.code === 'cash_flow_unrecorded' ? 'warning' : 'danger'}
                      size="sm"
                      icon={hit.code === 'cash_flow_unrecorded' ? 'warning' : 'block'}
                    >
                      {hit.code === 'cash_flow_unrecorded' ? 'Unanswered' : 'Hard stop'}
                    </Badge>
                  ) : (
                    <Badge intent="success" size="sm" icon="check_circle">
                      Clear
                    </Badge>
                  )}
                </span>
                <span className="va-id-check-value">{hit ? hit.detail : stop.clearDetail}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* AN UNRECORDED FIGURE IS UNFINISHED WORK, NOT A FINDING, so the recovery is a jump back rather
          than a deposit offer. This is the one hard-stop row whose answer is somewhere else. */}
      {unrecorded ? (
        <div className="va-ask">
          <span className="va-aside-note">
            Nothing to evaluate until Phase 6 carries recurring weekly income and expenses.
          </span>
          <div className="va-ask-actions">
            <Button
              variant="secondary"
              size="sm"
              icon="restart_alt"
              onClick={() => onGoToPhase('p6_credit_banking')}
            >
              Back to Credit &amp; banking
            </Button>
          </div>
        </div>
      ) : null}

      {!hardStops.passed && !unrecorded ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">A hard stop is not a decline</span>
            <p className="va-banner-body">
              It rules out a standard unsecured line and nothing more. The applicant may be entirely
              legitimate — the doors from here are Deposit 1:1, Prepaid, or Manager Review.
            </p>
          </span>
        </div>
      ) : null}

      {/* THE MANAGER-REVIEW INDICATORS. Explicitly not declines, and explicitly not hard stops — the
          SOP calls them signals a human weighs, which is why they are a list and not a gate. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">Manager-review indicators</h4>
          <span className="va-pane-note">
            {indicators.length === 0
              ? 'None fired'
              : `${indicators.length} fired · not declines by themselves`}
          </span>
        </div>
        {indicators.length === 0 ? (
          <p className="va-aside-note">
            None of the eleven indicators fired on the figures recorded so far. They are read from
            Phase 6, so an empty list on an empty banking review means nothing was checked rather than
            nothing was found.
          </p>
        ) : (
          <ul className="va-banner-list">
            {indicators.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        )}
      </div>

      {/* WHAT THE REVIEWER RECORDS. The stops are derived; this is the only thing on the phase that is
          theirs, and there was nowhere to put it at all before. */}
      <div className="va-id-check" data-mark={ack === 'continue' ? 'ok' : ack === 'restricted' ? 'inconsistent' : ack ? 'missing' : 'unset'}>
        <div className="va-id-check-copy">
          <span className="va-id-check-label">Outcome for this case</span>
          <span className="va-id-check-value">
            {hardStops.passed
              ? 'Both stops are clear, so Continue is the expected answer — overrule it if the file says otherwise.'
              : 'A stop fired, so the standard line is off the table. Record it and take the deposit, prepaid or manager door on the bar below.'}
          </span>
        </div>
        <CaseMarkGroup
          ariaLabel="Hard stop outcome"
          options={ACKS}
          value={ack}
          disabled={!canAct}
          onChange={onAck}
        />
      </div>
    </div>
  );
}
