/**
 * Automation result renderer — one switch over Outcome kinds. Generic KV grid, section
 * groups, and tables cover most automations; invoices get download buttons (2-min signed
 * URL fetched on click), links open in a new tab.
 */
import { useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Loader2 } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import type { KVRow, Outcome } from './specs';

function KVGrid({ rows }: { rows: KVRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing to show.</p>;
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="font-medium">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rows found.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceRow({ row }: { row: { id: string; label: string; status: string; amount: string } }) {
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  async function download(type: 'pdf' | 'excel') {
    setBusy(type);
    try {
      const { url } = await callTouchpoint('sales_mytrion.invoice_signed_url', {
        invoiceId: row.id,
        type,
      });
      if (url) window.open(url, '_blank', 'noopener');
    } finally {
      setBusy(null);
    }
  }
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="truncate font-medium">{row.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
      <span className="shrink-0 font-semibold">{row.amount}</span>
      <span className="flex shrink-0 gap-1">
        {(['pdf', 'excel'] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy !== null || !row.id}
            onClick={() => void download(t)}
            className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase hover:bg-accent disabled:opacity-40"
          >
            {busy === t ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            {t}
          </button>
        ))}
      </span>
    </li>
  );
}

export function ResultView({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case 'kv':
      return (
        <div className="rounded-md border bg-muted/30 p-3.5">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{outcome.title}</div>
          <KVGrid rows={outcome.rows} />
        </div>
      );
    case 'sections':
      return (
        <div className="flex flex-col gap-3">
          {outcome.sections.map((s) => (
            <div key={s.title} className="rounded-md border bg-muted/30 p-3.5">
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{s.title}</div>
              {s.error ? (
                <p className="text-sm text-destructive">⚠ {s.error}</p>
              ) : (
                <KVGrid rows={s.rows} />
              )}
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{outcome.title}</div>
          <DataTable columns={outcome.columns} rows={outcome.rows} />
        </div>
      );
    case 'invoices':
      return outcome.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices in this range.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {outcome.rows.map((r, i) => (
            <InvoiceRow key={r.id || i} row={r} />
          ))}
        </ul>
      );
    case 'ack':
      return (
        <div className="flex items-center gap-2 rounded-md border border-primary/24 bg-primary/8 p-3.5 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          {outcome.message}
        </div>
      );
    case 'link':
      return (
        <a
          href={outcome.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-accent"
        >
          <ExternalLink className="size-4" />
          {outcome.label}
        </a>
      );
  }
}
