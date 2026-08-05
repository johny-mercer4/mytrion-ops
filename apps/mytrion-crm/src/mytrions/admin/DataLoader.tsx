import { Fragment, useEffect, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  getDataLoaderBatch,
  getDataLoaderConfig,
  listDataLoaderBatches,
  revertDataLoaderBatch,
  type BulkChangeSnapshot,
  type DataLoaderBatch,
  type DataLoaderChange,
} from '../../api/dataLoader';
import { AlertIcon, DatabaseIcon, RefreshIcon } from '../../components/icons';
import { useLoad } from '../_shared/useLoad';
import { ConfirmDialog } from './ConfirmDialog';
import { PAGE_SIZE, Pager } from './Pager';
import { adminToast } from './toast';
import s from './admin.module.css';
import dl from './DataLoader.module.css';

const BATCH_SKELETON = ['46%', '62%', '56%', '70%', '36%', '68px'] as const;

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

function displayValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedKeys(
  before: BulkChangeSnapshot | null,
  after: BulkChangeSnapshot | null,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((key) => !equalValue(before?.[key], after?.[key]))
    .sort((left, right) => left.localeCompare(right));
}

function OperationCounts({ batch }: { batch: DataLoaderBatch }) {
  return (
    <span className={dl.opCounts}>
      {batch.insertCount > 0 && (
        <span className={dl.opPill} data-op="insert">
          +{batch.insertCount}
        </span>
      )}
      {batch.updateCount > 0 && (
        <span className={dl.opPill} data-op="update">
          ~{batch.updateCount}
        </span>
      )}
      {batch.deleteCount > 0 && (
        <span className={dl.opPill} data-op="delete">
          −{batch.deleteCount}
        </span>
      )}
    </span>
  );
}

