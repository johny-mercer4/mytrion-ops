/**
 * Data Center — live vendor search, starting with FMCSA (QCMobile).
 *
 * Workspace tab and the open-case chrome both render this. `caseRow` is optional: standalone
 * search has no case; arriving from a case (or `?dot=` / `?mc=` / `?name=`) prefills and does
 * not auto-run. Other sources are listed so the IA is visible; they stay Soon.
 * Search is view-only: nothing here writes onto the case (Phase 4's Run still does that).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Icon, Input, Skeleton, Tabs, type BadgeIntent, type TabItem } from '@/ds';
import {
  searchFmcsa,
  type FmcsaCarrierRow,
  type FmcsaSearchBy,
  type FmcsaSearchResult,
  type FmcsaStatusVerdict,
} from '@/api/verificationFmcsa';
import {
  fmcsaAddress,
  fmcsaAuthorityLabel,
  fmcsaCarrierTitle,
  fmcsaCityState,
  fmcsaFlagLabel,
  fmcsaInsuranceLabel,
  fmcsaPrefill,
  fmcsaRows,
  fmcsaStatusLabel,
  type FmcsaPrefillCase,
} from './caseDataCenterModel';
import './caseDataCenter.css';

const SOURCES: TabItem[] = [
  { value: 'fmcsa', label: 'FMCSA' },
  { value: 'motus', label: 'Motus', disabled: true, title: 'Soon' },
  { value: 'broker', label: 'Broker snapshot', disabled: true, title: 'Soon' },
  { value: 'blacklist', label: 'Blacklist', disabled: true, title: 'Soon' },
  { value: 'citi', label: 'CITI Fuel', disabled: true, title: 'Soon' },
];

const KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'mc', label: 'MC' },
  { value: 'name', label: 'Name' },
];

const PLACEHOLDER: Record<FmcsaSearchBy, string> = {
  dot: 'USDOT',
  mc: 'MC number',
  name: 'Legal name',
};

const STATUS_INTENT: Record<FmcsaStatusVerdict, BadgeIntent> = {
  active: 'success',
  inactive: 'danger',
  unknown: 'neutral',
};

export function CaseDataCenter({ caseRow }: { caseRow?: FmcsaPrefillCase }) {
  const seed = fmcsaPrefill(caseRow ?? {});
  const [by, setBy] = useState<FmcsaSearchBy>(seed.by);
  const [q, setQ] = useState(seed.q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FmcsaSearchResult | null>(null);
  const req = useRef(0);
  const keysId = useId();

  useEffect(() => {
    setBy(seed.by);
    setQ(seed.q);
    setResult(null);
    setError(null);
  }, [seed.by, seed.q]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = q.trim();
    if (value === '' || busy) return;
    const id = ++req.current;
    setBusy(true);
    setError(null);
    void searchFmcsa({ by, q: value })
      .then((next) => {
        if (id !== req.current) return;
        setResult(next);
      })
      .catch((err: unknown) => {
        if (id !== req.current) return;
        setResult(null);
        setError(err instanceof Error ? err.message : 'FMCSA did not answer.');
      })
      .finally(() => {
        if (id === req.current) setBusy(false);
      });
  };

  const rows = result ? fmcsaRows(result) : [];
  const vendorLine =
    error ?? (result && !result.available ? result.error ?? 'FMCSA did not answer.' : null);
  const empty = Boolean(result?.available && result.notFound && rows.length === 0);

  return (
    <div className="va-dc">
      <div className="va-dc-sources">
        <Tabs items={SOURCES} value="fmcsa" onValueChange={() => undefined} size="sm" aria-label="Data source" />
      </div>

      <div className="va-dc-panel">
        <form className="va-dc-form" onSubmit={submit}>
          <Tabs
            className="va-dc-keys"
            items={KEYS}
            value={by}
            onValueChange={(next) => setBy(next as FmcsaSearchBy)}
            variant="pill"
            size="sm"
            idBase={keysId}
            aria-label="QCMobile key"
          />
          <Input
            className="va-dc-q"
            type="search"
            value={q}
            onChange={(event) => setQ(event.currentTarget.value)}
            placeholder={PLACEHOLDER[by]}
            aria-label={PLACEHOLDER[by]}
            inputMode={by === 'name' ? 'text' : 'numeric'}
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
            No carrier in the register.
          </p>
        ) : null}
        {busy && result === null ? <FmcsaResultsSkeleton /> : null}
        {rows.length > 0 ? (
          <FmcsaResults
            rows={rows}
            truncated={Boolean(result?.candidatesTruncated)}
            matchedOn={result?.matchedOn ?? null}
          />
        ) : null}
      </div>
    </div>
  );
}

function FmcsaResultsSkeleton() {
  return (
    <div className="va-dc-list" aria-busy="true" aria-label="Searching FMCSA">
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
        <FmcsaRow key={row.dotNumber ?? `${row.legalName ?? 'row'}-${index}`} row={row} />
      ))}
    </div>
  );
}

function FmcsaRow({ row }: { row: FmcsaCarrierRow }) {
  const [open, setOpen] = useState(false);
  const city = fmcsaCityState(row);
  const address = fmcsaAddress(row);
  const title = fmcsaCarrierTitle(row);

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
            {row.dotNumber ? <span className="num">USDOT {row.dotNumber}</span> : null}
            {row.dbaName && row.dbaName !== row.legalName ? <span>DBA {row.dbaName}</span> : null}
            {city ? <span>{city}</span> : null}
          </span>
        </span>
        <span className="va-dc-row-side">
          <Badge intent={STATUS_INTENT[row.status]} size="sm">
            {fmcsaStatusLabel(row.status)}
          </Badge>
          <Icon name="expand_more" size="sm" />
        </span>
      </button>
      {open ? (
        <dl className="va-dc-detail">
          <Fact label="EIN" value={row.ein} />
          <Fact label="Allowed to operate" value={fmcsaFlagLabel(row.allowedToOperate)} />
          <Fact label="Address" value={address} />
          <Fact label="Operation" value={row.carrierOperationDesc} />
          <Fact label="Common" value={fmcsaAuthorityLabel(row.authority.common)} />
          <Fact label="Contract" value={fmcsaAuthorityLabel(row.authority.contract)} />
          <Fact label="Broker" value={fmcsaAuthorityLabel(row.authority.broker)} />
          <Fact label="BIPD" value={fmcsaInsuranceLabel(row.insurance.bipd)} />
          <Fact label="Bond" value={fmcsaInsuranceLabel(row.insurance.bond)} />
          <Fact label="Cargo" value={fmcsaInsuranceLabel(row.insurance.cargo)} />
          <Fact label="Safety rating" value={row.safetyRating} />
          <Fact label="OOS date" value={row.oosDate} />
        </dl>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value?.trim();
  if (!text) return null;
  return (
    <div>
      <dt className="t-eyebrow">{label}</dt>
      <dd>{text}</dd>
    </div>
  );
}
