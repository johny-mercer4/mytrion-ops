/**
 * HR → Settings. Admin-only: Zoho People directory sync, attendance shifts, export, webhook ops.
 */
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isAdmin } from '../../../access/resolveAccess';
import { syncHrDepartments, syncHrEmployees, type HrSyncResult } from '../../../api/hr';
import { useUserContext } from '../../../context/UserContextProvider';
import { HrAttendanceSettings } from '../HrAttendanceSettings';
import { HrLeaveSettings } from '../HrLeaveSettings';
import { invalidateHrDepartments, invalidateHrEmployees } from '../hrData';
import { HrBusy, HrEmpty, HrPageHead } from '../HrBits';

function formatSync(label: string, result: HrSyncResult): string {
  const err = result.errors.length
    ? ` · ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`
    : '';
  return `${label}: fetched ${result.fetched}, inserted ${result.inserted}, updated ${result.updated}${err}`;
}

export function HrSettings() {
  const user = useUserContext();
  const admin = isAdmin(user);
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
    <div className="hr-page">
      <HrPageHead tab="settings" />

      <section className="hr-settings-card">
        <h3>Zoho People sync</h3>
        <p>
          Pull employee and department records into Mytrion&apos;s own tables (Face ID included).
          Attendance punches are Mytrion-only and are not synced from Zoho.
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
        {busy ? <HrBusy label="Syncing from Zoho People…" /> : null}
        {message ? <p className="hr-settings-ok">{message}</p> : null}
        {error ? (
          <p className="hr-banner-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <HrAttendanceSettings />
      <HrLeaveSettings />
    </div>
  );
}
