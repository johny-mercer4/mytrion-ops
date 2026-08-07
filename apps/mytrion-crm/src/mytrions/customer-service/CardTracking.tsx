/**
 * Card Tracking — additional card-order shipment tracking (QA 2026-08-07).
 *
 * The Applications "Tracking #" column this replaces was a dead stub: the Applications/Accounts
 * record never carried real tracking data (see ApplicationsTable.tsx's FIELD_GET, which always
 * returned null for it). The real FedEx shipment info lives on the carrier's Deal record
 * (`Tracking_Information` subform) — the same source Sales already reads via the
 * `carrier.trucking_number_request` touchpoint, now also opened to customer-service.
 */
import { useEffect, useState } from 'react';

import { getCardTrackingNumbers, lookupMaintenanceCompanies, type CompanyOption } from '@/api/cs';

interface Shipment {
  id: string;
  trackingNumber: string;
  startDate: string;
  cardsOrdered: string;
}

function trackingUrl(number: string): string {
  const n = number.trim();
  if (!n || n === '—') return '';
  return `https://parcelsapp.com/en/tracking/${encodeURIComponent(n)}`;
}

function fmtWhen(raw: string): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const SEARCH_PATH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';

function BoxIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 8L12 3 3 8l9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function TrackingValue({ number }: { number: string }) {
  const href = trackingUrl(number);
  if (!href) return <span className="cs-ct-value cs-ct-mono">{number}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="cs-ct-link" title="Open shipment status">
      {number}
      <ExternalLinkIcon />
    </a>
  );
}

function EmptyState({
  title,
  hint,
  compact,
}: {
  title: string;
  hint: string;
  compact?: boolean;
}) {
  return (
    <div className={`cs-ct-empty${compact ? ' cs-ct-empty-compact' : ''}`}>
      <div className="cs-ct-empty-icon">
        <BoxIcon size={compact ? 22 : 30} />
      </div>
      <div className="cs-ct-empty-title">{title}</div>
      <div className="cs-ct-empty-hint">{hint}</div>
    </div>
  );
}

export function CardTracking() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [fedexTracking, setFedexTracking] = useState('');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setCompanies([]);
      return;
    }
    const t = setTimeout(() => {
      lookupMaintenanceCompanies(query.trim())
        .then((r) => setCompanies(r.companies))
        .catch(() => setCompanies([]));
    }, 350);
    return () => clearTimeout(t);
  }, [query, selected]);

  function select(c: CompanyOption) {
    setSelected(c);
    setQuery(c.companyName);
    setOpen(false);
    setError('');
    setFedexTracking('');
    setShipments([]);
    setLoading(true);
    getCardTrackingNumbers(c.carrierId)
      .then((r) => {
        setFedexTracking(r.fedexTracking ?? '');
        setShipments(
          (r.trackingInfo ?? []).map((t, i) => ({
            id: `${t.trackingNumber ?? 'tracking'}-${i}`,
            trackingNumber: t.trackingNumber ?? '—',
            startDate: t.startDate ?? '',
            cardsOrdered: t.cardsOrdered == null || t.cardsOrdered === '' ? '—' : String(t.cardsOrdered),
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tracking numbers'))
      .finally(() => setLoading(false));
  }

  function clear() {
    setSelected(null);
    setQuery('');
    setFedexTracking('');
    setShipments([]);
    setError('');
  }

  return (
    <div className="cs-ct-panel">
      <div className="cs-ct-intro">
        <span className="cs-ct-intro-icon">
          <BoxIcon size={18} />
        </span>
        <div>
          <div className="cs-ct-intro-title">Card Tracking</div>
          <div className="cs-ct-intro-sub">FedEx shipment tracking for additional card orders</div>
        </div>
      </div>

      <div className="cs-form-field cs-ct-search">
        <label className="cs-form-label">Company / Carrier ID</label>
        <div className="cs-lookup-wrap cs-ct-search-wrap">
          <svg
            className="cs-ct-search-icon"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SEARCH_PATH} />
          </svg>
          <input
            className="cs-form-input"
            autoComplete="off"
            placeholder="Search company or carrier ID…"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
          />
          {query ? (
            <button
              type="button"
              className="cs-lookup-clear"
              onMouseDown={(e) => {
                e.preventDefault();
                clear();
              }}
            >
              ×
            </button>
          ) : null}
          {open && companies.length > 0 ? (
            <div className="cs-lookup-dropdown">
              {companies.map((c) => (
                <div
                  key={c.carrierId}
                  className="cs-lookup-item cs-mt-company-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(c);
                  }}
                >
                  <span className="cs-mt-company-name">{c.companyName}</span>
                  <span className="cs-mt-company-cid">{c.carrierId}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {!selected ? (
        <EmptyState
          title="Search for a carrier"
          hint="Look up a company or carrier ID above to see its card-order tracking numbers."
        />
      ) : loading ? (
        <div className="cs-ct-results">
          <div className="cs-skeleton cs-ct-skel-hero" />
          <div className="cs-ct-list">
            <div className="cs-skeleton cs-ct-skel-card" />
            <div className="cs-skeleton cs-ct-skel-card" />
          </div>
        </div>
      ) : error ? (
        <div className="cs-form-error">{error}</div>
      ) : (
        <div className="cs-ct-results">
          <div className="cs-ct-selected">
            <span className="cs-ct-selected-name">{selected.companyName}</span>
            <span className="cs-ct-selected-cid">Carrier #{selected.carrierId}</span>
          </div>

          {fedexTracking ? (
            <div className="cs-ct-initial">
              <span className="cs-ct-initial-icon">
                <BoxIcon size={18} />
              </span>
              <div className="cs-ct-initial-body">
                <span className="cs-ct-label">Initial Tracking Number</span>
                <TrackingValue number={fedexTracking} />
              </div>
            </div>
          ) : null}

          {shipments.length === 0 ? (
            <EmptyState
              title="No card shipments found"
              hint="This carrier has no additional-card-order tracking on file."
              compact
            />
          ) : (
            <div className="cs-ct-list">
              {shipments.map((s) => (
                <div key={s.id} className="cs-ct-card">
                  <span className="cs-ct-card-icon">
                    <BoxIcon size={15} />
                  </span>
                  <div className="cs-ct-card-body">
                    <div className="cs-ct-card-row">
                      <span className="cs-ct-label">Tracking Number</span>
                      <TrackingValue number={s.trackingNumber} />
                    </div>
                    <div className="cs-ct-card-grid">
                      <div>
                        <div className="cs-ct-label">Start Date</div>
                        <div className="cs-ct-value">{fmtWhen(s.startDate)}</div>
                      </div>
                      <div>
                        <div className="cs-ct-label">Cards Ordered</div>
                        <div className="cs-ct-value">{s.cardsOrdered}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
