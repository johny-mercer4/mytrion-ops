/**
 * Data Center — live vendor search (FMCSA QCMobile + Motus / Socrata).
 *
 * Workspace tab and the open-case chrome both render this. `caseRow` is optional: standalone
 * search has no case; arriving from a case (or `?dot=` / `?mc=` / `?name=`) prefills and does
 * not auto-run. Broker snapshot / Blacklist / CITI Fuel stay Soon.
 * Search is view-only: nothing here writes onto the case (Phase 4's Run still does that).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Icon, Input, Skeleton, Tabs, type BadgeIntent, type TabItem } from '@/ds';
import {
  searchFmcsa,
  type FmcsaCarrierRow,
  type FmcsaSearchBy,
  type FmcsaSearchResult,
  type FmcsaStatusVerdict,
} from '@/api/verificationFmcsa';
import {
  searchMotus,
  type MotusCensusRecord,
  type MotusSearchBy,
  type MotusSearchResult,
} from '@/api/verificationMotus';
import {
  fmcsaCarrierTitle,
  fmcsaCityState,
  fmcsaDetailFacts,
  fmcsaPrefill,
  fmcsaRows,
  fmcsaStatusLabel,
  flattenFields,
  motusCensusFacts,
  motusCensusTitle,
  motusMcLabel,
  motusPrefill,
  type FmcsaPrefillCase,
  type VendorFact,
} from './caseDataCenterModel';
import './caseDataCenter.css';

type Source = 'fmcsa' | 'motus';

const SOURCES: TabItem[] = [
  { value: 'fmcsa', label: 'FMCSA' },
  { value: 'motus', label: 'Motus' },
  { value: 'broker', label: 'Broker snapshot', disabled: true, title: 'Soon' },
  { value: 'blacklist', label: 'Blacklist', disabled: true, title: 'Soon' },
  { value: 'citi', label: 'CITI Fuel', disabled: true, title: 'Soon' },
];

const FMCSA_KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'mc', label: 'MC' },
  { value: 'name', label: 'Name' },
];

const MOTUS_KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'name', label: 'Name' },
];

const FMCSA_PLACEHOLDER: Record<FmcsaSearchBy, string> = {
  dot: 'USDOT',
  mc: 'MC number',
  name: 'Legal name',
};

const MOTUS_PLACEHOLDER: Record<MotusSearchBy, string> = {
  dot: 'USDOT',
  name: 'Legal name',
};

const STATUS_INTENT: Record<FmcsaStatusVerdict, BadgeIntent> = {
  active: 'success',
  inactive: 'danger',
  unknown: 'neutral',
};

function censusStatus(code: MotusCensusRecord['statusCode']): FmcsaStatusVerdict {
  if (code === 'A') return 'active';
  if (code === 'I') return 'inactive';
  return 'unknown';
}

export function CaseDataCenter({ caseRow }: { caseRow?: FmcsaPrefillCase }) {
  const seed = fmcsaPrefill(caseRow ?? {});
  const [source, setSource] = useState<Source>('fmcsa');
  const [by, setBy] = useState<FmcsaSearchBy>(seed.by);
  const [q, setQ] = useState(seed.q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fmcsa, setFmcsa] = useState<FmcsaSearchResult | null>(null);
  const [motus, setMotus] = useState<MotusSearchResult | null>(null);
  const req = useRef(0);
  const keysId = useId();
  const motusBy: MotusSearchBy = by === 'name' ? 'name' : 'dot';

  useEffect(() => {
    const next = source === 'motus' ? motusPrefill(caseRow ?? {}) : fmcsaPrefill(caseRow ?? {});
    setBy(next.by);
    setQ(next.q);
    setFmcsa(null);
    setMotus(null);
    setError(null);
  }, [source, seed.by, seed.q]);

  const changeSource = (next: string): void => {
    if (next === 'fmcsa' || next === 'motus') setSource(next);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = q.trim();
    if (value === '' || busy) return;
    const id = ++req.current;
    setBusy(true);
    setError(null);
    const run =
      source === 'motus'
        ? searchMotus({ by: motusBy, q: value }).then((next) => {
            if (id !== req.current) return;
            setMotus(next);
            setFmcsa(null);
          })
        : searchFmcsa({ by, q: value }).then((next) => {
            if (id !== req.current) return;
            setFmcsa(next);
            setMotus(null);
          });
    void run
      .catch((err: unknown) => {
        if (id !== req.current) return;
        setFmcsa(null);
        setMotus(null);
        setError(err instanceof Error ? err.message : 'Search did not answer.');
      })
      .finally(() => {
        if (id === req.current) setBusy(false);
      });
  };

  const fmcsaRowsList = fmcsa ? fmcsaRows(fmcsa) : [];
  const vendorLine =
    error ??
    (source === 'fmcsa' && fmcsa && !fmcsa.available
      ? fmcsa.error ?? 'FMCSA did not answer.'
      : source === 'motus' && motus && !motus.available
        ? motus.error ?? 'Socrata did not answer.'
        : null);
  const empty =
    source === 'fmcsa'
      ? Boolean(fmcsa?.available && fmcsa.notFound && fmcsaRowsList.length === 0)
      : Boolean(motus?.available && motus.notFound);
  const placeholder = source === 'motus' ? MOTUS_PLACEHOLDER[motusBy] : FMCSA_PLACEHOLDER[by];
  const keyValue = source === 'motus' ? motusBy : by;

  return (
    <div className="va-dc">
      <div className="va-dc-sources">
        <Tabs
          items={SOURCES}
          value={source}
          onValueChange={changeSource}
          size="sm"
          aria-label="Data source"
        />
      </div>

      <div className="va-dc-panel">
        <form className="va-dc-form" onSubmit={submit}>
          <Tabs
            className="va-dc-keys"
            items={source === 'motus' ? MOTUS_KEYS : FMCSA_KEYS}
            value={keyValue}
            onValueChange={(next) => setBy(next as FmcsaSearchBy)}
            variant="pill"
            size="sm"
            idBase={keysId}
            aria-label={source === 'motus' ? 'Socrata key' : 'QCMobile key'}
          />
          <Input
            className="va-dc-q"
            type="search"
            value={q}
            onChange={(event) => setQ(event.currentTarget.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            inputMode={keyValue === 'name' ? 'text' : 'numeric'}
            autoComplete="off"
            fullWidth
          />
          <Button type="submit" variant="primary" icon="search" loading={busy} disabled={q.trim() === ''}>
            Search
          </Button>
        </form>

        {vendorLine ? (
          <p className="va-dc-status" data-tone="danger" role="alert">
            {vendorLine}
          </p>
        ) : null}
        {empty ? (
          <p className="va-dc-status" role="status">
            {source === 'motus' ? 'No carrier in the census.' : 'No carrier in the register.'}
          </p>
        ) : null}
        {busy && fmcsa === null && motus === null ? <ResultsSkeleton label={source === 'motus' ? 'Searching Motus' : 'Searching FMCSA'} /> : null}
        {source === 'fmcsa' && fmcsaRowsList.length > 0 ? (
          <FmcsaResults
            rows={fmcsaRowsList}
            truncated={Boolean(fmcsa?.candidatesTruncated)}
            matchedOn={fmcsa?.matchedOn ?? null}
          />
        ) : null}
        {source === 'motus' && motus?.available ? <MotusResults result={motus} /> : null}
      </div>
    </div>
  );
}

function ResultsSkeleton({ label }: { label: string }) {
  return (
    <div className="va-dc-list" aria-busy="true" aria-label={label}>
      <Skeleton variant="rect" height="64px" radius="control" />
      <Skeleton variant="rect" height="64px" radius="control" />
    </div>
  );
}

function FmcsaResults({
  rows,
  truncated,
  matchedOn,
}: {
  rows: FmcsaCarrierRow[];
  truncated: boolean;
  matchedOn: FmcsaSearchBy | null;
}) {
  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {rows.length === 1 ? '1 carrier' : `${rows.length} carriers`}
        {matchedOn === 'name' ? ' · by name' : matchedOn === 'mc' ? ' · by MC' : matchedOn === 'dot' ? ' · by USDOT' : ''}
        {truncated ? ' · first 50 — refine the name' : ''}
      </p>
      {rows.map((row, index) => (
        <ExpandRow
          key={row.dotNumber ?? `${row.legalName ?? 'row'}-${index}`}
          title={fmcsaCarrierTitle(row)}
          facts={[
            row.dotNumber ? `USDOT ${row.dotNumber}` : null,
            row.dbaName && row.dbaName !== row.legalName ? `DBA ${row.dbaName}` : null,
            fmcsaCityState(row),
          ]}
          badge={fmcsaStatusLabel(row.status)}
          badgeIntent={STATUS_INTENT[row.status]}
          details={fmcsaDetailFacts(row)}
        />
      ))}
    </div>
  );
}

function MotusResults({ result }: { result: MotusSearchResult }) {
  const census = result.census.records;
  const filings = result.insurance?.filings ?? [];
  const agents = result.processAgents?.agents ?? [];
  if (census.length === 0 && filings.length === 0 && agents.length === 0) return null;

  return (
    <div className="va-dc-list">
      <p className="va-dc-meta" role="status">
        {census.length === 1 ? '1 carrier' : `${census.length} carriers`}
        {result.matchedOn === 'name' ? ' · by name' : result.matchedOn === 'dot' ? ' · by USDOT' : ''}
        {result.census.truncated ? ' · first page — refine the name' : ''}
      </p>
      {result.census.error && result.census.available === false ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {result.census.error}
        </p>
      ) : null}
      {census.map((row) => (
        <ExpandRow
          key={row.dotNumber}
          title={motusCensusTitle(row)}
          facts={[
            `USDOT ${row.dotNumber}`,
            motusMcLabel(row),
            row.dbaName && row.dbaName !== row.legalName ? `DBA ${row.dbaName}` : null,
            [row.address.city, row.address.state].filter(Boolean).join(', ') || null,
          ]}
          badge={row.statusLabel ?? 'Unknown'}
          badgeIntent={STATUS_INTENT[censusStatus(row.statusCode)]}
          details={motusCensusFacts(row)}
        />
      ))}
      {result.insurance ? (
        <FrozenBlock
          title="Insurance filings"
          asOf={result.insurance.dataAsOf}
          error={!result.insurance.available ? result.insurance.error : null}
          empty={result.insurance.available && filings.length === 0}
          emptyText="No insurance filings in the snapshot."
        >
          {filings.map((filing, index) => (
            <ExpandRow
              key={`${filing.docketNumber}-${filing.formCode}-${index}`}
              title={filing.formLabel ?? filing.formCode}
              facts={[filing.docketNumber, filing.insurer, filing.status]}
              details={flattenFields(filing.fields, [])}
            />
          ))}
        </FrozenBlock>
      ) : null}
      {result.processAgents ? (
        <FrozenBlock
          title="Process agents"
          asOf={result.processAgents.dataAsOf}
          error={!result.processAgents.available ? result.processAgents.error : null}
          empty={result.processAgents.available && agents.length === 0}
          emptyText="No process-agent rows in the snapshot."
        >
          {agents.map((agent, index) => (
            <ExpandRow
              key={`${agent.docketNumber ?? 'agent'}-${index}`}
              title={agent.agentName ?? 'Process agent'}
              facts={[agent.docketNumber, agent.attnTo, [agent.address.city, agent.address.state].filter(Boolean).join(', ') || null]}
              details={flattenFields(agent.fields, ['co_name'])}
            />
          ))}
        </FrozenBlock>
      ) : null}
    </div>
  );
}

function FrozenBlock({
  title,
  asOf,
  error,
  empty,
  emptyText,
  children,
}: {
  title: string;
  asOf: string;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="va-dc-block">
      <p className="va-dc-meta">
        {title} · frozen as of {asOf || '—'}
      </p>
      {error ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {error}
        </p>
      ) : null}
      {empty ? (
        <p className="va-dc-status" role="status">
          {emptyText}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function ExpandRow({
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

function FactList({ items }: { items: VendorFact[] }) {
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
