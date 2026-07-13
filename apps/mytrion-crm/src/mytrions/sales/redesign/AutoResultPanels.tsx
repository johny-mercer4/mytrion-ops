/**
 * Automations result panels — invoices (bulk PDF/Excel) + transactions report download.
 * Report options mirror self-service automation-modal.template.js (Display / Output / Match By).
 */
import { useMemo, useState } from 'react';
import { s, Badge } from './dc';
import { badge, type BadgeVM } from './salesData';
import { money } from './live';
import type { InvRow } from './autoLive';
import { downloadInvoice, downloadInvoicesSequential } from './autoRunners';
import {
  DEFAULT_TXN_OPTS,
  TXN_FORMAT_OPTIONS,
  TXN_GROUP_BY_OPTIONS,
  TXN_SORT_BY_OPTIONS,
  groupTransactions,
  processTransactions,
  type TxnExportOptions,
  type TxnFormat,
  type TxnGroupBy,
  type TxnReportState,
  type TxnSortBy,
} from './txnReport';
import { downloadTxnReport } from './txnReportExport';

const mono = "font-family:'JetBrains Mono',monospace";
const inp42 = 'width:100%;height:42px;padding:0 12px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const sectionLabel = 'font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:10px';
const chipOn = 'padding:5px 10px;border-radius:999px;border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);font-size:11.5px;font-weight:700;cursor:pointer';
const chipOff = 'padding:5px 10px;border-radius:999px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:11.5px;font-weight:600;cursor:pointer';

function statusBadge(status: string): BadgeVM {
  const x = status.toLowerCase();
  if (x.includes('paid')) return badge('Paid', 'var(--ok)');
  if (x.includes('overdue') || x.includes('pending')) return badge(status, 'var(--warn)');
  return badge(status || '—', 'var(--muted)');
}

