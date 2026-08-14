/**
 * Shared controls for the two Admin log tabs (Audit Log, Automation Logs).
 *
 * Both feeds ask the same three questions — narrow by a value read out of the data, narrow by a
 * date window, take the result away as a file — so the controls live here rather than being
 * written twice with two sets of near-identical bugs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DownloadIcon } from '../../components/icons';
import s from './admin.module.css';

/** Relative "when", with the absolute timestamp available on hover via `title`. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

/** Debounce a value — used so typing in the search box doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** The `All …` sentinel. Empty string is the "no filter" value on the wire. */
export const ALL = '';

export function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  allLabel: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className={s.filterField}>
      <span className={s.filterFieldLabel}>{label}</span>
      <select className={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One end of the date window. `type=date` so the native picker does the work on touch. */
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className={s.filterField}>
      <span className={s.filterFieldLabel}>{label}</span>
      <input
        className={s.input}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * `YYYY-MM-DD` → an ISO instant at the local start/end of that day.
 *
 * `end` takes the LAST millisecond, not midnight: a `to` of the same day as `from` must include
 * that whole day, and `new Date('2026-08-14')` is UTC midnight, which on a negative-offset zone is
 * the previous evening — so the naive version silently dropped rows near both edges.
 */
export function dayBoundary(ymd: string, edge: 'start' | 'end'): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date =
    edge === 'start'
      ? new Date(y, mo, d, 0, 0, 0, 0)
      : new Date(y, mo, d, 23, 59, 59, 999);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export type ExportFormat = 'csv' | 'xlsx';

/**
 * Export control. Runs the caller's export for the CURRENT filter — the server re-queries the whole
 * filtered set, so this is never limited to the pages already scrolled into view.
 *
 * The busy state stays on this button (inline spinner, disabled menu) rather than becoming a second
 * page-level loader over a table that is already populated.
 */
export function ExportButton({
  onExport,
  disabled,
  rowHint,
}: {
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
  /** e.g. "1,204 rows match" — shown in the menu so the size is known before committing. */
  rowHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = useCallback(
    async (format: ExportFormat) => {
      setBusy(true);
      setOpen(false);
      try {
        await onExport(format);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Export failed.');
      } finally {
        setBusy(false);
      }
    },
    [onExport],
  );

  return (
    <div className={s.exportWrap} ref={wrapRef}>
      <button
        type="button"
        className={s.ghostBtn}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? (
          <>
            <span className={s.loadingSpin} aria-hidden="true" />
            Exporting…
          </>
        ) : (
          <>
            <DownloadIcon size={14} />
            Export
          </>
        )}
      </button>
      {open && (
        <div className={s.exportMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={s.exportMenuItem}
            onClick={() => void run('xlsx')}
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.exportMenuItem}
            onClick={() => void run('csv')}
          >
            CSV (.csv)
          </button>
          {rowHint && <span className={s.exportMenuNote}>{rowHint}</span>}
        </div>
      )}
    </div>
  );
}

/** Shared "N of M" counter copy for the toolbars. */
export function useCountLabel(shown: number, total: number, noun: string): string {
  return useMemo(
    () =>
      `${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}${total === 1 ? '' : 's'}`,
    [shown, total, noun],
  );
}
