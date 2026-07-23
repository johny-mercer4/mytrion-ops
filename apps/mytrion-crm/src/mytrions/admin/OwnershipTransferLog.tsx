/**
 * Admin Deals — Transfer log pane (Mytrion Ops `retention_ownership_transfers`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listOwnershipTransferLogs,
  type OwnershipTransferLog,
} from '../../api/adminDeals';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import { RefreshIcon } from '../../components/icons';
import { relativeTime } from './dealsHelpers';
import { adminToast } from './toast';
import s from './admin.module.css';

const SKELETON = ['18%', '28%', '22%', '22%', '14%', '12%'] as const;

function ownerLabel(name: string | null, id: string | null): string {
  if (name?.trim()) return name.trim();
  if (id?.trim()) return id.trim();
  return '—';
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'admin_manual':
      return 'Admin';
    case 'retention_handoff':
      return 'Retention handoff';
    case 'open_pool_claim':
      return 'Open Pool claim';
    case 'manual_revert':
      return 'Manual revert';
    default:
      return reason;
  }
}

function resultBadgeClass(result: string): string {
  if (result === 'success') return s.badgeGood;
  if (result === 'partial') return s.badgeWarn;
  return s.badgeWarn;
}

export function OwnershipTransferLogPane() {
  const [rows, setRows] = useState<OwnershipTransferLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dealFilter, setDealFilter] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (zohoDealId?: string) => {
    const n = (seq.current += 1);
    setLoading(true);
    setError('');
    try {
      const transfers = await listOwnershipTransferLogs({
        limit: 150,
        ...(zohoDealId?.trim() ? { zohoDealId: zohoDealId.trim() } : {}),
      });
      if (n !== seq.current) return;
      setRows(transfers);
    } catch (e) {
      if (n === seq.current) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        adminToast.error(msg);
      }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={s.dealsTransferLog}>
      <div className={s.dealsToolbar}>
        <div className={`${s.search} ${s.searchTall} ${s.dealsSearch}`}>
          <input
            className={`${s.searchInput} ${s.mono}`}
            value={dealFilter}
            onChange={(e) => setDealFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(dealFilter);
            }}
            placeholder="Filter by Zoho deal id…"
            aria-label="Filter transfer log by deal id"
          />
        </div>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={loading}
          onClick={() => void load(dealFilter)}
        >
          Apply
        </button>
        <button
          type="button"
          className={s.ghostBtn}
          disabled={loading}
          onClick={() => {
            setDealFilter('');
            void load();
          }}
          title="Refresh"
        >
          <RefreshIcon /> Refresh
        </button>
        {!loading ? <span className={s.dealsCount}>{rows.length} logged</span> : null}
      </div>

      {error ? <p className={s.errorText}>{error}</p> : null}

      <div className={s.tableScroll} aria-busy={loading}>
        <div className={s.table}>
          <div className={`${s.tHead} ${s.tOwnershipLog}`}>
            <span>When</span>
            <span>Deal</span>
            <span>From → To</span>
            <span>By</span>
            <span>Reason</span>
            <span>Result</span>
          </div>
          {loading && rows.length === 0 ? (
            <>
              <span className={s.srOnly}>Loading transfer log</span>
              <TableSkeleton
                widths={SKELETON}
                rowClassName={s.tRow}
                colsClassName={s.tOwnershipLog}
              />
            </>
          ) : null}
          {!loading && rows.length === 0 ? (
            <div className={s.emptyState}>No ownership transfers logged yet.</div>
          ) : null}
          {!loading
            ? rows.map((row) => {
                const from = ownerLabel(row.fromOwnerName, row.fromOwnerZohoUserId);
                const to = ownerLabel(row.toOwnerName, row.toOwnerZohoUserId);
                const deal =
                  row.dealName?.trim() ||
                  row.companyName?.trim() ||
                  row.zohoDealId ||
                  '—';
                return (
                  <div key={row.id} className={`${s.tRow} ${s.tOwnershipLog}`}>
                    <span className={s.cellSub} title={row.createdAt}>
                      {relativeTime(row.createdAt)}
                    </span>
                    <span className={s.cellStack}>
                      <strong className={s.jobTitle}>{deal}</strong>
                      <span className={`${s.jobDesc} ${s.mono}`}>
                        {[row.zohoDealId, row.contactName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={s.dealsFromTo} title={`${from} → ${to}`}>
                      <span className={s.dealsFromToFrom}>{from}</span>
                      <span className={s.dealsFromToArrow} aria-hidden>
                        →
                      </span>
                      <span className={s.dealsFromToTo}>{to}</span>
                    </span>
                    <span className={s.cellStack}>
                      <strong className={s.jobTitle}>{row.actorName?.trim() || '—'}</strong>
                      {row.actorZohoUserId ? (
                        <span className={`${s.jobDesc} ${s.mono}`}>{row.actorZohoUserId}</span>
                      ) : null}
                    </span>
                    <span>{reasonLabel(row.reason)}</span>
                    <span className={s.cellStack}>
                      <span className={resultBadgeClass(row.result)}>{row.result}</span>
                      <span className={s.jobDesc}>
                        {[
                          row.dealUpdated ? 'Deal' : null,
                          row.contactUpdated ? 'Contact' : null,
                          row.accountUpdated ? 'Account' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                      {row.warnings || row.errorMessage ? (
                        <span
                          className={s.jobDesc}
                          title={row.warnings || row.errorMessage || ''}
                        >
                          {(row.warnings || row.errorMessage || '').slice(0, 80)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}
