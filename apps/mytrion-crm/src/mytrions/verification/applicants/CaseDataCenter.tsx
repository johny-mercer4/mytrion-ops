/**
 * Data Center — live vendor search (FMCSA QCMobile + Motus / Socrata + DWH snapshot).
 *
 * Workspace tab and the open-case chrome both render this. `caseRow` is optional: standalone
 * search has no case; arriving from a case (or `?dot=` / `?mc=` / `?name=`) prefills and does
 * not auto-run. CITI Fuel is the existing Zoho Deals Citifuel COQL — not CMP live.
 * Search is view-only: nothing here writes onto the case (Phase 4's Run still does that).
 * iSoftPull / Plaid / Highway stay on disk and are omitted while the product switch is off.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Tabs, type TabItem } from '@/ds';
import {
  searchFmcsa,
  type FmcsaSearchBy,
  type FmcsaSearchResult,
} from '@/api/verificationFmcsa';
import {
  searchMotus,
  type MotusSearchBy,
  type MotusSearchResult,
} from '@/api/verificationMotus';
import {
  searchBrokerSnapshot,
  type BrokerSnapshotSearchBy,
  type BrokerSnapshotSearchResult,
} from '@/api/verificationBrokerSnapshot';
import {
  searchBlacklist,
  type BlacklistSearchBy,
  type BlacklistSearchResult,
} from '@/api/verificationBlacklist';
import {
  searchCiti,
  type CitiSearchBy,
  type CitiSearchResult,
} from '@/api/verificationCiti';
import {
  blacklistPrefill,
  brokerPrefill,
  citiPrefill,
  fmcsaPrefill,
  fmcsaRows,
  motusPrefill,
  type FmcsaPrefillCase,
} from './caseDataCenterModel';
import { BlacklistResults } from './CaseDataCenterBlacklist';
import { BrokerResults } from './CaseDataCenterBroker';
import { CITI_KEYS, CITI_PLACEHOLDER, CitiResults } from './CaseDataCenterCiti';
import { HighwayPanel } from './CaseDataCenterHighway';
import { IsoftpullPanel } from './CaseDataCenterIsoftpull';
import { PlaidPanel } from './CaseDataCenterPlaid';
import { FmcsaResults, MotusResults, ResultsSkeleton } from './CaseDataCenterVendors';
import { DATA_CENTER_PAID_VENDORS_ENABLED } from '../dataCenterVendors';
import './caseDataCenter.css';

type SearchSource = 'fmcsa' | 'motus' | 'broker' | 'blacklist' | 'citi';
type Source = SearchSource | 'isoftpull' | 'plaid' | 'highway';

const SEARCH_SOURCES: TabItem[] = [
  { value: 'fmcsa', label: 'FMCSA' },
  { value: 'motus', label: 'Motus' },
  { value: 'broker', label: 'Broker snapshot' },
  { value: 'blacklist', label: 'Blacklist' },
  { value: 'citi', label: 'CITI Fuel' },
];

const PAID_SOURCES: TabItem[] = [
  { value: 'isoftpull', label: 'iSoftPull' },
  { value: 'plaid', label: 'Plaid' },
  { value: 'highway', label: 'Highway' },
];

/** Paid vendor tabs stay on disk; the product switch omits them from the source list. */
const SOURCES: TabItem[] = DATA_CENTER_PAID_VENDORS_ENABLED
  ? [...SEARCH_SOURCES, ...PAID_SOURCES]
  : SEARCH_SOURCES;

function isSearchSource(value: string): value is SearchSource {
  return value === 'fmcsa' || value === 'motus' || value === 'broker' || value === 'blacklist' || value === 'citi';
}

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

const BROKER_KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'name', label: 'Name' },
];

const BROKER_PLACEHOLDER: Record<BrokerSnapshotSearchBy, string> = {
  dot: 'USDOT',
  name: 'Owner name',
};

const BLACKLIST_KEYS: TabItem[] = [
  { value: 'dot', label: 'USDOT' },
  { value: 'mc', label: 'MC' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'name', label: 'Name' },
];

const BLACKLIST_PLACEHOLDER: Record<BlacklistSearchBy, string> = {
  dot: 'USDOT',
  mc: 'MC number',
  email: 'Email',
  phone: 'Phone',
  name: 'Legal name',
};

type SearchBy = FmcsaSearchBy | BlacklistSearchBy | CitiSearchBy;

