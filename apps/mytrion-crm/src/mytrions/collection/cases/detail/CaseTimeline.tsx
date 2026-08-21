/**
 * The case activity feed — contact, payments, stage moves and agency events in ONE list.
 *
 * The module had no record of what anyone had done, so this is where `Last touch` and the whole
 * worklist get their input. Newest first, and the composer sits at the top rather than the bottom
 * because logging a call is what a collector came here to do.
 *
 * Filtering is client-side over the loaded page here, unlike everywhere else in the module: a
 * case's feed is bounded (the API caps at 200) and the tabs are a reading aid, not a query.
 */
import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Icon, Tabs, type IconName } from '@/ds';
import {
  CONTACT_CHANNELS,
  listActivity,
  type ActivityKind,
  type ActivityRow,
  type ContactChannel,
} from '@/api/collectionDesk';
import { useCachedLoad } from '../../../_shared/swrCache';
import { TimelineSkeleton } from '../../CollectionSkeletons';
import { LOCALE, moneyExact } from '../../collectionFormat';

/** Tab → the kinds it shows. `all` is the default; the rest group the eight kinds into four reads. */
const FILTERS: ReadonlyArray<{ id: string; label: string; kinds: readonly ActivityKind[] | null }> = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'contact', label: 'Contact', kinds: ['contact', 'note'] },
  { id: 'money', label: 'Payments', kinds: ['payment', 'promise', 'plan'] },
  { id: 'agency', label: 'Agency', kinds: ['agency', 'stage', 'close'] },
];

const KIND_ICON: Record<ActivityKind, IconName> = {
  contact: 'call',
  promise: 'schedule',
  plan: 'payments',
  payment: 'account_balance',
  stage: 'arrow_forward',
  agency: 'send',
  note: 'description',
  close: 'flag',
};

/** Intent carries meaning, never alone — the summary always says the same thing in words. */
function toneOf(row: ActivityRow): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (row.kind === 'payment') return 'success';
  if (row.kind === 'close') return 'danger';
  if (row.kind === 'agency') return 'warning';
  if (row.kind === 'stage' || row.kind === 'plan') return 'info';
  if (row.kind === 'contact' && row.outcome && row.outcome !== 'reached') return 'warning';
  return 'neutral';
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One button per channel: the collector picks how they reached out, not a generic "log". */
const CHANNEL_BUTTON: Record<ContactChannel, { label: string; icon: IconName }> = {
  call: { label: 'Call', icon: 'call' },
  email: { label: 'Email', icon: 'mail' },
  sms: { label: 'SMS', icon: 'chat' },
  letter: { label: 'Letter', icon: 'description' },
};

export function CaseTimeline({
  caseId,
  reloadKey,
  onLogContact,
}: {
  caseId: string;
  /** Bumped by the parent after any write, so the feed re-fetches without owning the mutations. */
  reloadKey: number;
  onLogContact: (channel: ContactChannel) => void;
}) {
  const [filter, setFilter] = useState('all');
  const load = useCallback(() => listActivity(caseId, { limit: 100 }), [caseId]);
  const feed = useCachedLoad(`collection:activity:${caseId}:${reloadKey}`, load);

  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const items = useMemo(() => {
    const all = feed.data?.items ?? [];
    return kinds ? all.filter((row) => kinds.includes(row.kind)) : all;
  }, [feed.data, kinds]);

  return (
    <section className="cc-pane">
      <header className="cc-pane-head">
        <h2 className="cc-pane-title">Activity</h2>
        <Tabs
          variant="pill"
          size="sm"
          aria-label="Filter the activity feed"
          value={filter}
          onValueChange={setFilter}
          items={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
        />
      </header>

      <div className="cc-compose">
        <span className="cc-compose-label">Log</span>
        {CONTACT_CHANNELS.map((c) => (
          <Button
            key={c}
            variant="secondary"
            size="sm"
            icon={CHANNEL_BUTTON[c].icon}
            onClick={() => onLogContact(c)}
          >
            {CHANNEL_BUTTON[c].label}
          </Button>
        ))}
        <span className="cc-compose-hint">
          This is what the worklist reads to decide a case has gone quiet.
        </span>
      </div>

      {feed.loading && !feed.data ? (
        <TimelineSkeleton rows={3} />
      ) : items.length === 0 ? (
        <p className="cc-tl-empty">
          {filter === 'all'
            ? 'Nothing logged yet — the first contact attempt appears here, newest first.'
            : 'Nothing of this kind yet. Switch back to All for the rest of the record.'}
        </p>
      ) : (
        <ol className="cc-tl">
          {items.map((row) => (
            <li key={row.id} className="cc-tl-item">
              <span className="cc-tl-dot" data-tone={toneOf(row)} aria-hidden="true">
                <Icon name={KIND_ICON[row.kind]} size="sm" />
              </span>
              <div className="cc-tl-body">
                <div className="cc-tl-top">
                  <span className="cc-tl-what">{row.summary}</span>
                  {row.amount ? (
                    <Badge intent={row.kind === 'payment' ? 'success' : 'neutral'} size="sm">
                      {moneyExact(row.amount)}
                    </Badge>
                  ) : null}
                  <span className="cc-tl-when num">
                    {when(row.occurredAt)}
                    {row.actorName ? ` · ${row.actorName}` : ''}
                  </span>
                </div>
                {row.contactName ? (
                  <p className="cc-tl-who">Spoke to {row.contactName}</p>
                ) : null}
                {row.note ? <p className="cc-tl-note">{row.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
