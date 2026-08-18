/**
 * Phase 5 — confirm which review runs first. Does not open credit or banking.
 */
import { useState } from 'react';
import { Button, Input } from '@/ds';
import type { VerificationApplicantType, VerificationDeskDetail } from '@/api/verificationFlow';
import {
  BANK_FIRST_TRUCK_MIN,
  computeReviewOrder,
  reviewOrderLabel,
  trucksMissing,
} from './caseRouting';

const TYPE_OPTIONS = [
  { value: 'owner_operator', label: 'Owner-Operator / Individual' },
  { value: 'carrier', label: 'Carrier (Company)' },
] as const;

function typeValue(raw: string): VerificationApplicantType {
  return raw === 'owner_operator' ? 'owner_operator' : 'carrier';
}

function parseTrucks(raw: string): number | null {
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
  const trucksCount = parseTrucks(trucks);
  const missing = trucksMissing(trucksCount);
  const order = computeReviewOrder(applicantType, trucksCount);
  const disabled = closed || busy;

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="va-phase-title">Review order</h3>
        <span className="va-pane-note">
          Carrier with {BANK_FIRST_TRUCK_MIN}+ trucks reviews banking first. Everyone else reviews
          credit first.
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
      </div>
      {closed ? null : (
        <div className="va-save">
          <Button
            variant="secondary"
            icon="save"
            loading={busy}
            disabled={disabled}
            onClick={() => void onSave({ applicantType, trucksCount })}
          >
            Save corrections
          </Button>
        </div>
      )}

      <div className="va-order-card" data-order={order} data-assumed={missing || undefined}>
        <span className="va-order-kicker">This case reviews</span>
        <strong className="va-order-value">{reviewOrderLabel(order)}</strong>
        <p className="va-pane-body">
          {missing
            ? 'Truck count is missing — treated as fewer than 10, so credit is first. Enter a count if this is a 10+ truck carrier.'
            : applicantType === 'carrier' && (trucksCount ?? 0) >= BANK_FIRST_TRUCK_MIN
              ? `Carrier with ${trucksCount} trucks — banking first.`
              : applicantType === 'owner_operator'
                ? 'Owner-operator — credit first.'
                : `Carrier with ${trucksCount ?? 0} trucks — credit first.`}
        </p>
      </div>
    </div>
  );
}
