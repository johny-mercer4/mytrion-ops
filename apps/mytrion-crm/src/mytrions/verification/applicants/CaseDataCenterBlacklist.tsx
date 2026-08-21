/**
 * Data Center Blacklist results — three labeled sections, never one BLOCKED badge.
 *
 * Empty Ban does not hide Duplicates or Debtors. A down probe is a warning on that
 * section, not a clear. Expand lists leftover row fields.
 */
import { useState } from 'react';
import { Badge, Button, Icon, type BadgeIntent } from '@/ds';
import type {
  BlacklistBanHit,
  BlacklistDuplicateHit,
  BlacklistSearchResult,
} from '@/api/verificationBlacklist';
import { flattenFields, type VendorFact } from './caseDataCenterModel';

function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export function BlacklistResults({
  result,
  loadingMore,
  onLoadMore,
}: {
  result: BlacklistSearchResult;
  loadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
}) {
  return (
    <div className="va-dc-list">
      <BanSection result={result} />
      <DuplicateSection result={result} />
      <DebtorSection result={result} loadingMore={loadingMore} onLoadMore={onLoadMore} />
    </div>
  );
}

function BanSection({ result }: { result: BlacklistSearchResult }) {
  const ban = result.ban;
  return (
    <section className="va-dc-block" aria-label="Ban list">
      <p className="va-dc-meta">Ban list</p>
      {!ban.ownAvailable ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          Own list did not answer.
        </p>
      ) : null}
      {!ban.platformAvailable ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {ban.error?.includes('VERIFICATION_DATABASE_URL')
            ? 'Credit Platform list is not configured.'
            : ban.error && !ban.ownAvailable
              ? ban.error
              : 'Credit Platform list did not answer.'}
        </p>
      ) : null}
      {ban.ownAvailable && ban.platformAvailable && ban.hits.length === 0 ? (
        <p className="va-dc-status" role="status">
          No ban-list match.
        </p>
      ) : null}
      {ban.hits.map((hit, index) => (
        <ExpandRow
          key={`${hit.list}-${hit.entryType}-${index}`}
          title={hit.display || hit.entryType}
          facts={[hit.entryType, hit.list === 'own' ? 'Own list' : 'Credit Platform', shortDate(hit.date)]}
          badge={hit.list === 'own' ? 'Own' : 'CP'}
          badgeIntent={hit.list === 'own' ? 'warning' : 'danger'}
          details={banFacts(hit)}
        />
      ))}
    </section>
  );
}

function DuplicateSection({ result }: { result: BlacklistSearchResult }) {
  const dups = result.duplicates;
  return (
    <section className="va-dc-block" aria-label="Duplicates">
      <p className="va-dc-meta">Duplicates</p>
      {!dups.casesAvailable ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          Case scan did not answer.
        </p>
      ) : null}
      {!dups.dealsAvailable ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {dups.error ?? 'Zoho Deals did not answer.'}
        </p>
      ) : null}
      {dups.casesAvailable && dups.dealsAvailable && dups.hits.length === 0 ? (
        <p className="va-dc-status" role="status">
          {result.matchedOn === 'phone'
            ? 'No case duplicate. Deals is not searched by phone.'
            : 'No duplicate case or Deal.'}
        </p>
      ) : null}
      {dups.truncated ? (
        <p className="va-dc-status" role="status">
          More Deal matches than shown.
        </p>
      ) : null}
      {dups.hits.map((hit) => (
        <ExpandRow
          key={`${hit.source}-${hit.id}`}
          title={hit.label}
          facts={[
            hit.source === 'case' ? `Case ${hit.id}` : `Deal ${hit.id}`,
            hit.matchedField,
            hit.stage,
            shortDate(hit.date),
          ]}
          badge={hit.source === 'case' ? 'Case' : 'Deal'}
          badgeIntent="info"
          details={duplicateFacts(hit)}
        />
      ))}
    </section>
  );
}

