/**
 * One carrier as a card — the roster read a client at a time.
 *
 * The two figures are CONDITIONAL, because which of them is a fact depends on the terms: a prepay
 * carrier has a payment day and no balance, an LOC carrier has a limit, and everyone else has a
 * score. Showing all three with em dashes in the empty slots wastes the card's only two figure
 * positions on facts that do not apply to this carrier.
 */
import { Badge, Icon, type IconName } from '@/ds';
import type { VerificationClientRow } from '@/api/verificationClients';
import {
  activityText,
  isLoc,
  isPrepay,
  money,
  railStyle,
  rowEdge,
  scoreText,
  scoreTone,
  termsIntent,
  termsLabel,
  type ScoreTone,
} from './clientsModel';

interface Figure {
  k: string;
  v: string;
  tone: ScoreTone | 'plain' | 'none';
}

function figuresFor(client: VerificationClientRow): Figure[] {
  if (isPrepay(client)) {
    return [
      { k: 'Payment day', v: client.paymentDay || '—', tone: client.paymentDay ? 'plain' : 'none' },
      { k: 'Credit score', v: scoreText(client), tone: scoreTone(client) },
    ];
  }
  const balance: Figure = {
    k: 'Min. balance',
    v: money(client.minimumRequiredBalance),
    tone: client.minimumRequiredBalance == null ? 'none' : 'plain',
  };
  return [
    balance,
    isLoc(client)
      ? {
          k: 'Credit limit',
          v: money(client.creditLimit),
          tone: client.creditLimit == null ? 'none' : 'plain',
        }
      : { k: 'Credit score', v: scoreText(client), tone: scoreTone(client) },
  ];
}

export function ClientCard({
  client,
  onOpen,
}: {
  client: VerificationClientRow;
  onOpen: (client: VerificationClientRow) => void;
}) {
  const rail = railStyle(client.companyType);

  return (
    <button
      type="button"
      className="vc-card"
      data-edge={rowEdge(client)}
      style={{ ['--vc-rail' as string]: rail.tone }}
      aria-label={`Open ${client.companyName}`}
      onClick={() => onOpen(client)}
    >
      <span className="vc-card-edge" aria-hidden="true" />

      <span className="vc-card-head">
        <span className="vc-rail-chip vc-rail-chip-lg" aria-hidden="true">
          <Icon name={rail.icon as IconName} />
        </span>
        <span className="vc-card-titles">
          <span className="vc-card-name">{client.companyName}</span>
          <span className="vc-card-sub num">
            #{client.carrierId} · {rail.label}
          </span>
        </span>
      </span>

      <span className="vc-card-flags">
        <Badge intent={termsIntent(client)} size="sm">
          {termsLabel(client)}
        </Badge>
        {client.billingCycleTag ? (
          <Badge intent="neutral" size="sm">
            {client.billingCycleTag}
          </Badge>
        ) : null}
        {client.isDebtor ? (
          <Badge intent="danger" size="sm" icon="warning">
            Debtor
          </Badge>
        ) : null}
        {client.isActive ? null : (
          <Badge intent="neutral" size="sm" icon="schedule">
            Inactive
          </Badge>
        )}
      </span>

      <span className="vc-card-figs">
        {figuresFor(client).map((fig) => (
          <span className="vc-card-fig" key={fig.k}>
            <span className="t-eyebrow">{fig.k}</span>
            <span className="vc-card-fig-v num" data-tone={fig.tone}>
              {fig.v}
            </span>
          </span>
        ))}
      </span>

      <span className="vc-card-foot">
        <span>
          Last activity{' '}
          <strong className="num">{activityText(client.lastTransactionAt)}</strong>
        </span>
        <Icon name="chevron_right" size="sm" />
      </span>
    </button>
  );
}
