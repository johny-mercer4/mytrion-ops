/**
 * One carrier, in full — the design's dialog.
 *
 * Three headline tiles, then Details / Attachments on pill tabs. The roster row already on screen
 * carries the terms, the limit and the score, so those render immediately; the contact and identity
 * half needs a per-carrier fetch (`/verification/roster/:carrierId`) and is the only thing that
 * waits. That split is deliberate: the reviewer sees the credit picture the instant they click.
 *
 * Attachments reuse `VerificationClientAttachments` — a working upload / open / delete surface keyed
 * on the carrier id, which is the one part of this dialog that writes.
 */
import { Badge, Dialog, EmptyState, Icon, Skeleton, Tabs, type IconName } from '@/ds';
import type { VerificationClientRow } from '@/api/verificationClients';
import { VerificationClientAttachments } from '../VerificationClientAttachments';
import { useCarrierAttachments, useVerificationClientDetail } from '../verificationData';
import {
  activityText,
  addressText,
  fullDate,
  isLoc,
  isPrepay,
  limitText,
  minBalanceText,
  money,
  railStyle,
  scoreText,
  scoreTone,
  termsIntent,
  termsLabel,
} from './clientsModel';
import './clients.css';

export type ClientTab = 'details' | 'attachments';

/** One fact in the payment grid — a tone only where the value itself is a flag. */
interface Fact {
  k: string;
  v: string;
  tone?: 'danger' | 'accent';
}

/** One row in the contact list — `mono` for anything a reviewer copies out. */
interface ContactFact {
  k: string;
  v: string;
  icon: IconName;
  mono?: boolean;
  danger?: boolean;
}

