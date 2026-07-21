/**
 * CS CITI Folder — Phase 3 bulk confirm / CSV export / mark sent.
 * Distinct from Citifuel Clients (Zoho Citifuel_Clients module).
 */
import { useEffect, useMemo, useState } from 'react';
import type { RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { Toast, type ToastState } from '../Toast';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';

function toastMsg(kind: ToastState['kind'], message: string): ToastState {
  return { id: Date.now(), kind, message };
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  const run = async (fn: () => Promise<void>, ok: string): Promise<void> => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    try {
      await fn();
      setToast(toastMsg('success', ok));
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
          <h2 className="cs-panel-title">CITI Folder</h2>
          <p className="cs-panel-sub">
            Phase 3 deals · bulk review + CSV handoff (not Citifuel Clients)
          </p>
        </div>
        <button type="button" className="cs-btn cs-btn-ghost" onClick={() => feed.reload()}>
          Refresh
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
                const out = await csRetention.citiExport(selected);
                downloadCsv(
                  out.csv,
                  `citi-export-${new Date().toISOString().slice(0, 10)}.csv`,
                );
                if (out.zohoFailures.length > 0) {
                  setToast(
                    toastMsg(
                      'warning',
                      `Exported ${out.exported}; ${out.zohoFailures.length} Zoho stage write(s) failed`,
                    ),
                  );
                }
              }, `Exported ${selected.length} deal(s)`)
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

      <div className="cs-table-wrap">
        <table className="cs-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th>Company</th>
              <th>Carrier</th>
              <th>Status</th>
              <th>Entered</th>
              <th>Hold until</th>
              <th>Cycle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td>{c.companyName || '—'}</td>
                <td>{c.carrierId}</td>
                <td>
                  <span className="cs-badge cs-badge-warning">{c.statusCode}</span>
                </td>
                <td>
                  {c.citiFolderEnteredAt
                    ? new Date(c.citiFolderEnteredAt).toLocaleDateString()
                    : '—'}
                </td>
                <td>
                  {c.citiFolderHoldUntil
                    ? new Date(c.citiFolderHoldUntil).toLocaleDateString()
                    : '—'}
                </td>
                <td>
                  {c.assignmentCount}/3
                </td>
              </tr>
            ))}
            {rows.length === 0 && !feed.loading ? (
              <tr>
                <td colSpan={7} className="cs-empty">
                  CITI Folder is empty
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