export function CaseDataCenter({ caseRow }: { caseRow?: FmcsaPrefillCase }) {
  const seed = fmcsaPrefill(caseRow ?? {});
  const [source, setSource] = useState<Source>('fmcsa');
  const [by, setBy] = useState<SearchBy>(seed.by);
  const [q, setQ] = useState(seed.q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fmcsa, setFmcsa] = useState<FmcsaSearchResult | null>(null);
  const [motus, setMotus] = useState<MotusSearchResult | null>(null);
  const [broker, setBroker] = useState<BrokerSnapshotSearchResult | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistSearchResult | null>(null);
  const [citi, setCiti] = useState<CitiSearchResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const req = useRef(0);
  const keysId = useId();
  const motusBy: MotusSearchBy = by === 'name' ? 'name' : 'dot';
  const brokerBy: BrokerSnapshotSearchBy = by === 'name' ? 'name' : 'dot';
  const fmcsaBy: FmcsaSearchBy = by === 'mc' || by === 'name' ? by : 'dot';
  const blacklistBy: BlacklistSearchBy =
    by === 'mc' || by === 'email' || by === 'phone' || by === 'name' ? by : 'dot';
  const citiBy: CitiSearchBy = by === 'mc' || by === 'email' || by === 'name' ? by : 'dot';

  useEffect(() => {
    const next =
      source === 'motus'
        ? motusPrefill(caseRow ?? {})
        : source === 'broker'
          ? brokerPrefill(caseRow ?? {})
          : source === 'blacklist'
            ? blacklistPrefill(caseRow ?? {})
            : source === 'citi'
              ? citiPrefill(caseRow ?? {})
              : fmcsaPrefill(caseRow ?? {});
    setBy(next.by);
    setQ(next.q);
    setFmcsa(null);
    setMotus(null);
    setBroker(null);
    setBlacklist(null);
    setCiti(null);
    setError(null);
    setLoadingMore(false);
  }, [source, seed.by, seed.q]);

  const changeSource = (next: string): void => {
    const paid =
      DATA_CENTER_PAID_VENDORS_ENABLED &&
      (next === 'isoftpull' || next === 'plaid' || next === 'highway');
    if (isSearchSource(next) || paid) {
      setSource(next);
    }
  };

  const clearResults = (): void => {
    setFmcsa(null);
    setMotus(null);
    setBroker(null);
    setBlacklist(null);
    setCiti(null);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = q.trim();
    if (value === '' || busy) return;
    const id = ++req.current;
    setBusy(true);
    setError(null);
    const run =
      source === 'citi'
        ? searchCiti({ by: citiBy, q: value }).then((next) => {
            if (id !== req.current) return;
            setCiti(next);
            setFmcsa(null);
            setMotus(null);
            setBroker(null);
            setBlacklist(null);
          })
        : source === 'blacklist'
        ? searchBlacklist({ by: blacklistBy, q: value }).then((next) => {
            if (id !== req.current) return;
            setBlacklist(next);
            setFmcsa(null);
            setMotus(null);
            setBroker(null);
            setCiti(null);
          })
        : source === 'broker'
          ? searchBrokerSnapshot({ by: brokerBy, q: value }).then((next) => {
              if (id !== req.current) return;
              setBroker(next);
              setFmcsa(null);
              setMotus(null);
              setBlacklist(null);
              setCiti(null);
            })
          : source === 'motus'
            ? searchMotus({ by: motusBy, q: value }).then((next) => {
                if (id !== req.current) return;
                setMotus(next);
                setFmcsa(null);
                setBroker(null);
                setBlacklist(null);
                setCiti(null);
              })
            : searchFmcsa({ by: fmcsaBy, q: value }).then((next) => {
                if (id !== req.current) return;
                setFmcsa(next);
                setMotus(null);
                setBroker(null);
                setBlacklist(null);
                setCiti(null);
              });
    void run
      .catch((err: unknown) => {
        if (id !== req.current) return;
        clearResults();
        setError(err instanceof Error ? err.message : 'Search did not answer.');
      })
      .finally(() => {
        if (id === req.current) setBusy(false);
      });
  };

  const loadMore = (): void => {
    const value = q.trim();
    if (value === '' || busy || loadingMore) return;
    const id = ++req.current;
    setLoadingMore(true);
    setError(null);
    const run =
      source === 'citi' && citi?.pagination.hasMore
        ? searchCiti({
            by: citiBy,
            q: value,
            page: citi.pagination.page + 1,
            pageSize: citi.pagination.pageSize,
          }).then((next) => {
            if (id !== req.current) return;
            if (!next.available) {
              setError(next.error ?? 'Zoho Deals did not answer.');
              return;
            }
            setCiti({ ...next, records: [...citi.records, ...next.records] });
          })
        : source === 'broker' && broker?.pagination.hasMore
          ? searchBrokerSnapshot({
              by: brokerBy,
              q: value,
              page: broker.pagination.page + 1,
              pageSize: broker.pagination.pageSize,
            }).then((next) => {
              if (id !== req.current) return;
              if (!next.available) {
                setError(next.error ?? 'Warehouse did not answer.');
                return;
              }
              setBroker({ ...next, records: [...broker.records, ...next.records] });
            })
          : source === 'blacklist' && blacklist?.debtors.pagination.hasMore
            ? searchBlacklist({
                by: blacklistBy,
                q: value,
                page: blacklist.debtors.pagination.page + 1,
                pageSize: blacklist.debtors.pagination.pageSize,
              }).then((next) => {
                if (id !== req.current) return;
                if (!next.debtors.available) {
                  setError(next.debtors.error ?? 'Warehouse did not answer.');
                  return;
                }
                setBlacklist({
                  ...blacklist,
                  debtors: {
                    ...next.debtors,
                    records: [...blacklist.debtors.records, ...next.debtors.records],
                  },
                });
              })
            : Promise.resolve();
    void run
      .catch((err: unknown) => {
        if (id !== req.current) return;
        setError(err instanceof Error ? err.message : 'Search did not answer.');
      })
      .finally(() => {
        if (id === req.current) setLoadingMore(false);
      });
  };

  const fmcsaRowsList = fmcsa ? fmcsaRows(fmcsa) : [];
  const vendorLine =
    error ??
    (source === 'fmcsa' && fmcsa && !fmcsa.available
      ? fmcsa.error ?? 'FMCSA did not answer.'
      : source === 'motus' && motus && !motus.available
        ? motus.error ?? 'Socrata did not answer.'
        : source === 'broker' && broker && !broker.available
          ? broker.error ?? 'Warehouse did not answer.'
          : source === 'citi' && citi && !citi.available
            ? citi.error ?? 'Zoho Deals did not answer.'
            : null);
  const empty =
    source === 'blacklist'
      ? false
      : source === 'fmcsa'
        ? Boolean(fmcsa?.available && fmcsa.notFound && fmcsaRowsList.length === 0)
        : source === 'motus'
          ? Boolean(motus?.available && motus.notFound)
          : source === 'citi'
            ? Boolean(citi?.available && citi.notFound)
            : Boolean(broker?.available && broker.notFound);
  const placeholder =
    source === 'citi'
      ? CITI_PLACEHOLDER[citiBy]
      : source === 'blacklist'
        ? BLACKLIST_PLACEHOLDER[blacklistBy]
        : source === 'broker'
          ? BROKER_PLACEHOLDER[brokerBy]
          : source === 'motus'
            ? MOTUS_PLACEHOLDER[motusBy]
            : FMCSA_PLACEHOLDER[fmcsaBy];
  const keyValue =
    source === 'citi'
      ? citiBy
      : source === 'blacklist'
        ? blacklistBy
        : source === 'broker'
          ? brokerBy
          : source === 'motus'
            ? motusBy
            : fmcsaBy;
  const keyItems =
    source === 'citi'
      ? CITI_KEYS
      : source === 'blacklist'
        ? BLACKLIST_KEYS
        : source === 'broker'
          ? BROKER_KEYS
          : source === 'motus'
            ? MOTUS_KEYS
            : FMCSA_KEYS;
  const keyLabel =
    source === 'citi'
      ? 'Deal key'
      : source === 'blacklist'
        ? 'Search key'
        : source === 'broker'
          ? 'Snapshot key'
          : source === 'motus'
            ? 'Socrata key'
            : 'QCMobile key';
  const searching =
    source === 'citi'
      ? 'Searching CITI Fuel'
      : source === 'blacklist'
        ? 'Searching blacklist'
        : source === 'broker'
          ? 'Searching snapshot'
          : source === 'motus'
            ? 'Searching Motus'
            : 'Searching FMCSA';
  const inputMode = keyValue === 'email' ? 'email' : keyValue === 'phone' || keyValue === 'name' ? 'text' : 'numeric';

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

      {source === 'isoftpull' ? <IsoftpullPanel {...(caseRow ? { caseRow } : {})} /> : null}
      {source === 'plaid' ? <PlaidPanel /> : null}
      {source === 'highway' ? <HighwayPanel /> : null}

      {isSearchSource(source) ? (
      <div className="va-dc-panel">
        <form className="va-dc-form" onSubmit={submit}>
          <Tabs
            className="va-dc-keys"
            items={keyItems}
            value={keyValue}
            onValueChange={(next) => setBy(next as SearchBy)}
            variant="pill"
            size="sm"
            idBase={keysId}
            aria-label={keyLabel}
          />
          <Input
            className="va-dc-q"
            type="search"
            value={q}
            onChange={(event) => setQ(event.currentTarget.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            inputMode={inputMode}
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
            {source === 'citi'
              ? 'No matching Deal.'
              : source === 'broker'
                ? 'No carrier in the snapshot.'
                : source === 'motus'
                  ? 'No carrier in the census.'
                  : 'No carrier in the register.'}
          </p>
        ) : null}
        {busy && fmcsa === null && motus === null && broker === null && blacklist === null && citi === null ? (
          <ResultsSkeleton label={searching} />
        ) : null}
        {source === 'fmcsa' && fmcsaRowsList.length > 0 ? (
          <FmcsaResults
            rows={fmcsaRowsList}
            truncated={Boolean(fmcsa?.candidatesTruncated)}
            matchedOn={fmcsa?.matchedOn ?? null}
          />
        ) : null}
        {source === 'motus' && motus?.available ? <MotusResults result={motus} /> : null}
        {source === 'blacklist' && blacklist ? (
          <BlacklistResults result={blacklist} loadingMore={loadingMore} onLoadMore={loadMore} />
        ) : null}
        {source === 'citi' && citi?.available ? (
          <CitiResults result={citi} loadingMore={loadingMore} onLoadMore={loadMore} />
        ) : null}
        {source === 'broker' && broker?.available ? (
          <BrokerResults result={broker} loadingMore={loadingMore} onLoadMore={loadMore} />
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
