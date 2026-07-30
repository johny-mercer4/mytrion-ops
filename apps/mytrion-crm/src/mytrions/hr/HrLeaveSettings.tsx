import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import { listHrEmployees, type HrEmployeeDto } from '../../api/hr';
import {
  createHoliday,
  deleteHoliday,
  getTimeOffSettings,
  resetLeaveBalances,
  updateLeaveType,
  updateTimeOffSettings,
  type HolidayDto,
  type LeaveTypeDto,
  type TimeOffSettingsDto,
} from '../../api/hrTimeOff';
import { HrBusy, HrPageLoader } from './HrBits';

function dayValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function HrLeaveSettings() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<TimeOffSettingsDto | null>(null);
  const [employees, setEmployees] = useState<HrEmployeeDto[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [approverId, setApproverId] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [halfSession, setHalfSession] = useState<'morning' | 'afternoon'>('morning');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy('load');
    setError('');
    try {
      const [settings, employeeResult] = await Promise.all([
        getTimeOffSettings(year, signal),
        listHrEmployees({
          status: 'Active',
          limit: 500,
          ...(signal ? { signal } : {}),
        }),
      ]);
      setData(settings);
      setEmployees(employeeResult.items);
      setApproverId(settings.settings.finalApproverEmployeeId ?? '');
      setDefaults(Object.fromEntries(settings.types.map((type) => [type.id, dayValue(type.defaultDays)])));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy('');
    }
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    [employees],
  );

  const savePolicy = async (): Promise<void> => {
    if (!data || !approverId) {
      setError('Choose a final HR approver.');
      return;
    }
    setBusy('policy');
    setError('');
    setMessage('');
    try {
      await Promise.all([
        updateTimeOffSettings({ finalApproverEmployeeId: approverId }),
        ...data.types.map((type) => {
          const value = Number(defaults[type.id]);
          if (!Number.isFinite(value) || value < 0) throw new Error(`${type.name} needs a valid balance`);
          return updateLeaveType(type.id, { defaultDays: value });
        }),
      ]);
      setMessage('Time Off policy saved. Existing yearly balances stay unchanged until you apply defaults.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy('');
    }
  };

  const resetYear = async (): Promise<void> => {
    setBusy('reset');
    setError('');
    setMessage('');
    try {
      const updated = await resetLeaveBalances(year);
      setMessage(`Applied the policy defaults to ${updated} employee balance records for ${year}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const addHoliday = async (): Promise<void> => {
    if (!holidayDate || !holidayName.trim()) {
      setError('Holiday date and name are required.');
      return;
    }
    setBusy('holiday');
    setError('');
    setMessage('');
    try {
      await createHoliday({
        date: holidayDate,
        name: holidayName.trim(),
        location: 'Uzbekistan',
        isHalfDay: halfDay,
        session: halfDay ? halfSession : null,
        isActive: true,
        notes: null,
      });
      setHolidayDate('');
      setHolidayName('');
      setHalfDay(false);
      setMessage('Holiday added to the company calendar.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy('');
    }
  };

  const removeHoliday = async (holiday: HolidayDto): Promise<void> => {
    setBusy(holiday.id);
    setError('');
    try {
      await deleteHoliday(holiday.id);
      setMessage(`${holiday.name} removed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy('');
    }
  };

  return (
    <section className="hr-leave-settings">
      <header className="hr-leave-settings-head">
        <div className="hr-leave-settings-icon"><Settings2 size={22} /></div>
        <div>
          <span>Time Off policy</span>
          <h3>Allowances &amp; holidays</h3>
          <p>Yearly balances, final HR approver, and the company holiday calendar.</p>
        </div>
        <label className="hr-leave-year">
          <CalendarDays size={15} />
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            <option value={currentYear - 1}>{currentYear - 1}</option>
            <option value={currentYear}>{currentYear}</option>
            <option value={currentYear + 1}>{currentYear + 1}</option>
          </select>
        </label>
      </header>

      {busy === 'load' && !data ? (
        <HrPageLoader label="Loading Time Off policy…" />
      ) : null}

      {data ? (
        <>
          <div className="hr-leave-policy-grid">
            <div className="hr-leave-policy-main">
              <label className="hr-leave-setting-field">
                <span>Final HR approver</span>
                <select value={approverId} onChange={(event) => setApproverId(event.target.value)}>
                  <option value="">Choose an employee…</option>
                  {sortedEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                      {employee.designation ? ` · ${employee.designation}` : ''}
                    </option>
                  ))}
                </select>
                <small>Department lead approval is first. This employee makes the final decision.</small>
              </label>
              <div className="hr-leave-defaults">
                {data.types.map((type: LeaveTypeDto) => (
                  <label key={type.id} className="hr-leave-default">
                    <span>{type.name}</span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="366"
                        step="0.5"
                        value={defaults[type.id] ?? ''}
                        onChange={(event) =>
                          setDefaults((current) => ({
                            ...current,
                            [type.id]: event.target.value,
                          }))
                        }
                      />
                      <strong>days / year</strong>
                    </div>
                    <small>{type.isPaid ? 'Paid allowance' : 'Unpaid allowance'}</small>
                  </label>
                ))}
              </div>
              <div className="hr-leave-policy-actions">
                <button type="button" className="hr-btn" disabled={Boolean(busy)} onClick={() => void resetYear()}><RotateCcw size={14} />Apply defaults to {year}</button>
                <button type="button" className="hr-btn hr-btn-primary" disabled={Boolean(busy)} onClick={() => void savePolicy()}>{busy === 'policy' ? <HrBusy /> : <Save size={14} />}Save policy</button>
              </div>
            </div>
            <aside className="hr-leave-escalation">
              <span>Approval route</span>
              <div><strong>1</strong><p><b>Department lead</b><small>Manager linked on the employee&apos;s department</small></p></div>
              <i />
              <div><strong>2</strong><p><b>{data.settings.finalApproverName ?? 'Final approver not set'}</b><small>HR final decision</small></p></div>
              <p className="hr-leave-escalation-note"><Check size={14} /> If the requester is the lead, the request goes directly to HR.</p>
            </aside>
          </div>

          <div className="hr-holiday-settings">
            <div className="hr-holiday-settings-title">
              <div><span>Company calendar</span><h4>{year} holidays</h4></div>
              <p>Weekends and full holidays do not consume leave balance. Half-days consume 0.5.</p>
            </div>
            <div className="hr-holiday-create">
              <input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
              <input type="text" value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Holiday name" maxLength={160} />
              <label><input type="checkbox" checked={halfDay} onChange={(event) => setHalfDay(event.target.checked)} />Half day</label>
              {halfDay ? <select value={halfSession} onChange={(event) => setHalfSession(event.target.value as 'morning' | 'afternoon')}><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select> : null}
              <button type="button" className="hr-btn hr-btn-primary" disabled={Boolean(busy)} onClick={() => void addHoliday()}><Plus size={14} />Add</button>
            </div>
            <div className="hr-holiday-table">
              {data.holidays.map((holiday) => (
                <div key={holiday.id} className="hr-holiday-setting-row">
                  <span>{new Date(`${holiday.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })}</span>
                  <strong>{holiday.name}</strong>
                  <small>{holiday.isHalfDay ? `${holiday.session} half-day` : holiday.location}</small>
                  <button type="button" aria-label={`Delete ${holiday.name}`} disabled={Boolean(busy)} onClick={() => void removeHoliday(holiday)}>{busy === holiday.id ? <HrBusy /> : <Trash2 size={14} />}</button>
                </div>
              ))}
              {data.holidays.length === 0 ? <p className="hr-leave-settings-empty">No holidays configured for {year}.</p> : null}
            </div>
          </div>
        </>
      ) : null}

      {message ? <p className="hr-settings-ok">{message}</p> : null}
      {error ? <p className="hr-banner-error" role="alert">{error}</p> : null}
    </section>
  );
}
