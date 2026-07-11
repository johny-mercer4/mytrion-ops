/**
 * Sales Mytrion redesign — Create tab. Ported from the reference prototype (create.html +
 * script.js renderVals/create handlers) at pixel fidelity: a single "Create a Ticket" form
 * with a department picker (C/Q/V/M colored cards), a Low/Normal/High/Critical priority
 * picker, subject + details fields, and a submit button that spins while the request is in
 * flight then toasts. All form state is local; on submit it files a real support/escalation
 * ticket via the `tickets.create_escalation` touchpoint (identity server-injected) and the
 * toast is delivered through the shared shell context. No mock data.
 */
import { useState } from 'react';
import { callTouchpoint } from '@/api/touchpoints';
import { s } from '../dc';
import { useSales } from '../ctx';

/** A department picker card view-model (reference `createDepts`). */
interface DeptCardVM {
  id: string;
  label: string;
  style: string;
  dot: string;
  labelStyle: string;
  onClick: () => void;
}

/** A priority pill view-model (reference `createPriorities`). */
interface PriorityVM {
  label: string;
  style: string;
  onClick: () => void;
}

const DEPTS: readonly [string, string, string][] = [
  ['C', 'Customer Service', 'var(--orange)'],
  ['Q', 'Billing', 'var(--accent)'],
  ['V', 'Verification', 'var(--ok)'],
  ['M', 'Maintenance', 'var(--violet)'],
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIO_COLS: Record<Priority, string> = {
  Low: 'var(--ok)',
  Normal: 'var(--accent)',
  High: 'var(--orange)',
  Critical: 'var(--danger)',
};

const LABEL_STYLE =
  'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:9px;text-transform:uppercase;letter-spacing:.05em';

export function CreateTab() {
  const { pushToast } = useSales();
  const [createDept, setCreateDept] = useState<string>('C');
  const [createPriority, setCreatePriority] = useState<Priority>('Normal');
  const [createSubject, setCreateSubject] = useState<string>('');
  const [createBody, setCreateBody] = useState<string>('');
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);

  // ----- view-model (mirrors renderVals() `create` block) -----
  const createDepts: DeptCardVM[] = DEPTS.map(([id, label, col]) => {
    const on = createDept === id;
    return {
      id,
      label,
      style: `flex:1;padding:13px 10px;border-radius:12px;border:1px solid ${
        on ? col : 'var(--border)'
      };background:${
        on ? `color-mix(in srgb,${col} 12%,transparent)` : 'var(--alt)'
      };cursor:pointer;text-align:center;transition:all .14s`,
      dot: `width:9px;height:9px;border-radius:50%;background:${col};margin:0 auto 7px`,
      labelStyle: `font-size:12px;font-weight:700;color:${on ? 'var(--text)' : 'var(--muted)'}`,
      onClick: () => setCreateDept(id),
    };
  });

  const createPriorities: PriorityVM[] = PRIORITIES.map((p) => {
    const on = createPriority === p;
    const col = PRIO_COLS[p];
    return {
      label: p,
      style: `flex:1;padding:9px;border-radius:9px;border:1px solid ${
        on ? col : 'var(--border)'
      };background:${
        on ? `color-mix(in srgb,${col} 14%,transparent)` : 'var(--alt)'
      };color:${on ? col : 'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer;transition:all .14s`,
      onClick: () => setCreatePriority(p),
    };
  });

  const subjectFilled = createSubject.trim().length > 0;
  const createCanSubmit = subjectFilled && !createSubmitting;
  const createCannot = !subjectFilled || createSubmitting;

  // Department selection drives the escalation reason (identity is server-injected).
  const deptReason = (id: string): string => DEPTS.find(([d]) => d === id)?.[1] ?? 'Other';

  const submitCreate = async (): Promise<void> => {
    if (createSubmitting) return;
    const subject = createSubject.trim();
    if (!subject) return;
    setCreateSubmitting(true);
    try {
      const res = await callTouchpoint('tickets.create_escalation', {
        escalationReason: deptReason(createDept),
        questionSubject: subject,
        description: createBody,
        attachmentUrl: '',
      });
      if (!res.ticketId || !res.escalationId) {
        throw new Error(res.message || 'Ticket was not created — no ticket id returned.');
      }
      setCreateSubject('');
      setCreateBody('');
      pushToast('Ticket created', 'Routed to the right team — you’ll see updates in your inbox');
    } catch (e) {
      pushToast('Couldn’t create ticket', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <div className="ss-fu" style={s('max-width:680px;margin:0 auto')}>
      <div style={s('margin-bottom:18px')}>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Create a Ticket
        </div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>
          Can't self-serve it? File a ticket and we'll route it to the right team.
        </div>
      </div>
      <div
        style={s(
          'padding:24px;border-radius:18px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:20px',
        )}
      >
        <div>
          <div style={s(LABEL_STYLE)}>Department</div>
          <div style={s('display:flex;gap:10px')}>
            {createDepts.map((d) => (
              <button key={d.id} onClick={d.onClick} style={s(d.style)}>
                <div style={s(d.dot)}></div>
                <div style={s(d.labelStyle)}>{d.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={s(LABEL_STYLE)}>Priority</div>
          <div style={s('display:flex;gap:9px')}>
            {createPriorities.map((p) => (
              <button key={p.label} onClick={p.onClick} style={s(p.style)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={s(LABEL_STYLE)}>Subject</div>
          <input
            value={createSubject}
            onChange={(e) => setCreateSubject(e.target.value)}
            placeholder="Brief summary of the request"
            className="ss-in"
            style={s(
              'width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px',
            )}
          />
        </div>
        <div>
          <div style={s(LABEL_STYLE)}>Details</div>
          <textarea
            value={createBody}
            onChange={(e) => setCreateBody(e.target.value)}
            placeholder="What's needed, which carrier / card, and any context…"
            className="ss-in"
            style={s(
              'width:100%;min-height:120px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13.5px;resize:vertical;line-height:1.5',
            )}
          />
        </div>
        <div style={s('display:flex;justify-content:flex-end')}>
          {createCanSubmit && (
            <button
              onClick={() => void submitCreate()}
              className="ss-btn-p"
              style={s(
                'height:46px;padding:0 26px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;box-shadow:0 6px 18px rgba(var(--accent-rgb),.35)',
              )}
            >
              Create Ticket
            </button>
          )}
          {createSubmitting && (
            <button
              disabled
              style={s(
                'height:46px;padding:0 26px;border-radius:12px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:9px;opacity:.85',
              )}
            >
              <span
                style={s(
                  'width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite',
                )}
              ></span>
              Creating…
            </button>
          )}
          {createCannot && (
            <button
              disabled
              style={s(
                'height:46px;padding:0 26px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13.5px;cursor:not-allowed',
              )}
            >
              Create Ticket
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
