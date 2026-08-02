import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoutingCandidate } from '../../api/commsAdmin';
import s from './admin.module.css';
import e from './escalationRouting.module.css';

/**
 * Pick a person to route to, from the HR directory.
 *
 * Only candidates with a Zoho user id ever reach this component — the server filters them out, because
 * that id IS the routing key and offering anyone without one would let an admin save a row that can never
 * receive an escalation.
 *
 * `leadOfDepartments` renders as a "Dept lead" hint rather than pre-selecting anything. HR's lead link
 * resolves through a nullable, heuristic `zoho_user_id`, so it is a suggestion the admin confirms — never
 * a silent default. That distinction is the whole reason this config exists as its own table.
 */
export function PersonPicker({
  candidates,
  value,
  valueLabel,
  placeholder = 'Not set — unrouted',
  busy = false,
  hintDepartment,
  onPick,
  onClear,
  ariaLabel,
}: {
  candidates: RoutingCandidate[];
  value: string | null;
  /** Snapshot name for the current value, used when the person is not in the candidate list. */
  valueLabel?: string | null;
  placeholder?: string;
  busy?: boolean;
  /** Marks candidates HR places in this department, so a manager pick can be spotted quickly. */
  hintDepartment?: string | undefined;
  onPick: (candidate: RoutingCandidate) => void;
  onClear?: (() => void) | undefined;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Close on an outside click or Escape. Both, because a picker that only closes on one of them strands
  // the panel over the row beneath it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setTerm('');
  }, [open]);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    const scored = candidates.filter((c) => {
      if (!t) return true;
      return [c.name, c.email, c.designation, c.department, c.zohoUserId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(t);
    });
    // Whoever HR marks as lead of the department being configured floats up. Ordering only — the admin
    // still has to click, so this can never route on its own.
    if (!hintDepartment) return scored.slice(0, 60);
    return [...scored]
      .sort((a, b) => {
        const al = a.leadOfDepartments.length > 0 ? 0 : 1;
        const bl = b.leadOfDepartments.length > 0 ? 0 : 1;
        return al - bl;
      })
      .slice(0, 60);
  }, [candidates, term, hintDepartment]);

  const current = candidates.find((c) => c.zohoUserId === value);
  // A snapshot name, then the raw id: someone who has left HR still has to render as something.
  const label = current?.name ?? valueLabel ?? (value ? `Zoho user ${value}` : null);

  return (
    <div className={e.picker} ref={wrapRef}>
      <button
        type="button"
        className={e.pickerValue}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={label ? e.pickerName : `${e.pickerName} ${e.pickerEmpty}`}>
          {busy ? 'Saving…' : (label ?? placeholder)}
        </span>
        {value && onClear && !busy && (
          // A span, not a nested button: a button inside a button is invalid HTML and the inner one
          // stops receiving clicks in some browsers.
          <span
            role="button"
            tabIndex={0}
            className={e.seatX}
            // aria-label, not just title: the element's own text is the "×" glyph, and text content wins
            // over title in accessible-name computation — so a title alone would name this control "×".
            aria-label={`Clear ${ariaLabel} — this level becomes unrouted again`}
            title="Clear — this level becomes unrouted again"
            onClick={(ev) => {
              ev.stopPropagation();
              onClear();
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                ev.stopPropagation();
                onClear();
              }
            }}
          >
            ×
          </span>
        )}
        <svg className={e.pickerCaret} width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {open && (
        <div className={e.pickerPanel} role="listbox" aria-label={ariaLabel}>
          <div className={e.pickerSearch}>
            <input
              ref={searchRef}
              className={s.input}
              value={term}
              onChange={(ev) => setTerm(ev.target.value)}
              placeholder="Search name, email, designation…"
              aria-label="Search people"
            />
          </div>
          <div className={e.pickerList}>
            {shown.length === 0 ? (
              <div className={e.pickerNone}>
                {candidates.length === 0
                  ? 'No HR employees have a linked Zoho user id yet. Link them in HR first — that id is what routing uses.'
                  : 'Nobody matches that search.'}
              </div>
            ) : (
              shown.map((c) => (
                <button
                  key={c.zohoUserId}
                  type="button"
                  role="option"
                  aria-selected={c.zohoUserId === value}
                  className={c.zohoUserId === value ? `${e.pickerOpt} ${e.pickerOptActive}` : e.pickerOpt}
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                  }}
                >
                  <span className={e.pickerOptBody}>
                    <span className={e.pickerOptName}>{c.name}</span>
                    <span className={e.pickerOptMeta}>
                      {[c.designation, c.department, c.email].filter(Boolean).join(' · ') ||
                        `Zoho user ${c.zohoUserId}`}
                    </span>
                  </span>
                  {c.leadOfDepartments.length > 0 && (
                    <span className={e.leadHint} title="HR has this person as a department lead">
                      Dept lead
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
