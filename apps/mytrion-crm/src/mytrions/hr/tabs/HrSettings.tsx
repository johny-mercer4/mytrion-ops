/**
 * HR → Settings. Admin-only control center for directory sync, attendance, and Time Off policy.
 * Sections are tabbed so operators stay on one screen instead of scrolling a stacked page.
 */
import { useState } from 'react';
import { CalendarClock, DatabaseZap, RefreshCw, Settings2 } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import { syncHrDepartments, syncHrEmployees, type HrSyncResult } from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrAttendanceSettings } from '../HrAttendanceSettings';
import { HrLeaveSettings } from '../HrLeaveSettings';
import { invalidateHrDepartments, invalidateHrEmployees } from '../hrData';
import { HrEmpty, HrPageHead } from '../HrBits';

type SettingsPane = 'directory' | 'attendance' | 'timeoff';

function formatSync(label: string, result: HrSyncResult): string {
  const err = result.errors.length
    ? ` · ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`
    : '';
  const attendance = result.relinkedAttendancePunches
    ? ` · reconciled ${result.relinkedAttendancePunches} attendance punch${result.relinkedAttendancePunches === 1 ? '' : 'es'}`
    : '';
  return `${label}: fetched ${result.fetched}, inserted ${result.inserted}, updated ${result.updated}${attendance}${err}`;
}

export function HrSettings() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const [pane, setPane] = useState<SettingsPane>('directory');
  const [busy, setBusy] = useState<'employees' | 'departments' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!admin) {
    return (
      <div className="hr-page">
        <HrPageHead tab="settings" />
        <HrEmpty
          icon={<RefreshCw size={26} />}
          title="Admin only"
          body="HR settings (sync, shifts, export) are available to Administrator Zoho profiles."
        />
      </div>
    );
  }

  const run = async (kind: 'employees' | 'departments'): Promise<void> => {
    if (busy) return;
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      if (kind === 'employees') {
        const result = await syncHrEmployees();
        invalidateHrEmployees();
        setMessage(formatSync('Employees', result));
      } else {
        const result = await syncHrDepartments();
        invalidateHrDepartments();
        setMessage(formatSync('Departments', result));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hr-page hr-settings-page">
      <HrPageHead tab="settings" />

      <div className="hr-settings-chrome">
        <p className="hr-settings-lede">
          Directory sync, attendance shifts, and Time Off policy — one workspace.
        </p>
        <div className="hr-settings-panes" role="tablist" aria-label="Settings areas">
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'directory'}
            className={`hr-settings-pane${pane === 'directory' ? ' is-on' : ''}`}
            onClick={() => setPane('directory')}
          >
            <DatabaseZap size={15} />
            Directory
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'attendance'}
            className={`hr-settings-pane${pane === 'attendance' ? ' is-on' : ''}`}
            onClick={() => setPane('attendance')}
          >
            <CalendarClock size={15} />
            Attendance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'timeoff'}
            className={`hr-settings-pane${pane === 'timeoff' ? ' is-on' : ''}`}
            onClick={() => setPane('timeoff')}
          >
            <Settings2 size={15} />
            Time Off
          </button>
        </div>
      </div>

      {pane === 'directory' ? (
        <section className="hr-settings-card">
          <div className="hr-settings-card-head">
            <div>
              <span>Directory sync</span>
              <h3>Zoho People records</h3>
            </div>
            <DatabaseZap size={20} />
          </div>
          <p>
            Pull employee and department records into Mytrion&apos;s own tables. Attendance punches
            are Mytrion-only and are not synced from Zoho.
          </p>
          <div className="hr-settings-actions">
            <button
              type="button"
              className="hr-btn hr-btn-primary"
              disabled={busy != null}
              onClick={() => void run('employees')}
            >
              <RefreshCw size={14} className={busy === 'employees' ? 'hr-spin' : undefined} />
              Sync employees
            </button>
            <button
              type="button"
              className="hr-btn"
              disabled={busy != null}
              onClick={() => void run('departments')}
            >
              <RefreshCw size={14} className={busy === 'departments' ? 'hr-spin' : undefined} />
              Sync departments
            </button>
          </div>
          {/* The pressed button's own spinning icon is the one loader for this fetch — this line only
              carries the label and the screen-reader announcement, so it must not animate too. */}
          {busy ? (
            <p className="hr-note" role="status" aria-live="polite">
              Syncing from Zoho People…
            </p>
          ) : null}
          {message ? <p className="hr-settings-ok">{message}</p> : null}
          {error ? (
            <p className="hr-banner-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      {pane === 'attendance' ? (
        <div className="hr-settings-card-stack">
          <HrAttendanceSettings />
        </div>
      ) : null}

      {pane === 'timeoff' ? (
        <div className="hr-settings-leave-wrap">
          <HrLeaveSettings />
        </div>
      ) : null}
    </div>
  );
}
