import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeDollarSign,
  Building2,
  Calculator,
  CircleCheck,
  CreditCard,
  Database,
  Fuel,
  Link2,
  ReceiptText,
  Target,
  TriangleAlert,
  UsersRound,
  X,
} from 'lucide-react';
import type { CrmRow, ReferralCalculationPreview, ReferralField } from '../../../api/referrals';
import { useModalFocus } from '../../_shared/useModalFocus';
import { displayValue, str, type ReferralCardModel } from './referralModel';
import './referralModal.css';
// After referralModal.css: these are cross-file finishes that must win at equal specificity.
import './referralPolish.css';

type TabId = 'overview' | 'calculation' | 'crm';

const TYPE_CLASS: Record<string, string> = {
  'Gallons (Legacy)': 'mg-rf-tone-cyan',
  'Swipes (Legacy)': 'mg-rf-tone-violet',
  'Gallons (Parent)': 'mg-rf-tone-amber',
  'Gallons (Child)': 'mg-rf-tone-emerald',
};

function money(value: number | string): string {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function number(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function Value({ value }: { value: unknown }) {
  const display = displayValue(value);
  if (display.empty) return <span className="mg-rf-empty-value">Not provided</span>;
  if (display.href) {
    return (
      <a href={display.href} target="_blank" rel="noreferrer">
        {display.text}
      </a>
    );
  }
  return <>{display.text}</>;
}

function DetailGrid({ fields, row }: { fields: ReferralField[]; row: CrmRow }) {
  return (
    <dl className="mg-rf-detail-grid">
      {fields.map((field) => (
        <div key={field.apiName}>
          <dt>{field.label}</dt>
          <dd>
            <Value value={row[field.apiName]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formula(preview: ReferralCalculationPreview): string {
  if (preview.bonusType === 'gallons_legacy') {
    return `${number(preview.periodGallons)} eligible gallons × $0.01`;
  }
  if (preview.bonusType === 'swipes_legacy') {
    return `${number(preview.periodSwipes)} unique cards × $50`;
  }
  return `${number(preview.cumulativeGallons)} of ${number(preview.thresholdGallons ?? 0)} cumulative gallons`;
}

function calculationRule(calculation: string): string {
  if (calculation === 'Gallons (Legacy)') return '$0.01 per eligible gallon, paid monthly';
  if (calculation === 'Swipes (Legacy)') return '$50 per unique card, paid monthly';
  if (calculation === 'Gallons (Parent)') return '$50 to the parent at 500 cumulative gallons';
  if (calculation === 'Gallons (Child)') return '$50 to the child at 1,000 cumulative gallons';
  return 'Complete the Calculation field and related Deal to calculate this referral';
}

function PreviewState({ preview }: { preview: ReferralCalculationPreview }) {
  if (preview.state === 'paid') {
    return (
      <span className="mg-rf-state is-paid">
        <CircleCheck size={12} /> Paid
      </span>
    );
  }
  if (preview.state === 'earned') {
    return (
      <span className="mg-rf-state is-earned">
        <BadgeDollarSign size={12} /> Earned
      </span>
    );
  }
  return (
    <span className="mg-rf-state is-tracking">
      <Target size={12} /> Tracking
    </span>
  );
}

function CalculationBreakdown({ previews }: { previews: ReferralCalculationPreview[] }) {
  if (previews.length === 0) {
    return (
      <div className="mg-rf-modal-empty">
        <TriangleAlert size={20} />
        <div>
          <strong>Deal link required</strong>
          <span>
            Link the Child Referral to a Zoho Deal with Carrier ID. Calculations intentionally do
            not fall back to the referral module’s text carrier field.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="mg-rf-breakdowns">
      {previews.map((preview) => (
        <article
          key={`${preview.childId}:${preview.dealId}:${preview.bonusType}`}
          className="mg-rf-breakdown"
        >
          <header>
            <span className="mg-rf-breakdown-icon">
              {preview.bonusType === 'swipes_legacy' ? (
                <CreditCard size={17} />
              ) : (
                <Fuel size={17} />
              )}
            </span>
            <div>
              <strong>
                {preview.dealName || preview.childName || `Carrier ${preview.carrierId}`}
              </strong>
              <span>
                Carrier #{preview.carrierId} · {preview.recurring ? 'Monthly' : 'One-time'} ·{' '}
                {preview.fuelCodes.join(' / ')}
              </span>
            </div>
            <PreviewState preview={preview} />
          </header>
          <div className="mg-rf-breakdown-formula">
            <Calculator size={14} />
            <span>{formula(preview)}</span>
            <strong>{money(preview.amountUsd)}</strong>
          </div>
          {!preview.recurring ? (
            <div className="mg-rf-progress">
              <div>
                <span>Threshold progress</span>
                <strong>{Math.round(preview.progressPct)}%</strong>
              </div>
              <span className="mg-rf-progress-track">
                <span style={{ width: `${preview.progressPct}%` }} />
              </span>
            </div>
          ) : null}
          <dl className="mg-rf-mini-metrics">
            <div>
              <dt>Eligible gallons</dt>
              <dd>{number(preview.periodGallons)}</dd>
            </div>
            <div>
              <dt>Unique cards</dt>
              <dd>{number(preview.periodSwipes)}</dd>
            </div>
            <div>
              <dt>Cumulative gallons</dt>
              <dd>{number(preview.cumulativeGallons)}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{preview.recipientName || 'Not linked'}</dd>
            </div>
            <div>
              <dt>Rate / award</dt>
              <dd>{preview.recurring ? money(preview.rateUsd) : '$50 milestone'}</dd>
            </div>
            <div>
              <dt>Payable now</dt>
              <dd>{money(preview.payableAmountUsd)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function RelatedRecords({
  card,
  childFields,
  dealFields,
}: {
  card: ReferralCardModel;
  childFields: ReferralField[];
  dealFields: ReferralField[];
}) {
  const visibleChildFields = childFields.filter((field) => field.apiName !== 'Calculation');
  const visibleDealFields = dealFields.filter((field) => field.apiName !== 'Amount');
  return (
    <div className="mg-rf-related-stack">
      <section className="mg-rf-modal-section">
        <div className="mg-rf-section-head">
          <UsersRound size={15} />
          <h3>Child referrals</h3>
          <span>{card.children.length}</span>
        </div>
        {card.children.length ? (
          card.children.map((child) => (
            <article className="mg-rf-related-record" key={str(child.id)}>
              <header>
                <Building2 size={15} />
                <strong>
                  {str(child.Name) || str(child.Company_Name) || 'Unnamed child referral'}
                </strong>
                <span>{str(child.Referrer_ID) || 'No referrer ID'}</span>
              </header>
              <DetailGrid fields={visibleChildFields} row={child} />
            </article>
          ))
        ) : (
          <div className="mg-rf-inline-empty">No Child Referral is linked to this parent yet.</div>
        )}
      </section>

      <section className="mg-rf-modal-section">
        <div className="mg-rf-section-head">
          <Link2 size={15} />
          <h3>Related deals</h3>
          <span>{card.deals.length}</span>
        </div>
        {card.deals.length ? (
          card.deals.map((deal) => (
            <article className="mg-rf-related-record" key={str(deal.id)}>
              <header>
                <ReceiptText size={15} />
                <strong>{str(deal.Deal_Name) || 'Unnamed deal'}</strong>
                <span>Carrier #{str(deal.Carrier_ID) || 'missing'}</span>
              </header>
              <DetailGrid fields={visibleDealFields} row={deal} />
            </article>
          ))
        ) : (
          <div className="mg-rf-inline-empty">
            No related Deal with a Carrier ID is available. This referral cannot be calculated yet.
          </div>
        )}
      </section>
    </div>
  );
}

export function ReferralDetailModal({
  card,
  parentFields,
  childFields,
  dealFields,
  periodMonth,
  onClose,
}: {
  card: ReferralCardModel;
  parentFields: ReferralField[];
  childFields: ReferralField[];
  dealFields: ReferralField[];
  periodMonth: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>('overview');
  const dialogRef = useModalFocus<HTMLDivElement>();
  const tone = TYPE_CLASS[card.calculation] ?? 'mg-rf-tone-neutral';
  const amount = card.previews.reduce((sum, preview) => sum + Number(preview.amountUsd), 0);
  const periodGallons = card.previews.reduce(
    (sum, preview) => sum + preview.periodGallons,
    0,
  );
  const periodCards = card.previews.reduce((sum, preview) => sum + preview.periodSwipes, 0);
  const carriers = new Set(card.previews.map((preview) => preview.carrierId)).size;
  const month = new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className={`mg-root mg-rf-modal-scope ${tone}`} data-mytrion="marketing">
      <div className="mg-rf-scrim" role="presentation" onMouseDown={onClose}>
        <div
          ref={dialogRef}
          className="mg-rf-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mg-referral-modal-title"
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="mg-rf-modal-head">
            <span className="mg-rf-modal-avatar">{card.name.slice(0, 2).toUpperCase()}</span>
            <div className="mg-rf-modal-identity">
              <span className="mg-rf-eyebrow">{card.referrerId || 'Referral record'}</span>
              <h2 id="mg-referral-modal-title">{card.name}</h2>
              <p>{card.company || card.calculation || 'Zoho Parent Referrer'}</p>
            </div>
            <div className="mg-rf-modal-amount">
              <span>Calculated bonus · {month}</span>
              <strong>{money(amount)}</strong>
            </div>
            <button
              type="button"
              className="mg-rf-modal-close"
              onClick={onClose}
              aria-label="Close referral details"
              data-focus-skip
            >
              <X size={18} />
            </button>
          </header>

          <nav className="mg-rf-modal-tabs" role="tablist" aria-label="Referral detail sections">
            {(
              [
                ['overview', 'Overview', Building2],
                ['calculation', 'Calculation', Calculator],
                ['crm', 'CRM details', Database],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>

          <div className="mg-rf-modal-body">
            {tab === 'overview' ? (
              <>
                <div className="mg-rf-calculation-hero">
                  <span>
                    <Calculator size={21} />
                  </span>
                  <div>
                    <small>Calculation applied</small>
                    <strong>{card.calculation || 'Setup required'}</strong>
                    <p>{calculationRule(card.calculation)}</p>
                  </div>
                  <aside>
                    <small>Live result for {month}</small>
                    <strong>{money(amount)}</strong>
                    <span>{money(card.payableAmount)} payable now</span>
                  </aside>
                </div>
                <div className="mg-rf-modal-kpis">
                  <div>
                    <UsersRound size={16} />
                    <span>Child referrals</span>
                    <strong>{card.children.length}</strong>
                  </div>
                  <div>
                    <Link2 size={16} />
                    <span>Related deals</span>
                    <strong>{card.deals.length}</strong>
                  </div>
                  <div>
                    <Fuel size={16} />
                    <span>Eligible gallons</span>
                    <strong>{number(periodGallons)}</strong>
                  </div>
                  <div>
                    <CreditCard size={16} />
                    <span>Unique cards</span>
                    <strong>{number(periodCards)}</strong>
                  </div>
                  <div>
                    <Database size={16} />
                    <span>Connected carriers</span>
                    <strong>{carriers}</strong>
                  </div>
                  <div>
                    <BadgeDollarSign size={16} />
                    <span>Payable</span>
                    <strong>{money(card.payableAmount)}</strong>
                  </div>
                </div>
                <CalculationBreakdown previews={card.previews} />
              </>
            ) : null}
            {tab === 'calculation' ? (
              <CalculationBreakdown previews={card.previews} />
            ) : null}
            {tab === 'crm' ? (
              <div className="mg-rf-related-stack">
                <section className="mg-rf-modal-section">
                  <div className="mg-rf-section-head">
                    <Database size={15} />
                    <h3>Parent Referrer fields</h3>
                    <span>{parentFields.length}</span>
                  </div>
                  <div className="mg-rf-crm-panel">
                    <DetailGrid fields={parentFields} row={card.parent} />
                  </div>
                </section>
                <RelatedRecords card={card} childFields={childFields} dealFields={dealFields} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
