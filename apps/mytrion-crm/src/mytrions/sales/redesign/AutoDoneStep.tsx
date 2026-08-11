import { s } from './dc';
import type { DonePayload, InvRow } from './autoLive';
import type { TxnReportState } from './txnReport';
import { AutoStatusResult, isEmptyResultMessage } from './AutoActionResult';
import { AutoCardLastUsedPanel, AutoLimitUpdatePanel } from './AutoCardResults';
import { AutoCardLookupPanel } from './AutoCardLookupPanel';
import { AutoInvoicesPanel, AutoTransactionsPanel } from './AutoResultPanels';
import { AutoPaymentsPanel, AutoTrackingPanel, AutoWexTasksPanel } from './AutoRichResults';

const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
const mono = "font-family:var(--font-mono)";
/* --on-accent, never #fff: --accent is a PALE cyan in dark (#a5e7ff) and --accent-2 a pale
   pink, so white ink on this fill is ~1.35:1 — an invisible label on every primary button in
   the automation modals. The rest of the Sales module already used the token; these three
   inline constants were the holdouts. */
const btnP = (extra: string): string =>
  `border:none;background:${grad};color:var(--on-accent);font-weight:700;cursor:pointer;${extra}`;

export function hasWideAutoResult(
  result: DonePayload | null,
  invoiceRows: InvRow[],
  txnReport: TxnReportState | null,
): boolean {
  if (result?.kind === 'invoices') return invoiceRows.length > 0;
  if (result?.kind === 'transactions') return Boolean(txnReport?.transactions.length);
  return result?.kind === 'card-lookup' && result.rows.length > 0;
}

interface AutoDoneStepProps {
  error: string | null;
  result: DonePayload | null;
  invoiceRows: InvRow[];
  /** Carrier the invoices were fetched for — scopes the download routes. */
  invoiceCarrierId: string;
  txnReport: TxnReportState | null;
  runVerb: string;
  successMessage: string;
  splitTransactions: boolean;
  onDone: () => void;
  onReset: () => void;
}