export function ClientDetailDialog({
  client,
  open,
  tab,
  onTabChange,
  onClose,
}: {
  client: VerificationClientRow;
  open: boolean;
  tab: ClientTab;
  onTabChange: (tab: ClientTab) => void;
  onClose: () => void;
}) {
  const detail = useVerificationClientDetail(open ? client.carrierId : null);
  const attachments = useCarrierAttachments(client.carrierId, open && tab === 'attachments');

  const rail = railStyle(client.companyType);
  const d = detail.data;
  const prepay = isPrepay(client);

  const headline = [
    {
      k: 'Credit limit',
      v: limitText(client),
      tone: isLoc(client) ? 'plain' : 'none',
      hint: termsLabel(client),
    },
    {
      k: 'Credit score',
      v: scoreText(client),
      tone: scoreTone(client),
      hint: d ? `CreditSafe ${d.creditsafeGrade || '—'}` : 'CreditSafe grade',
    },
    {
      k: 'Minimum balance',
      v: minBalanceText(client),
      tone: prepay || client.minimumRequiredBalance == null ? 'none' : 'plain',
      hint: client.billingCycleTag || 'Cycle not set',
    },
  ] as const;

  const paymentFacts: Fact[] = [
    { k: 'Aggregator', v: rail.label },
    { k: 'Payment terms', v: termsLabel(client), ...(isLoc(client) ? { tone: 'accent' as const } : {}) },
    { k: 'Payment day', v: client.paymentDay || '—' },
    { k: 'Billing cycle tag', v: client.billingCycleTag || '—' },
    { k: 'Billing cycle', v: client.billingCycle || '—' },
    { k: 'Debtor flag', v: client.isDebtor ? 'Yes' : 'No', ...(client.isDebtor ? { tone: 'danger' as const } : {}) },
    { k: 'Last activity', v: activityText(client.lastTransactionAt) },
    { k: 'First swipe', v: d ? fullDate(d.firstSwipeAt) : '…' },
  ];

  const contactFacts: ContactFact[] = d
    ? [
        { k: 'Contact', v: d.contact || '—', icon: 'id_card' },
        { k: 'Phone', v: d.phone || '—', icon: 'call', mono: true },
        { k: 'Email', v: d.email || '—', icon: 'mail', mono: true },
        { k: 'Address', v: addressText(d), icon: 'location_on' },
        { k: 'Octane agent', v: d.agentName || '—', icon: 'person_check' },
        { k: 'Agent email', v: d.agentEmail || '—', icon: 'mail', mono: true },
        { k: 'Money code', v: d.moneyCode || '—', icon: 'key', mono: true },
        {
          k: 'Insurance',
          v: d.insuranceCoverage || '—',
          icon: 'umbrella',
          danger: /lapsed|expired/i.test(d.insuranceCoverage ?? ''),
        },
        { k: 'USDOT', v: d.dot || '—', icon: 'local_shipping', mono: true },
      ]
    : [];

  const subtitle = [
    `#${client.carrierId}`,
    d?.dot ? `DOT ${d.dot}` : null,
    client.isActive ? null : 'Inactive',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={client.companyName}
      subtitle={subtitle}
      closeLabel="Close client detail"
    >
      <div className="vc-modal">
        <div className="vc-modal-flags">
          <span className="vc-rail" style={{ ['--vc-rail' as string]: rail.tone }}>
            <Icon name={rail.icon as IconName} size="sm" />
            {rail.label}
          </span>
          <Badge intent={termsIntent(client)}>{termsLabel(client)}</Badge>
          {client.isDebtor ? (
            <Badge intent="danger" icon="warning">
              Flagged as a debtor
            </Badge>
          ) : null}
          {client.isActive ? null : (
            <Badge intent="neutral" icon="schedule">
              Inactive
            </Badge>
          )}
        </div>

        <div className="vc-headline">
          {headline.map((h) => (
            <div className="vc-head-tile" key={h.k}>
              <span className="t-eyebrow">{h.k}</span>
              <span className="vc-head-v num-lg" data-tone={h.tone}>
                {h.v}
              </span>
              <span className="vc-head-hint">{h.hint}</span>
            </div>
          ))}
        </div>

        <Tabs
          items={[
            { value: 'details', label: 'Details' },
            { value: 'attachments', label: 'Attachments' },
          ]}
          value={tab}
          onValueChange={(next) => onTabChange(next as ClientTab)}
          variant="pill"
          aria-label="Client detail sections"
        />

        {tab === 'details' ? (
          <div className="vc-sections">
            <section className="vc-section">
              <h3 className="t-eyebrow vc-section-title">Payment &amp; verification</h3>
              <div className="vc-facts">
                {paymentFacts.map((f) => (
                  <div className="vc-fact" key={f.k} data-tone={f.tone ?? 'plain'}>
                    <span className="t-eyebrow">{f.k}</span>
                    <span className="vc-fact-v num" data-empty={f.v === '—'}>
                      {f.v}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="vc-section">
              <h3 className="t-eyebrow vc-section-title">Contact &amp; identity</h3>
              {detail.error ? (
                <EmptyState
                  size="panel"
                  tone="error"
                  title="Could not load this carrier's contact details"
                  description={detail.error}
                />
              ) : contactFacts.length === 0 ? (
                <div className="vc-contact">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div className="vc-contact-row" key={i}>
                      <Skeleton variant="text" lines={2} textSize="sm" seed={String(i)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="vc-contact">
                  {contactFacts.map((f) => (
                    <div className="vc-contact-row" key={f.k}>
                      <span className="vc-contact-glyph" aria-hidden="true">
                        <Icon name={f.icon} size="sm" />
                      </span>
                      <span className="vc-contact-text">
                        <span className="t-eyebrow">{f.k}</span>
                        <span
                          className={`vc-contact-v${f.mono ? ' num' : ''}`}
                          data-empty={f.v === '—'}
                          data-danger={f.danger === true}
                        >
                          {f.v}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="vc-attach">
            <p className="vc-attach-hint">
              Files stay with carrier <strong className="num">#{client.carrierId}</strong>, so they
              follow the account across re-verification.
            </p>
            <VerificationClientAttachments carrierId={client.carrierId} load={attachments} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Money, re-exported so the card and the table read the same formatter as the dialog. */
export { money };
