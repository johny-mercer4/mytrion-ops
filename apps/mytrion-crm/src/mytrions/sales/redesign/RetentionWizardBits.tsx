/** Shared wizard bits for retention attempt / status steps. */
import type { FormEvent } from 'react';
import { Icon } from './icons';
import { s } from './dc';
import {
  REASON_OPTIONS,
  type RetentionDissatisfactionReason,
} from './retentionData';

export function DissatisfiedForm(props: {
  busy: boolean;
  reason: RetentionDissatisfactionReason | '';
  reasonNote: string;
  setReason: (v: RetentionDissatisfactionReason | '') => void;
  setReasonNote: (v: string) => void;
  onDissatisfied: (e: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onDissatisfied}
      style={s(
        'padding:12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));background:var(--surface);display:flex;flex-direction:column;gap:10px',
      )}
    >
      <div>
        <div style={s('font-size:13px;font-weight:800;color:var(--text)')}>
          Why are they dissatisfied?
        </div>
        <div style={s('font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4')}>
          Pick the main reason — this goes to the Retention team with the case.
        </div>
      </div>

      <div
        style={s('display:flex;flex-direction:column;gap:6px')}
        role="radiogroup"
        aria-label="Dissatisfaction reason"
      >
        {REASON_OPTIONS.map((r) => {
          const active = props.reason === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => props.setReason(r.id)}
              style={s(
                `text-align:left;padding:10px 12px;border-radius:var(--radius-md);border:1px solid ${active ? 'var(--danger)' : 'var(--border)'};background:${active ? 'color-mix(in srgb,var(--danger) 8%,var(--alt))' : 'var(--alt)'};cursor:pointer`,
              )}
            >
              <div
                style={s(
                  `font-size:12px;font-weight:800;color:${active ? 'var(--danger)' : 'var(--text)'}`,
                )}
              >
                {r.label}
              </div>
              <div style={s('font-size:11px;color:var(--muted);margin-top:2px;line-height:1.35')}>
                {r.hint}
              </div>
            </button>
          );
        })}
      </div>

      <textarea
        value={props.reasonNote}
        onChange={(e) => props.setReasonNote(e.target.value)}
        placeholder={
          props.reason === 'switched_other'
            ? 'Required — who did they switch to, or other details…'
            : 'Optional note for Retention…'
        }
        rows={2}
        className="ss-in"
        style={s(
          'padding:8px 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:12px;resize:vertical',
        )}
      />
      <button
        type="submit"
        disabled={props.busy || !props.reason}
        style={s(
          `height:40px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger);font-weight:700;font-size:13px;cursor:${props.busy || !props.reason ? 'not-allowed' : 'pointer'};opacity:${!props.reason ? 0.55 : 1}`,
        )}
      >
        Hand off to Retention & close
      </button>
    </form>
  );
}

export function ScreenshotField(props: {
  preview: string | null;
  fileName: string | null;
  onPick: (f: File | null) => void;
}) {
  const inputId = 'retention-attempt-shot';
  if (props.preview) {
    return (
      <div
        style={s(
          'display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--radius-md);border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.08)',
        )}
      >
        <img
          src={props.preview}
          alt="Attempt screenshot"
          style={s(
            'width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0',
          )}
        />
        <div style={s('min-width:0;flex:1')}>
          <div
            style={s(
              'font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
            )}
          >
            {props.fileName ?? 'Screenshot ready'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => props.onPick(null)}
          style={s(
            'border:none;background:transparent;color:var(--danger);font-size:12px;font-weight:700;cursor:pointer',
          )}
        >
          Remove
        </button>
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={inputId}
        style={s(
          'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;border-radius:var(--radius-md);border:1px dashed var(--border);background:var(--surface);cursor:pointer;text-align:center',
        )}
      >
        <Icon name="upload" size={18} color="var(--accent)" strokeWidth={1.8} />
        <div style={s('font-size:12px;color:var(--text2)')}>
          <span style={s('color:var(--accent);font-weight:700')}>Screenshot</span> (optional if you
          add a note)
        </div>
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={(e) => props.onPick(e.currentTarget.files?.[0] ?? null)}
        style={{ display: 'none' }}
      />
    </>
  );
}