function ChangeDiff({ change }: { change: DataLoaderChange }) {
  const keys = changedKeys(change.before, change.after);
  return (
    <div className={dl.changeCard}>
      <div className={dl.changeHead}>
        <span className={dl.opPill} data-op={change.op}>
          {change.op}
        </span>
        <span className={dl.changePk} title={change.rowPk}>
          {change.rowPk}
        </span>
      </div>
      <div className={dl.diff}>
        <span className={dl.diffHead}>Field</span>
        <span className={dl.diffHead}>Before</span>
        <span className={dl.diffHead}>After</span>
        {keys.map((key) => (
          <Fragment key={`${change.id}:${key}`}>
            <span>{key}</span>
            <span className={dl.diffChanged}>{displayValue(change.before?.[key])}</span>
            <span className={dl.diffChanged}>{displayValue(change.after?.[key])}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function BatchDetails({ batchId }: { batchId: string }) {
  const loaded = useLoad(() => getDataLoaderBatch(batchId), [batchId]);
  if (loaded.loading) {
    return (
      <div className={dl.details} role="status">
        <div className={s.skelCard} />
      </div>
    );
  }
  if (loaded.error) {
    return (
      <div className={dl.details}>
        <div className={dl.detailError} role="alert">
          <span>{loaded.error}</span>
          <button type="button" className={s.ghostBtn} onClick={loaded.reload}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={dl.details}>
      {loaded.data?.rows.map((change) => <ChangeDiff key={change.id} change={change} />)}
    </div>
  );
}

export function DataLoader() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DataLoaderBatch | null>(null);
  const [reverting, setReverting] = useState(false);
  // Two hooks, not one: useLoad nulls its `data` whenever the deps change, so pairing the config
  // with the paged journal made every page turn blank the launch card into "NocoDB URL not
  // configured" and unmount the pager mid-navigation. The config has no page dependency.
  const cfg = useLoad(() => getDataLoaderConfig(), []);
  const journal = useLoad(() => listDataLoaderBatches(PAGE_SIZE, (page - 1) * PAGE_SIZE), [page]);
  // The pager reads the last known total so it stays mounted across the gap where journal.data is null.
  const [knownTotal, setKnownTotal] = useState(0);
  useEffect(() => {
    if (journal.data) setKnownTotal(journal.data.total);
  }, [journal.data]);

  const error = cfg.error ?? journal.error;
  const loading = cfg.loading || journal.loading;
  const refreshing = cfg.refreshing || journal.refreshing;
  function reloadAll() {
    cfg.reload();
    journal.reload();
  }
  function refreshAll() {
    cfg.refresh();
    journal.refresh();
  }

  async function onRevert() {
    if (!confirming) return;
    setReverting(true);
    try {
      const result = await revertDataLoaderBatch(confirming.batchId);
      adminToast.success(
        'Batch reverted',
        `${result.rowCount} row${result.rowCount === 1 ? '' : 's'} restored.`,
      );
      setConfirming(null);
      setExpanded(null);
      journal.reload();
    } catch (error) {
      adminToast.error(
        'Could not revert batch',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setReverting(false);
    }
  }

  const batches = journal.data?.batches ?? [];

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Controlled bulk operations</div>
          <h2 className={s.h2}>Data Loader</h2>
          <p className={s.sub}>
            Import, map, edit, and remove approved app records through the restricted NocoDB
            workspace. Every database change is journaled before it can complete.
          </p>
        </div>
        <button
          type="button"
          className={s.ghostBtn}
          disabled={loading || refreshing}
          onClick={refreshAll}
        >
          {refreshing ? (
            <>
              <span className={s.loadingSpin} aria-hidden="true" />
              Refreshing…
            </>
          ) : (
            <>
              <RefreshIcon /> Refresh
            </>
          )}
        </button>
      </div>

      {error ? (
        <div className={s.errorState} role="alert">
          <span className={s.errorIcon}>
            <AlertIcon size={20} />
          </span>
          <span className={s.errorTitle}>Data Loader is unavailable</span>
          <span className={s.errorCause}>{error}</span>
          <span className={s.errorHint}>
            Check the app Postgres connection and confirm migration 0069 has been applied, then
            retry.
          </span>
          <span className={s.errorActions}>
            <button type="button" className={s.ghostBtn} onClick={reloadAll}>
              Retry
            </button>
          </span>
        </div>
      ) : (
        <>
          <div className={dl.launchGrid}>
            <section className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardTitle}>Open import workspace</span>
              </div>
              <div className={dl.launchBody}>
                <p className={s.sub}>
                  NocoDB opens in a separate tab and has its own manually provisioned admin login.
                </p>
                {cfg.data?.baseUrl ? (
                  <a
                    className={`${s.primaryBtn} ${s.tall} ${dl.launchButton}`}
                    href={cfg.data.baseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open NocoDB
                  </a>
                ) : (
                  <button type="button" className={`${s.primaryBtn} ${s.tall}`} disabled>
                    NocoDB URL not configured
                  </button>
                )}
                <div className={dl.tableList}>
                  {cfg.data?.tables.map((table) => (
                    <span className={dl.tableChip} key={table}>
                      {table}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <section className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardTitle}>Non-negotiable guardrails</span>
              </div>
              <ul className={dl.guardrailList}>
                <li className={dl.guardrailItem}>
                  <span className={dl.guardrailDot} />
                  <span>Only the tables listed here are writable, for one configured tenant.</span>
                </li>
                <li className={dl.guardrailItem}>
                  <span className={dl.guardrailDot} />
                  <span>Every insert, update, and delete records before and after images.</span>
                </li>
                <li className={dl.guardrailItem}>
                  <span className={dl.guardrailDot} />
                  <span>Schema editing is forbidden. Columns and tables change only by migration.</span>
                </li>
              </ul>
            </section>
          </div>

          <section>
            <div className={s.head}>
              <div>
                <div className={s.eyebrow}>Database journal</div>
                <h2 className={s.h2}>Recent batches</h2>
                <p className={s.sub}>
                  Expand a batch to inspect changed fields. Revert is refused if any row has drifted
                  since the import.
                </p>
              </div>
            </div>

            <div className={s.table} aria-busy={journal.loading}>
              <div className={`${s.tHead} ${dl.batchTable}`}>
                <span>When</span>
                <span>Database user</span>
                <span>Table</span>
                <span>Operations</span>
                <span>Rows</span>
                <span className={s.right}>Actions</span>
              </div>
              {journal.loading ? (
                <>
                  <span className={s.srOnly} role="status">
                    Loading Data Loader batches…
                  </span>
                  <TableSkeleton
                    widths={BATCH_SKELETON}
                    rowClassName={s.tRow}
                    colsClassName={dl.batchTable}
                    rows={6}
                  />
                </>
              ) : (
                batches.map((batch) => {
                  const isExpanded = expanded === batch.batchId;
                  return (
                    <div key={`${batch.batchId}:${batch.tableName}`}>
                      <div className={`${s.tRow} ${dl.batchTable}`}>
                        <span title={new Date(batch.createdAt).toLocaleString()}>
                          {relativeTime(batch.createdAt)}
                        </span>
                        <span className={s.mono}>{batch.dbUser}</span>
                        <span className={s.mono}>{batch.tableName}</span>
                        <OperationCounts batch={batch} />
                        <span>{batch.rowCount}</span>
                        <span className={dl.batchActions}>
                          <button
                            type="button"
                            className={s.ghostBtn}
                            aria-expanded={isExpanded}
                            onClick={() => setExpanded(isExpanded ? null : batch.batchId)}
                          >
                            {isExpanded ? 'Hide' : 'Inspect'}
                          </button>
                          <button
                            type="button"
                            className={s.dangerBtn}
                            disabled={batch.revertedAt !== null}
                            onClick={() => setConfirming(batch)}
                          >
                            {batch.revertedAt ? 'Reverted' : 'Revert'}
                          </button>
                        </span>
                      </div>
                      {isExpanded && (
                        <div className={dl.expanded}>
                          <BatchDetails batchId={batch.batchId} />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {!journal.loading && batches.length === 0 && (
                <div className={s.emptyState}>
                  <span className={s.emptyIcon}>
                    <DatabaseIcon size={20} />
                  </span>
                  <span className={s.emptyTitle}>No bulk changes yet</span>
                  <span className={s.emptyBody}>
                    An import or grid edit through NocoDB will appear here as soon as its database
                    transaction commits.
                  </span>
                </div>
              )}
            </div>
            {knownTotal > 0 && <Pager page={page} total={knownTotal} onChange={setPage} />}
          </section>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title="Revert this Data Loader batch?"
          body={`Restore ${confirming.rowCount} row${confirming.rowCount === 1 ? '' : 's'} in ${confirming.tableName}. The revert stops without changing anything if any current row no longer matches the journal.`}
          confirmLabel="Revert batch"
          busy={reverting}
          onConfirm={() => void onRevert()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
