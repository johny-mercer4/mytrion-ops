import type { ReactElement } from 'react';
import { useI18n } from '../lib/i18n';

export interface ConfirmConfig {
  title: string;
  body: string;
  okLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** Centered confirmation modal (v2 design) — used before destructive/disruptive actions (e.g. regenerating a driver link). */
export function ConfirmDialog({ config, onCancel }: { config: ConfirmConfig | null; onCancel: () => void }): ReactElement | null {
  const { t } = useI18n();
  if (!config) return null;
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, animation: 'octfade .18s ease' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 318, background: 'var(--card)', borderRadius: 20, padding: '22px 20px 18px', boxShadow: '0 20px 60px rgba(0,0,0,.5)', animation: 'octpop .22s ease' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg)' }}>{config.title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--muted-fg)', lineHeight: 1.5, marginTop: 8 }}>{config.body}</div>
        <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
          <button
            type="button"
            className="press"
            onClick={onCancel}
            style={{ flex: 1, height: 46, border: 'none', borderRadius: 13, background: 'var(--secondary)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="press"
            onClick={config.onConfirm}
            style={{ flex: 1, height: 46, border: 'none', borderRadius: 13, background: config.danger ? 'var(--destructive)' : 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
          >
            {config.okLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
