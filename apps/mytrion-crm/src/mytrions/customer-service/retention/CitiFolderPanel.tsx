/**
 * CS CITI Folder — Phase 3 bulk confirm / CSV export / mark sent.
 * Distinct from Citifuel Clients (Zoho Citifuel_Clients module).
 */
import { useEffect, useMemo, useState } from 'react';
import { Folder, RefreshCw } from 'lucide-react';
import type { RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { Toast, type ToastState } from '../Toast';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';
import { CaseBadge, statusLabel, statusTone } from './casesUi';
import { DataTable, type DataColumn } from '@/ds';

function toastMsg(kind: ToastState['kind'], message: string): ToastState {
  return { id: Date.now(), kind, message };
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Firefox ignores a click on an anchor that isn't in the document, and revoking the URL in the
  // same tick can cancel a download that hasn't started reading yet — hence append + deferred revoke.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

export function CitiFolderPanel() {
  const feed = useLoad(() => csRetention.citiList(200), []);
  const [rows, setRows] = useState<RetentionCaseRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  const reload = feed.reload;
  useEffect(() => {
    return subscribeCsRetentionLive(() => {
      reload();
    });
  }, [reload]);

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.includes(id));

  const toggle = (id: string): void =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const toggleAll = (): void => setSelected(allChecked ? [] : allIds.slice());

  /**
   * Memoised on the two things it closes over — DataTable memoises its rows on `columns` identity,
   * so an array rebuilt every render would re-render every row on every keystroke elsewhere.
   *
   * MOBILE ROLES — this desk is a bulk queue, not a browser: the checkbox takes the card's leading
   * slot, the company names the row, carrier and entry date identify it, and status is the one
   * value. Hold-until and cycle count are review detail and stay in the table.
   */
  const COLUMNS = useMemo<DataColumn<RetentionCaseRow>[]>(
    () => [
      {
        id: 'select',
        header: (
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            aria-label={allChecked ? 'Deselect all deals' : 'Select all deals'}
            disabled={rows.length === 0}
          />
        ),
        width: '2.5rem',
        align: 'center',
        mobile: 'leading',
        // Off the record sheet: a checkbox in a key-value list is a control pretending to be data.
        detail: false,
        cell: (c) => (
          <input
            type="checkbox"
            checked={selected.includes(c.id)}
            onChange={() => toggle(c.id)}
            aria-label={`Select ${c.companyName || c.carrierId}`}
          />
        ),
      },
      {
        id: 'company',
        header: 'Company',
        rowHeader: true,
        mobile: 'primary',
        cell: (c) => <span className="cs-citi-company">{c.companyName || '—'}</span>,
      },
      {
        id: 'carrier',
        header: 'Carrier',
        mobile: 'secondary',
        cell: (c) => <span className="cs-pool-mono">{c.carrierId}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        mobile: 'value',
        // Was `{c.statusCode}` — the raw enum (e.g. "p3_hold") leaked into the UI.
        cell: (c) => <CaseBadge tone={statusTone(c.statusCode)}>{statusLabel(c.statusCode)}</CaseBadge>,
      },
      {
        id: 'entered',
        header: 'Entered',
        mobile: 'secondary',
        cell: (c) =>
          c.citiFolderEnteredAt ? new Date(c.citiFolderEnteredAt).toLocaleDateString() : '—',
      },
      {
        id: 'hold',
        header: 'Hold until',
        priority: 2,
        cell: (c) =>
          c.citiFolderHoldUntil ? new Date(c.citiFolderHoldUntil).toLocaleDateString() : '—',
      },
      {
        id: 'cycle',
        header: 'Cycle',
        priority: 2,
        numeric: true,
        cell: (c) => <span className="cs-pool-mono">{c.assignmentCount}/3</span>,
      },
    ],
    [allChecked, rows.length, selected],
  );

  /**
   * `fn` may return its own toast (e.g. the export's partial-failure warning); when it does we show
   * that instead of the generic success line. Previously the action set a warning toast and `run`
   * immediately overwrote it with "Exported N deal(s)", so partial Zoho write failures were silent.
   */
  const run = async (
    fn: () => Promise<ToastState | void>,
    ok: string,
  ): Promise<void> => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    try {
      const override = await fn();
      setToast(override ?? toastMsg('success', ok));
      setSelected([]);
      feed.reload();
    } catch (e) {
      setToast(toastMsg('error', e instanceof Error ? e.message : 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-panel">
      <div className="cs-panel-header">
        <div>
          <div className="cs-section-kicker">
            <Folder size={13} strokeWidth={2.3} aria-hidden />
            Phase 3 · CITI handoff
          </div>
          <h2 className="cs-panel-title">CITI Folder</h2>
          <p className="cs-panel-sub">
            Phase 3 deals · bulk review + CSV handoff (not Citifuel Clients)
          </p>
        </div>
        <button
          type="button"
          className={`cs-btn cs-btn-ghost${feed.refreshing ? ' is-spinning' : ''}`}
          onClick={() => feed.refresh()}
          disabled={feed.refreshing || busy}
        >
          <RefreshCw
            size={14}
            strokeWidth={2.3}
            aria-hidden
            className={feed.refreshing ? 'cs-ret-spin' : undefined}
          />
          {feed.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="cs-ret-bulk-bar">
        <span className="cs-muted">
          {selected.length} selected · {rows.length} in folder
        </span>
        <div className="cs-ret-bulk-actions">
          <button
            type="button"
            className="cs-btn cs-btn-ghost"
            disabled={!selected.length || busy}
            onClick={() =>
              void run(async () => {
                await csRetention.citiConfirm(selected);
              }, 'Confirmed for batch review')
            }
          >
            Confirm batch
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            disabled={!selected.length || busy}
            onClick={() =>
              void run(async () => {
                const count = selected.length;
                const out = await csRetention.citiExport(selected);
                downloadCsv(out.csv, `citi-export-${new Date().toISOString().slice(0, 10)}.csv`);
                // Surface partial Zoho failures instead of letting the success line bury them.
                return out.zohoFailures.length > 0
                  ? toastMsg(
                      'warning',
                      `Exported ${out.exported}; ${out.zohoFailures.length} Zoho stage write(s) failed`,
                    )
                  : toastMsg('success', `Exported ${count} deal(s)`);
              }, 'Exported')
            }
          >
            Export CSV
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-danger"
            disabled={!selected.length || busy}
            onClick={() =>
              void run(async () => {
                await csRetention.citiMarkSent(selected);
              }, 'Marked sent — closed')
            }
          >
            Mark sent
          </button>
        </div>
      </div>

      {feed.error ? <div className="cs-banner-danger">{feed.error}</div> : null}

      <DataTable
        caption="Deals in the CITI Folder"
        rows={rows}
        rowKey={(c) => c.id}
        columns={COLUMNS}
        scrollerClassName="cs-table-wrap"
        className="cs-table"
        selected={(c) => selected.includes(c.id)}
        loading={rows.length === 0 && feed.loading}
        empty="CITI Folder is empty"
        /* No row activation: this table's whole job is bulk selection for "Mark sent". A row that
           also opened something would put two targets under one thumb. */
      />

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
