/**
 * BOCA / Close Application form — Assigned To (locked to WEX SF owner), priority, due date,
 * fixed comment. Widget parity with automation-modal.template.js C-27 / C-14.
 */
import { s } from './dc';
import type { AutoPriority } from './autoRunners';

const inp42 = 'width:100%;height:42px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const locked = `${inp42};padding-right:36px;cursor:default;color:var(--text2)`;

function Lbl({ t, opt }: { t: string; opt?: boolean }) {
  return (
    <div style={s(labelCss)}>
      {t}
      {opt ? <span style={s('font-weight:400;text-transform:none')}> (optional)</span> : null}
    </div>
  );
}

export interface AutoBocaCloseFormProps {
  mode: 'boca' | 'close';
  assignedTo: string;
  assignedToLoading: boolean;
  priority: AutoPriority;
  due: string;
  minDue: string;
  onPriority: (v: AutoPriority) => void;
  onDue: (v: string) => void;
}

export function AutoBocaCloseForm({
  mode,
  assignedTo,
  assignedToLoading,
  priority,
  due,
  minDue,
  onPriority,
  onDue,
}: AutoBocaCloseFormProps) {
  const comment = mode === 'boca' ? 'Please send BOCA' : 'Please close the application.';
  const ownerLabel = assignedToLoading
    ? 'Loading owner…'
    : (assignedTo || 'Application owner');

  return (
    <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
      <div style={s('grid-column:1 / -1')}>
        <Lbl t="Assigned To" />
        <div style={s('position:relative')}>
          <input
            className="ss-in"
            value={ownerLabel}
            readOnly
            tabIndex={-1}
            title={assignedTo || 'Locked to the application owner'}
            style={s(locked)}
          />
        </div>
      </div>
      <div>
        <Lbl t="Priority" />
        <select
          value={priority}
          onChange={(e) => onPriority(e.target.value as AutoPriority)}
          className="ss-in"
          style={s(inp42)}
        >
          <option value="">-- None --</option>
          <option value="High">High</option>
          <option value="Normal">Normal</option>
          <option value="Low">Low</option>
        </select>
      </div>
      <div>
        <Lbl t="Due Date" opt />
        <input
          type="date"
          value={due}
          min={minDue}
          onChange={(e) => onDue(e.target.value)}
          className="ss-in"
          style={s(inp42)}
        />
      </div>
      <div style={s('grid-column:1 / -1')}>
        <Lbl t="Comment" />
        <input className="ss-in" value={comment} readOnly tabIndex={-1} style={s(locked)} />
      </div>
    </div>
  );
}
