/**
 * Phase 5 — confirm the two routing decisions on this case. Does not open credit or banking.
 *
 * TWO DECISIONS, AND ONLY ONE WAS ON SCREEN. Phase 5 routes a case twice: which review runs first
 * (trucks vs `bankFirstTruckMin`) and who underwrites it at all (fuel cards vs `wexCardCutoff`, the
 * Phase 1 merge point — above the cutoff the case leaves for WEX). The server has been resolving and
 * sending both on `detail.routing` all along; this pane rendered only the first, so the reviewer
 * confirming "routing" was confirming half of it and could not see the half that decides whether
 * Octane underwrites the case at all.
 *
 * AND THE ONE IT DID SHOW USED THE WRONG NUMBER. The threshold was a hard-coded 10 in the client
 * while the state machine read `verification_policy.bank_first_truck_min`. Move the policy on the
 * admin screen and the pane went on explaining a rule the server no longer applied — silently, with
 * no way for a reviewer to notice. Both thresholds now come off the payload.
 */
import { useState } from 'react';
import { Button, Input } from '@/ds';
import type { VerificationApplicantType, VerificationDeskDetail } from '@/api/verificationFlow';
import {
  computeReviewOrder,
  computeUnderwritingRoute,
  DEFAULT_BANK_FIRST_TRUCK_MIN,
  reviewOrderLabel,
  trucksMissing,
  underwritingRouteLabel,
} from './caseRouting';

const TYPE_OPTIONS = [
  { value: 'owner_operator', label: 'Owner-Operator / Individual' },
  { value: 'carrier', label: 'Carrier (Company)' },
] as const;

function typeValue(raw: string): VerificationApplicantType {
  return raw === 'owner_operator' ? 'owner_operator' : 'carrier';
}

function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function RoutingPane({
  detail,
  closed,
  busy,
  onSave,
}: {
  detail: VerificationDeskDetail;
  closed: boolean;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const c = detail.case;
  const [applicantType, setApplicantType] = useState(
    typeValue(String(c.applicantType ?? 'owner_operator')),
  );
  const [trucks, setTrucks] = useState(c.trucksCount == null ? '' : String(c.trucksCount));
  const [cards, setCards] = useState(
    c.fuelCardsRequested == null ? '' : String(c.fuelCardsRequested),
  );
  const trucksCount = parseCount(trucks);
  const cardsCount = parseCount(cards);
  const missing = trucksMissing(trucksCount);
  // THE LIVE POLICY, not a local constant. `?? DEFAULT` covers a payload from before the field.
  const bankFirstTruckMin = detail.routing?.bankFirstTruckMin ?? DEFAULT_BANK_FIRST_TRUCK_MIN;
  const wexCardCutoff = detail.routing?.wexCardCutoff ?? 20;
  const order = computeReviewOrder(applicantType, trucksCount, bankFirstTruckMin);
  const route = computeUnderwritingRoute(cardsCount, wexCardCutoff);
  const disabled = closed || busy;

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        {/* `t-eyebrow va-pane-kicker`, like every sibling pane. `va-phase-title` was this one file
            using the rail's heading class inside a pane body. */}
        <h3 className="t-eyebrow va-pane-kicker">Routing</h3>
        <span className="va-pane-note">
          Which review runs first, and who underwrites the case
        </span>
      </div>

      <div className="va-fields">
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p5-type">
            Applicant type
          </label>
          <select
            id="va-p5-type"
            aria-label="Applicant type"
            className="va-type-select"
            value={applicantType}
            disabled={disabled}
            onChange={(e) => setApplicantType(typeValue(e.currentTarget.value))}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p5-trucks">
            Trucks
          </label>
          <Input
            id="va-p5-trucks"
            value={trucks}
            placeholder="Not recorded"
            inputMode="numeric"
            disabled={disabled}
            fullWidth
            onChange={(e) => setTrucks(e.currentTarget.value)}
          />
        </div>
        {/* FUEL CARDS decide the WEX split, and were editable nowhere on this pane while being the
            input to half of what it is called Routing for. */}
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p5-cards">
            Fuel cards requested
          </label>
          <Input
            id="va-p5-cards"
            value={cards}
            placeholder="Not recorded"
            inputMode="numeric"
            disabled={disabled}
            fullWidth
            onChange={(e) => setCards(e.currentTarget.value)}
          />
        </div>
      </div>
      {closed ? null : (
        <div className="va-save">
          <Button
            variant="secondary"
            icon="save"
            loading={busy}
            disabled={disabled}
            onClick={() => void onSave({ applicantType, trucksCount, fuelCardsRequested: cardsCount })}
          >
            Save corrections
          </Button>
        </div>
      )}

      {/* THE TWO ANSWERS, side by side, each naming the threshold it was decided against — so a
          reviewer can check the rule rather than trust the verdict, and so a policy change is
          visible here instead of silently changing the outcome. */}
      <div className="va-id-checks">
        <div className="va-order-card" data-order={order} data-assumed={missing || undefined}>
          <span className="va-order-kicker">This case reviews</span>
          <strong className="va-order-value">{reviewOrderLabel(order)}</strong>
          <p className="va-pane-body">
            {missing
              ? `Truck count is missing — counted as 0, so credit is first. Enter a count if this is a ${bankFirstTruckMin}+ truck carrier.`
              : applicantType === 'carrier' && (trucksCount ?? 0) >= bankFirstTruckMin
                ? `Carrier with ${trucksCount} trucks, at or above the ${bankFirstTruckMin}-truck policy — banking first.`
                : applicantType === 'owner_operator'
                  ? 'Owner-operator — credit first, whatever the truck count.'
                  : `Carrier with ${trucksCount ?? 0} trucks, below the ${bankFirstTruckMin}-truck policy — credit first.`}
          </p>
        </div>

        <div className="va-order-card" data-order={route === 'wex' ? 'banking_first' : 'credit_first'}>
          <span className="va-order-kicker">Underwritten by</span>
          <strong className="va-order-value">{underwritingRouteLabel(route)}</strong>
          <p className="va-pane-body">
            {cardsCount === null
              ? `Card count is missing — counted as 0, so this stays in-house. Above ${wexCardCutoff} cards it goes to WEX.`
              : route === 'wex'
                ? `${cardsCount} cards, above the ${wexCardCutoff}-card cutoff — this leaves Octane for WEX.`
                : `${cardsCount} card${cardsCount === 1 ? '' : 's'}, at or below the ${wexCardCutoff}-card cutoff — Octane underwrites it.`}
          </p>
        </div>
      </div>

      {/* WHEN THE PANE AND THE SERVER DISAGREE, SAY SO. The unsaved edits above recompute locally;
          `detail.routing` is what the state machine will actually apply until they are saved. A pane
          that showed only its own arithmetic would let a reviewer pass a phase on a number the server
          has never seen. */}
      {detail.routing &&
      (detail.routing.reviewOrder !== order || detail.routing.underwritingRoute !== route) ? (
        <p className="va-aside-note">
          Unsaved: the server currently routes this case as{' '}
          <strong>{reviewOrderLabel(detail.routing.reviewOrder)}</strong> ·{' '}
          <strong>{underwritingRouteLabel(detail.routing.underwritingRoute)}</strong>. Save the
          corrections to make the numbers above the ones it applies.
        </p>
      ) : null}
    </div>
  );
}
