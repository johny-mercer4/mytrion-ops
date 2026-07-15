import type { ReactElement } from 'react';
import { Icon } from './icons';

export type ToastKind = 'success' | 'error';
export interface ToastState {
  msg: string;
  kind: ToastKind;
  id: number;
}

/**
 * Top-right confirmation pill — clears the fixed app header rather than sitting over content or
 * the bottom tab bar. Themed (var(--card)/var(--fg)) rather than a hardcoded dark chip, so it
 * doesn't look like a foreign element dropped onto the light theme's page.
 */
export function Toast({ toast }: { toast: ToastState | null }): ReactElement | null {
  if (!toast) return null;
  return (
    <div style={{ position: 'fixed', top: 'calc(76px + env(safe-area-inset-top))', right: 14, zIndex: 60, pointerEvents: 'none' }}>
      <div
        key={toast.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: 280,
          padding: '12px 15px',
          borderRadius: 14,
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          boxShadow: '0 12px 34px rgba(0,0,0,.28)',
          animation: 'octtoastright .24s cubic-bezier(.32,.72,0,1)',
          fontSize: 13.5,
          fontWeight: 600,
          lineHeight: 1.35,
        }}
      >
        <span style={{ flex: 'none', display: 'flex', color: toast.kind === 'error' ? 'var(--destructive)' : 'var(--success)' }}>
          <Icon name={toast.kind === 'error' ? 'x' : 'check'} size={16} strokeWidth={2.4} className="" />
        </span>
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