function DebtorSection({
  result,
  loadingMore,
  onLoadMore,
}: {
  result: BlacklistSearchResult;
  loadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
}) {
  const debtors = result.debtors;
  return (
    <section className="va-dc-block" aria-label="Debtors">
      <p className="va-dc-meta">
        Debtors · outstanding &gt; $100
        {debtors.records.length > 0
          ? ` · ${debtors.records.length === 1 ? '1 carrier' : `${debtors.records.length} carriers`}`
          : ''}
      </p>
      {!debtors.available ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {debtors.error ?? 'Warehouse did not answer.'}
        </p>
      ) : null}
      {debtors.available && debtors.records.length === 0 ? (
        <p className="va-dc-status" role="status">
          No debtor over $100.
        </p>
      ) : null}
      {debtors.records.map((row) => (
        <ExpandRow
          key={row.carrierId}
          title={row.companyName}
          facts={[
            `Carrier ${row.carrierId}`,
            money(row.computedDebt),
            row.computedDebtDays ? `${row.computedDebtDays}d` : null,
            row.openInvoices ? `${row.openInvoices} invoices` : null,
          ]}
          badge={money(row.computedDebt)}
          badgeIntent="danger"
          details={flattenFields(row.fields, [])}
        />
      ))}
      {debtors.pagination.hasMore && onLoadMore ? (
        <LoadMoreButton busy={Boolean(loadingMore)} onClick={onLoadMore} />
      ) : null}
    </section>
  );
}

function banFacts(hit: BlacklistBanHit): VendorFact[] {
  if (hit.fields) return flattenFields(hit.fields, []);
  const out: VendorFact[] = [];
  out.push({ label: 'type', value: hit.entryType });
  out.push({ label: 'display', value: hit.display });
  if (hit.reason) out.push({ label: 'reason', value: hit.reason });
  if (hit.sourceCaseId) out.push({ label: 'source_case', value: hit.sourceCaseId });
  out.push({ label: 'list', value: hit.list });
  if (hit.date) out.push({ label: 'date', value: hit.date });
  return out;
}

function duplicateFacts(hit: BlacklistDuplicateHit): VendorFact[] {
  if (hit.fields) return flattenFields(hit.fields, []);
  const out: VendorFact[] = [];
  out.push({ label: 'matched_field', value: hit.matchedField });
  out.push({ label: hit.source === 'case' ? 'case_id' : 'deal_id', value: hit.id });
  if (hit.stage) out.push({ label: 'stage', value: hit.stage });
  if (hit.date) out.push({ label: 'date', value: hit.date });
  return out;
}

export function LoadMoreButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" loading={busy} onClick={onClick}>
      Load more
    </Button>
  );
}

export function ExpandRow({
  title,
  facts,
  badge,
  badgeIntent,
  details,
}: {
  title: string;
  facts: Array<string | null | undefined>;
  badge?: string;
  badgeIntent?: BadgeIntent;
  details: VendorFact[];
}) {
  const [open, setOpen] = useState(false);
  const shown = facts.filter((fact): fact is string => Boolean(fact?.trim()));

  return (
    <article className="va-dc-row">
      <button
        type="button"
        className="va-dc-row-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="va-dc-row-title">
          <span className="va-dc-row-name">{title}</span>
          <span className="va-dc-row-facts">
            {shown.map((fact) => (
              <span key={fact} className={fact.startsWith('USDOT ') || fact.startsWith('MC ') ? 'num' : undefined}>
                {fact}
              </span>
            ))}
          </span>
        </span>
        <span className="va-dc-row-side">
          {badge ? (
            <Badge intent={badgeIntent ?? 'neutral'} size="sm">
              {badge}
            </Badge>
          ) : null}
          <Icon name="expand_more" size="sm" />
        </span>
      </button>
      {open ? <FactList items={details} /> : null}
    </article>
  );
}

export function FactList({ items }: { items: VendorFact[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="va-dc-detail">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="t-eyebrow">{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
