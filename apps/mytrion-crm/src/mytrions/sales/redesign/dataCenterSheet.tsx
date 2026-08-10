/**
 * Shared centered detail sheet for the Data Center modals (Lead / Deal / Rejection report).
 * Replaces the old full-viewport "separate page" drilldowns.
 *
 * Rendered through a PORTAL to <body>. The scrim is `position: fixed`, but that is not enough on its
 * own: Sales puts `backdrop-filter` on its chrome and card surfaces, and a filtered ancestor becomes
 * the containing block for fixed-position descendants. Mounted inline, the scrim therefore anchored
 * to the (very tall) panel instead of the viewport, so opening a row far down the Rejection Reports
 * list put the dialog at the CONTAINER's midpoint and the agent had to scroll to find it.
 *
 * The portal escapes `.ss-root`, which is where Sales' token bridge lives (--surface, --border, the
 * radii) plus the `.light` theme class — so the wrapper below re-establishes both. Without it the
 * sheet renders with global tokens and ignores light mode. Same fix, same reason, as Finance's
 * ClientModal.
 */
import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@/hooks/useTheme';
import { s } from './dc';
import { Icon } from './icons';
import { useAccessibleDialog } from './useAccessibleDialog';

const BACKDROP =
  'position:fixed;inset:0;z-index:var(--z-modal);background:var(--scrim);backdrop-filter:blur(var(--scrim-blur));-webkit-backdrop-filter:blur(var(--scrim-blur));display:flex;align-items:center;justify-content:center;padding:var(--space-6)';
const SHEET =
  'width:100%;max-width:960px;max-height:100%;flex:none;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden';
const CLOSE =
  'width:32px;height:32px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center';
const FOOT_BTN = 'height:38px;padding:0 18px;border-radius:var(--radius-md);font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:7px';
const PRIMARY_BTN = `${FOOT_BTN};border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent)`;
const GHOST_BTN = `${FOOT_BTN};border:1px solid var(--border);background:var(--alt);color:var(--text)`;

export function DetailSheet({
  accent,
  title,
  subtitle,
  avatar,
  badges,
  onClose,
  footer,
  saving,
  children,
  ariaLabel,
}: {
  accent: string;
  title: string;
  subtitle?: string;
  avatar: ReactNode;
  badges?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  saving?: boolean;
  children: ReactNode;
  ariaLabel: string;
}) {
  const dialogRef = useAccessibleDialog(true, onClose, { dismissible: !saving });

  const { theme } = useTheme();

  return createPortal(
    <div
      className={`ss-root${theme === 'light' ? ' light' : ''}`}
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
      style={s(BACKDROP)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-busy={saving || undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={s(`${SHEET};border-top:3px solid ${accent}`)}
      >
        <header
          style={s(
            'flex-shrink:0;padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;background:color-mix(in srgb,var(--surface) 92%,var(--alt))',
          )}
        >
          {avatar}
          <div style={s('flex:1;min-width:0')}>
            <div
              style={s(
                'font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em',
              )}
            >
              {title}
            </div>
            {subtitle ? (
              <div
                style={s(
                  'font-size:13px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
                )}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
          {badges}
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="ss-ico-btn" style={s(CLOSE)}>
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </header>

        <div className="ss-scroll" style={s('flex:1;min-height:0;overflow:auto;padding:18px 20px;position:relative')}>
          {saving ? (
            <div
              aria-hidden
              style={s(
                'position:absolute;inset:0;z-index:2;background:color-mix(in srgb,var(--surface) 55%,transparent);display:flex;align-items:flex-start;justify-content:center;padding-top:48px;pointer-events:none',
              )}
            >
              <div
                style={s(
                  'display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:99px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);font-size:13px;font-weight:700;color:var(--text2)',
                )}
              >
                <span
                  style={s(
                    'width:16px;height:16px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);animation:ss-spin .8s linear infinite',
                  )}
                />
                Saving changes…
              </div>
            </div>
          ) : null}
          {children}
        </div>

        <footer style={s('flex-shrink:0;border-top:1px solid var(--border);background:var(--surface)')}>{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  onClose,
  call,
  onCall,
}: {
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClose: () => void;
  call: { label: string; phone: string } | null;
  onCall?: (phone: string) => void;
}) {
  return (
    <div style={s('padding:12px 20px;display:flex;justify-content:flex-end;gap:10px')}>
      {editing ? (
        <>
          <button type="button" onClick={onCancel} disabled={saving} style={s(`${GHOST_BTN};opacity:${saving ? '.6' : '1'}`)}>
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={saving} style={s(`${PRIMARY_BTN};opacity:${saving ? '.7' : '1'}`)}>
            {saving ? (
              <span style={s('width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;animation:ss-spin .8s linear infinite')} />
            ) : (
              <Icon name="check" size={14} strokeWidth={2.6} />
            )}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      ) : (
        <>
          {call && onCall && (
            <button type="button" onClick={() => onCall(call.phone)} style={s(PRIMARY_BTN)}>
              <Icon name="calls" size={14} />
              {call.label}
            </button>
          )}
          <button type="button" onClick={onEdit} style={s(GHOST_BTN)}>
            <Icon name="edit" size={14} />
            Edit
          </button>
          <button type="button" onClick={onClose} style={s(GHOST_BTN)}>
            Close
          </button>
        </>
      )}
    </div>
  );
}