export function AutoInvoicesPanel({
  rows,
}: {
  rows: InvRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [panelMsg, setPanelMsg] = useState<{ title: string; body: string; type: 'success' | 'error' } | null>(null);

  const allIds = useMemo(() => rows.map((r) => r.id).filter(Boolean), [rows]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const onOne = (row: InvRow, type: 'pdf' | 'excel') => {
    if (!row.id) return;
    setDlBusy(`${row.id}-${type}`);
    setPanelMsg(null);
    downloadInvoice(row.id, type, row.inv)
      .then(() => setPanelMsg({ title: 'Download', body: `${type.toUpperCase()} for ${row.inv}`, type: 'success' }))
      .catch((err: unknown) => setPanelMsg({ title: 'Download failed', body: err instanceof Error ? err.message : String(err), type: 'error' }))
      .finally(() => setDlBusy(null));
  };

  const onBulk = (type: 'pdf' | 'excel') => {
    const list = rows.filter((r) => selected.has(r.id) && r.id);
    if (!list.length) {
      setPanelMsg({ title: 'Invoices', body: 'Select at least one invoice.', type: 'error' });
      return;
    }
    setDlBusy(`bulk-${type}`);
    setPanelMsg(null);
    downloadInvoicesSequential(list, type, (msg) => setPanelMsg({ title: 'Downloading', body: msg, type: 'success' }))
      .then(({ ok, fail }) => {
        if (fail === 0) setPanelMsg({ title: 'Downloaded', body: `${ok} invoice(s) (${type.toUpperCase()}).`, type: 'success' });
        else if (ok === 0) setPanelMsg({ title: 'Download failed', body: 'Could not download the selected invoice(s).', type: 'error' });
        else setPanelMsg({ title: 'Partial', body: `Downloaded ${ok}, ${fail} failed.`, type: 'error' });
      })
      .finally(() => setDlBusy(null));
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      {panelMsg && (
        <div style={s(`padding:12px 14px;border-radius:11px;background:color-mix(in srgb,var(--${panelMsg.type === 'error' ? 'danger' : 'ok'}) 12%,transparent);border:1px solid color-mix(in srgb,var(--${panelMsg.type === 'error' ? 'danger' : 'ok'}) 30%,transparent);font-size:12.5px;color:var(--${panelMsg.type === 'error' ? 'danger' : 'ok'});line-height:1.5;display:flex;justify-content:space-between;align-items:flex-start`)}>
          <div>
            <strong style={s('display:block;margin-bottom:2px')}>{panelMsg.title}</strong>
            {panelMsg.body}
          </div>
          <button onClick={() => setPanelMsg(null)} style={s('background:none;border:none;cursor:pointer;color:inherit;opacity:0.7;padding:4px')} aria-label="Dismiss">✕</button>
        </div>
      )}
      <div style={s('display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between')}>
        <label style={s('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text2);cursor:pointer')}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all ({selected.size})
        </label>
        <div style={s('display:flex;gap:8px')}>
          <button
            type="button"
            disabled={dlBusy !== null || selected.size === 0}
            onClick={() => onBulk('pdf')}
            style={s('height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:var(--alt);font-size:11.5px;font-weight:700;cursor:pointer;color:var(--text)')}
          >
            {dlBusy === 'bulk-pdf' ? '…' : 'Download Selected PDF'}
          </button>
          <button
            type="button"
            disabled={dlBusy !== null || selected.size === 0}
            onClick={() => onBulk('excel')}
            style={s('height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:var(--alt);font-size:11.5px;font-weight:700;cursor:pointer;color:var(--text)')}
          >
            {dlBusy === 'bulk-excel' ? '…' : 'Download Selected Excel'}
          </button>
        </div>
      </div>
      <div style={s('border-radius:13px;border:1px solid var(--border);overflow:hidden')}>
        <div style={s('display:grid;grid-template-columns:28px 1.2fr 1fr 0.9fr auto auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
          <span />
          <span>Invoice</span>
          <span>Date</span>
          <span style={s('text-align:right')}>Amount</span>
          <span>Status</span>
          <span />
        </div>
        {rows.map((r) => (
          <div
            key={r.inv + r.id}
            className="ss-row-h"
            style={s('display:grid;grid-template-columns:28px 1.2fr 1fr 0.9fr auto auto;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}
          >
            <input type="checkbox" checked={selected.has(r.id)} disabled={!r.id} onChange={() => toggle(r.id)} />
            <span style={s(`${mono};color:var(--accent)`)}>{r.inv}</span>
            <span style={s('color:var(--text2)')}>{r.date}</span>
            <span style={s(`text-align:right;${mono};font-weight:600`)}>{r.amount}</span>
            <Badge vm={statusBadge(r.status)} />
            <span style={s('display:flex;gap:4px')}>
              {(['pdf', 'excel'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={!r.id || dlBusy !== null}
                  onClick={() => onOne(r, t)}
                  style={s('padding:4px 8px;border-radius:7px;border:1px solid var(--border);background:var(--alt);font-size:10px;font-weight:700;text-transform:uppercase;cursor:pointer;color:var(--text2)')}
                >
                  {dlBusy === `${r.id}-${t}` ? '…' : t}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DISPLAY_CHECKS: Array<[keyof TxnExportOptions, string]> = [
  ['pageBreak', 'Page break per group'],
  ['removeDetails', 'Remove details'],
  ['grandTotalOnly', 'Grand total only'],
  ['removeGroupSummary', 'Remove group summary'],
  ['showEntireCardNumber', 'Show entire card number'],
  ['showTransactionTime', 'Show transaction time'],
  ['retailPriceOnly', 'Retail price only'],
  ['showDiscount', 'Show discount'],
  ['showDiscountDetail', 'Show discount detail'],
  ['addDataCaptureFee', 'Add data capture fee'],
  ['negativeOnly', 'Show only negative amounts'],
];

export function AutoTransactionsPanel({
  report,
  splitLayout = false,
}: {
  report: TxnReportState | null;
  /** When true (Automations modal results), options stay in a dedicated scroll pane above the list. */
  splitLayout?: boolean;
}) {
  const [opts, setOpts] = useState<TxnExportOptions>({
    ...DEFAULT_TXN_OPTS,
    match: { ...DEFAULT_TXN_OPTS.match },
    chainNames: [],
  });
  const [busy, setBusy] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ title: string; body: string; type: 'success' | 'error' } | null>(null);

  const set = <K extends keyof TxnExportOptions>(k: K, v: TxnExportOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const setBool = (k: (typeof DISPLAY_CHECKS)[number][0], v: boolean) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const setMatch = (k: keyof TxnExportOptions['match'], v: string) =>
    setOpts((o) => ({ ...o, match: { ...o.match, [k]: v } }));

  const processed = useMemo(
    () => (report ? processTransactions(report.transactions, opts) : []),
    [report, opts],
  );
  const groups = useMemo(() => groupTransactions(processed, opts.groupBy), [processed, opts.groupBy]);

  const stateOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of report?.transactions ?? []) {
      const st = String(t.locationState || '').trim().toUpperCase();
      if (st) seen.add(st);
    }
    return Array.from(seen).sort();
  }, [report]);

  const productOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of report?.transactions ?? []) {
      for (const li of t.lineItems) {
        const c = String(li.category || '').trim().toUpperCase();
        if (c && c !== '—') seen.add(c);
      }
    }
    return Array.from(seen).sort();
  }, [report]);

  const chainOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of report?.transactions ?? []) {
      const c = String(t.chainName || '').trim();
      if (c) seen.add(c);
    }
    return Array.from(seen).sort();
  }, [report]);

  const liveTotals = useMemo(
    () => ({
      count: processed.length,
      funded: processed.reduce((sum, t) => sum + (t.fundedTotal || 0), 0),
      discount: processed.reduce((sum, t) => sum + (t.discAmount || 0), 0),
      gallons: processed.reduce((sum, t) => sum + (t.fuelQuantity || 0), 0),
    }),
    [processed],
  );

  const onDownload = () => {
    if (!report) {
      setPanelMsg({ title: 'Report', body: 'Fetch transactions first.', type: 'error' });
      return;
    }
    setBusy(true);
    setPanelMsg(null);
    downloadTxnReport(report, opts)
      .then(() => setPanelMsg({ title: 'Download', body: `Transactions ${opts.format.toUpperCase()} started.`, type: 'success' }))
      .catch((err: unknown) => setPanelMsg({ title: 'Export failed', body: err instanceof Error ? err.message : String(err), type: 'error' }))
      .finally(() => setBusy(false));
  };

  const toggleChain = (c: string) => {
    setOpts((o) => {
      const has = o.chainNames.includes(c);
      return {
        ...o,
        chainNames: has ? o.chainNames.filter((x) => x !== c) : [...o.chainNames, c],
      };
    });
  };

  const optionsBlock = report && report.transactions.length > 0 ? (
    <div style={s('padding:14px;border-radius:13px;border:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;gap:16px')}>
      {panelMsg && (
        <div style={s(`padding:12px 14px;border-radius:11px;background:color-mix(in srgb,var(--${panelMsg.type === 'error' ? 'danger' : 'ok'}) 12%,transparent);border:1px solid color-mix(in srgb,var(--${panelMsg.type === 'error' ? 'danger' : 'ok'}) 30%,transparent);font-size:12.5px;color:var(--${panelMsg.type === 'error' ? 'danger' : 'ok'});line-height:1.5;display:flex;justify-content:space-between;align-items:flex-start`)}>
          <div>
            <strong style={s('display:block;margin-bottom:2px')}>{panelMsg.title}</strong>
            {panelMsg.body}
          </div>
          <button onClick={() => setPanelMsg(null)} style={s('background:none;border:none;cursor:pointer;color:inherit;opacity:0.7;padding:4px')} aria-label="Dismiss">✕</button>
        </div>
      )}
      <div>
        <div style={s(sectionLabel)}>
          Display Features <span style={s('font-weight:500;text-transform:none;letter-spacing:0;opacity:.7')}>optional</span>
        </div>
        <div style={s('display:flex;flex-wrap:wrap;gap:12px 16px;font-size:12px;color:var(--text2)')}>
          {DISPLAY_CHECKS.map(([key, label]) => (
            <label key={key} style={s('display:flex;align-items:center;gap:6px;cursor:pointer;min-width:180px')}>
              <input
                type="checkbox"
                checked={Boolean(opts[key])}
                onChange={(e) => setBool(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div style={s(sectionLabel)}>Output</div>
        <div style={s('display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px')}>
          <div>
            <div style={s(labelCss)}>Group by</div>
            <select value={opts.groupBy} onChange={(e) => set('groupBy', e.target.value as TxnGroupBy)} className="ss-in" style={s(inp42)}>
              {TXN_GROUP_BY_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={s(labelCss)}>Sort by</div>
            <select value={opts.sortBy} onChange={(e) => set('sortBy', e.target.value as TxnSortBy)} className="ss-in" style={s(inp42)}>
              {TXN_SORT_BY_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={s(labelCss)}>View format</div>
            <select value={opts.format} onChange={(e) => set('format', e.target.value as TxnFormat)} className="ss-in" style={s(inp42)}>
              {TXN_FORMAT_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <div style={s(sectionLabel)}>
          Match By <span style={s('font-weight:500;text-transform:none;letter-spacing:0;opacity:.7')}>optional</span>
        </div>
        <div style={s('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px')}>
          {(
            [
              ['cardNumber', 'Card Number', 'Any part of the card #'],
              ['invoice', 'Invoice', 'Invoice #'],
              ['locationId', 'Location ID', 'EFS location id'],
              ['driverName', 'Driver Name', 'Driver name'],
              ['driverId', 'Driver ID', 'Driver id'],
              ['unit', 'Unit', 'Unit #'],
              ['city', 'City', 'City'],
            ] as const
          ).map(([key, label, ph]) => (
            <div key={key}>
              <div style={s(labelCss)}>{label}</div>
              <input
                value={opts.match[key]}
                onChange={(e) => setMatch(key, e.target.value)}
                placeholder={ph}
                className="ss-in"
                style={s(inp42)}
              />
            </div>
          ))}
          <div>
            <div style={s(labelCss)}>State / Province</div>
            <select value={opts.stateProvince} onChange={(e) => set('stateProvince', e.target.value)} className="ss-in" style={s(inp42)}>
              <option value="">All</option>
              {stateOptions.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={s(labelCss)}>Item</div>
            <select value={opts.product} onChange={(e) => set('product', e.target.value)} className="ss-in" style={s(inp42)}>
              <option value="">All products</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        {chainOptions.length > 0 && (
          <div style={s('display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px')}>
            <span style={s(labelCss + ';margin:0')}>Chain</span>
            {chainOptions.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleChain(c)}
                style={s(opts.chainNames.includes(c) ? chipOn : chipOff)}
              >
                {c}
              </button>
            ))}
            {opts.chainNames.length > 0 && (
              <button type="button" onClick={() => set('chainNames', [])} style={s(chipOff)}>Clear</button>
            )}
          </div>
        )}
        <label style={s('display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--text2);cursor:pointer')}>
          <input type="checkbox" checked={opts.exactMatch} onChange={(e) => set('exactMatch', e.target.checked)} />
          Exact match on Match By fields
        </label>
      </div>

      <div style={s('display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between')}>
        <span style={s('font-size:12.5px;color:var(--muted)')}>
          {processed.length} of {report.transactions.length} shown
        </span>
        <button
          type="button"
          disabled={busy || !report || processed.length === 0}
          onClick={onDownload}
          className="ss-btn-p"
          style={s('height:42px;padding:0 18px;border-radius:11px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13px;cursor:pointer')}
        >
          {busy ? 'Generating…' : `Download ${opts.format.toUpperCase()}`}
        </button>
      </div>
    </div>
  ) : null;

  const listBlock = !report?.transactions.length ? (
    <div style={s('padding:24px;text-align:center;color:var(--muted);font-size:13px')}>
      No transactions in this range.
    </div>
  ) : groups.length === 0 ? (
    <div style={s('padding:24px;text-align:center;color:var(--muted);font-size:13px')}>
      No transactions match the selected filters.
    </div>
  ) : (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      {groups.map((g) => (
        <div key={g.key} style={s('border-radius:13px;border:1px solid var(--border);overflow:hidden')}>
          <div style={s('display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--alt);font-size:12.5px')}>
            <span style={s(`${mono};font-weight:700`)}>
              {g.isCard
                ? (opts.showEntireCardNumber ? g.cardNumber : `•••• ${String(g.cardNumber).slice(-4)}`)
                : g.label}
            </span>
            <span style={s('color:var(--muted)')}>
              {g.transactions.length} txn{g.transactions.length !== 1 ? 's' : ''} ·{' '}
              {money(g.transactions.reduce((sum, t) => sum + t.fundedTotal, 0))}
            </span>
          </div>
          <div style={s('display:grid;grid-template-columns:0.9fr 1fr 1.2fr 0.8fr 0.9fr;gap:8px;padding:8px 14px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
            <span>Date</span>
            <span>Card</span>
            <span>Driver</span>
            <span style={s('text-align:right')}>Gallons</span>
            <span style={s('text-align:right')}>Amount</span>
          </div>
              {g.transactions.slice(0, 40).map((tx) => (
                <div
                  key={tx.id}
                  className="ss-row-h"
                  style={s('display:grid;grid-template-columns:0.9fr 1fr 1.2fr 0.8fr 0.9fr;gap:8px;padding:10px 14px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}
                >
              <span style={s('color:var(--text2)')}>{String(tx.transactionDate).slice(0, 10)}</span>
              <span style={s(mono)}>
                {opts.showEntireCardNumber ? tx.cardNumber : `•••• ${String(tx.cardNumber).slice(-4)}`}
              </span>
              <span style={s('color:var(--text2)')}>{tx.driverName || '—'}</span>
              <span style={s(`text-align:right;${mono}`)}>{tx.fuelQuantity ? tx.fuelQuantity.toFixed(1) : '—'}</span>
              <span style={s(`text-align:right;${mono};font-weight:600`)}>{money(tx.fundedTotal)}</span>
            </div>
          ))}
          {g.transactions.length > 40 && (
            <div style={s('padding:8px 14px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--border2)')}>
              +{g.transactions.length - 40} more in this group (included in download)
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const shell = splitLayout
    ? 'flex:1;min-height:0;display:flex;flex-direction:column;gap:12px'
    : 'display:flex;flex-direction:column;gap:14px';

  return (
    <div style={s(shell)}>
      <div style={s(splitLayout ? 'flex-shrink:0' : '')}>
        <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:10px')}>
          {[
            ['Txns', String(liveTotals.count)],
            ['Funded', money(liveTotals.funded)],
            ['Discount', money(liveTotals.discount)],
            ['Gallons', liveTotals.gallons ? liveTotals.gallons.toFixed(1) : '—'],
          ].map(([k, v]) => (
            <div key={k} style={s('padding:12px;border-radius:11px;background:var(--alt);border:1px solid var(--border2)')}>
              <div style={s(labelCss)}>{k}</div>
              <div style={s(`${mono};font-size:15px;font-weight:700`)}>{v}</div>
            </div>
          ))}
        </div>
        {report?.moreRecords && (
          <div style={s('margin-top:10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);font-size:12px;color:var(--text2)')}>
            Showing a fetched subset — server totals may be higher. Export uses filtered rows from the fetched set (up to 5,000 line items).
          </div>
        )}
      </div>

      {optionsBlock && (
        <div
          className="ss-scroll"
          style={s(splitLayout
            ? 'flex:0 1 auto;max-height:min(46vh,420px);min-height:160px;overflow-y:auto;padding-right:2px'
            : '')}
        >
          {optionsBlock}
        </div>
      )}

      <div
        className={splitLayout ? 'ss-scroll' : undefined}
        style={s(splitLayout ? 'flex:1;min-height:0;overflow-y:auto;padding-right:2px' : '')}
      >
        {listBlock}
      </div>
    </div>
  );
}
