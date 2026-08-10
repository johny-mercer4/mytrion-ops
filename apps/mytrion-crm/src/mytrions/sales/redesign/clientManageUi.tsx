import type { ReactNode } from 'react';

import { ApiError } from '@/api/transport';

import { s } from './dc';

/** DWH outage vs ownership denial — Manage must not read "no cards" when the warehouse is down. */
export function friendlyManageError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'DWH_ERROR' || e.status === 502) return 'Data warehouse temporarily unavailable — try again shortly.';
    if (e.code === 'DWH_UNCONFIGURED' || e.status === 503) return 'Card data is unavailable right now (warehouse not configured).';
    if (e.status === 403) return "This carrier isn't in your client list.";
  }
  return e instanceof Error ? e.message : String(e);
}

export const MANAGE_TILE =
  'padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
export const MANAGE_LABEL =
  'font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;display:block';
export const MANAGE_FIELD =
  'width:100%;height:36px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;outline:none;box-sizing:border-box';

export function ManageSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section style={s(MANAGE_TILE)}>
      <div style={s('font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700')}>
        {title}
      </div>
      {hint ? (
        <div style={s('font-size:13px;color:var(--text2);margin-top:4px;margin-bottom:10px;line-height:1.4')}>{hint}</div>
      ) : (
        <div style={s('height:10px')} />
      )}
      {children}
    </section>
  );
}