/** All success/error/empty rendering lives here so the automation runner stays maintainable. */
export function AutoDoneStep({
  error,
  result,
  invoiceRows,
  invoiceCarrierId,
  txnReport,
  runVerb,
  successMessage,
  splitTransactions,
  onDone,
  onReset,
}: AutoDoneStepProps) {
  const invoices = result?.kind === 'invoices';
  const transactions = result?.kind === 'transactions';
  const table = result?.kind === 'table' ? result : null;
  const tracking = result?.kind === 'tracking' ? result : null;
  const wexTasks = result?.kind === 'wex-tasks' ? result : null;
  const payments = result?.kind === 'payments' ? result : null;
  const lastUsed = result?.kind === 'card-last-used' ? result : null;
  const limit = result?.kind === 'limit-update' ? result : null;
  const cardLookup = result?.kind === 'card-lookup' ? result : null;
  const invoicesEmpty = invoices && invoiceRows.length === 0;
  const transactionsEmpty = transactions && !txnReport?.transactions.length;
  const cardLookupEmpty = Boolean(cardLookup && cardLookup.rows.length === 0);
  const tableEmpty = Boolean(table && table.rows.length === 0);
  const messageEmpty = result?.kind === 'message' && isEmptyResultMessage(result.message);
  const empty = invoicesEmpty || transactionsEmpty || cardLookupEmpty || tableEmpty || messageEmpty;
  const rich = (
    invoices || transactions || cardLookup || table || tracking || wexTasks || payments || lastUsed || limit
  ) && !empty;
  const emptyTitle = invoicesEmpty
    ? 'No invoices found'
    : transactionsEmpty
      ? 'No transactions found'
      : cardLookupEmpty
        ? 'No cards found'
        : tableEmpty
          ? (table?.title ? `No ${table.title.toLowerCase()}` : 'Nothing found')
          : messageEmpty
            ? (successMessage.replace(/\.$/, '') || 'Nothing found')
            : 'Nothing found';
  const emptyMessage = messageEmpty
    ? undefined
    : invoicesEmpty
      ? 'No invoices found for the selected date range.'
      : transactionsEmpty
        ? 'No transactions in this range. Try a different window or deal.'
        : cardLookupEmpty
          ? 'No cards were returned for this carrier.'
          : tableEmpty
            ? 'Nothing matched for this carrier.'
            : 'Try a different search or selection.';

  if (error) {
    return (
      <AutoStatusResult
        tone="error"
        title="Couldn't complete that"
        message={error}
        onDone={onDone}
        onSecondary={onReset}
        secondaryLabel="Try again"
      />
    );
  }
  if (empty) {
    return (
      <AutoStatusResult
        tone="empty"
        title={emptyTitle}
        message={emptyMessage}
        onDone={onDone}
        onSecondary={onReset}
        secondaryLabel="Run another"
      />
    );
  }
  if (!rich) {
    return (
      <AutoStatusResult
        tone="success"
        title={`${runVerb} complete`}
        message={successMessage}
        onDone={onDone}
        onSecondary={onReset}
        secondaryLabel="Run another"
      />
    );
  }

  return (
    <div style={s(splitTransactions
      ? 'flex:1;min-height:0;display:flex;flex-direction:column;gap:14px'
      : 'display:flex;flex-direction:column;gap:14px')}
    >
      {invoices && (
        <AutoInvoicesPanel
          rows={invoiceRows}
          carrierId={invoiceCarrierId}
          {...(result?.kind === 'invoices' && result.source ? { source: result.source } : {})}
        />
      )}
      {transactions && <AutoTransactionsPanel report={txnReport} splitLayout />}
      {cardLookup && (
        <AutoCardLookupPanel
          carrierId={cardLookup.carrierId}
          companyName={cardLookup.companyName}
          rows={cardLookup.rows}
        />
      )}
      {tracking && (
        <AutoTrackingPanel
          carrierId={tracking.carrierId}
          fedexTracking={tracking.fedexTracking}
          entries={tracking.entries}
        />
      )}
      {wexTasks && (
        <AutoWexTasksPanel
          appId={wexTasks.appId}
          summary={wexTasks.summary}
          tasks={wexTasks.tasks}
        />
      )}
      {payments && (
        <AutoPaymentsPanel
          summary={payments.summary}
          cmpInvoices={payments.cmpInvoices}
          cmpError={payments.cmpError}
        />
      )}
      {lastUsed && <AutoCardLastUsedPanel rows={lastUsed.rows} />}
      {limit && <AutoLimitUpdatePanel result={limit.result} />}
      {table && (
        <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden')}>
          <div style={s('padding:11px 15px;background:var(--alt);font-size:var(--ss-text-2xs);font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>{table.title}</div>
          <div style={s(`display:grid;grid-template-columns:repeat(${table.columns.length},1fr);gap:8px;padding:10px 15px;font-size:var(--ss-text-2xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--border2)`)}>
            {table.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {table.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="ss-row-h" style={s(`display:grid;grid-template-columns:repeat(${table.columns.length},1fr);gap:8px;padding:12px 15px;border-top:1px solid var(--border2);font-size:var(--ss-text-sm)`)}>
              {row.map((cell, cellIndex) => (
                <span key={cellIndex} style={s(cellIndex === 0 ? mono : 'color:var(--text2)')}>{cell}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      <div style={s(`display:flex;justify-content:flex-end;gap:10px;${splitTransactions ? 'flex-shrink:0;padding-top:4px' : 'margin-top:4px'}`)}>
        <button onClick={onReset} className="ss-auto-result-btn-sec" style={s('height:42px;padding:0 18px;font-size:var(--ss-text-sm)')}>Run another</button>
        <button onClick={onDone} className="ss-btn-p" style={s(btnP('height:42px;padding:0 22px;border-radius:var(--radius-md);font-size:var(--ss-text-sm)'))}>Done</button>
      </div>
    </div>
  );
}
