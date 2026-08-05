import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isActiveStatus } from './hrData';
import { useModalFocus } from './useModalFocus';

function dayValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Mirrors PATCH /hr/time-off/settings, which refuses any approver without a linked Zoho login.
 *
 * `zohoUserId` is set only by the explicit user-link flow, so most of the directory fails this — the
 * picker has to say which names are eligible instead of letting the admin find out one 409 at a time.
 */
function eligibleApprover(employee: HrEmployeeDto): boolean {
  return isActiveStatus(employee.status) && Boolean(employee.zohoUserId?.trim());
}

const APPROVER_NEEDS_LOGIN = 'Final approver must be an active employee with a linked login.';

/** Key for the settings PATCH inside the write batch. Leave type ids are uuids, so it cannot collide. */
const APPROVER_WRITE = 'settings:finalApprover';

/**
 * Edits a reconciling `load()` must leave alone.
 *
 * A PATCH that rejected committed nothing, so its input still holds the only copy of what the admin
 * typed; re-seeding it from the server would silently throw the retry away. Anything not listed here
 * is re-seeded from the response, which is the whole point of reconciling after a partial commit.
 */
interface PreserveEdits {
  approver?: boolean;
  leaveTypeIds?: ReadonlySet<string>;
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
  /** Holiday row primed for deletion — see the row button for why this is not `busy`. */
  const [armed, setArmed] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  /**
   * Which load is the current one.
   *
   * The refresh after every write goes through `load()` with no AbortSignal, so an AbortController on
   * the effect cannot cancel it: switching the year while a post-write refresh is in flight would let
   * the old year's response land last and sit there mislabelled. A sequence number covers both paths.
   */
  const seq = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, preserve?: PreserveEdits) => {
    const mine = ++seq.current;
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
      if (mine !== seq.current) return;
      setData(settings);
      setEmployees(employeeResult.items);
      if (!preserve?.approver) setApproverId(settings.settings.finalApproverEmployeeId ?? '');
      setDefaults((current) =>
        Object.fromEntries(
          settings.types.map((type) => [
            type.id,
            preserve?.leaveTypeIds?.has(type.id)
              ? current[type.id] ?? dayValue(type.defaultDays)
              : dayValue(type.defaultDays),
          ]),
        ),
      );
    } catch (err) {
      if (mine !== seq.current) return;
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      // A superseded load must not clear the busy state the newer one is holding.
      if (mine === seq.current) setBusy('');
    }
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * A primed delete belongs to the row it was clicked on, and it self-cancels: a stray first click
   * must not leave a delete armed on a list the admin has stopped looking at.
   */
  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => setArmed(null), 4000);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setArmed(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [armed]);

  const changeYear = (next: number): void => {
    // A different year is a different holiday list, so nothing in it can still be primed.
    setArmed(null);
    setYear(next);
  };

  /**
   * The three offered years plus whichever one is selected — a holiday added outside the window jumps
   * the selector there (see addHoliday), and a controlled <select> with no matching option renders blank.
   */
  const yearOptions = useMemo(
    () => [...new Set([currentYear - 1, currentYear, currentYear + 1, year])].sort((a, b) => a - b),
    [currentYear, year],
  );

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    [employees],
  );

  const savePolicy = async (): Promise<void> => {
    if (!data || !approverId) {
      setError('Choose a final HR approver.');
      return;
    }
    // `approverId` can be a stale id — seeded from the stored setting, or held across a refetch — and a
    // disabled <option> is still skipped rather than blocked, so re-check before spending a request.
    const approver = employees.find((employee) => employee.id === approverId);
    if (!approver || !eligibleApprover(approver)) {
      setError(APPROVER_NEEDS_LOGIN);
      return;
    }
    /**
     * Validate every field BEFORE the first request goes out.
     *
     * These writes are independent PATCHes with no transaction spanning them, so throwing from inside
     * the Promise.all array left the approver and the earlier types already committed — and unawaited —
     * while the panel reported a validation failure and kept showing the rejected numbers.
     */
    const parsed: { id: string; days: number }[] = [];
    for (const type of data.types) {
      const raw = (defaults[type.id] ?? '').trim();
      // Number('') is 0, so a cleared box used to save a 0-day allowance under a success banner — and
      // "Apply defaults" would then write that 0 onto every active employee. Blank is invalid, not zero.
      const value = raw === '' ? Number.NaN : Number(raw);
      // Mirrors the server's z.number().min(0).max(366).multipleOf(0.5).
      if (!Number.isFinite(value) || value < 0 || value > 366 || (value * 2) % 1 !== 0) {
        setError(`${type.name} needs a valid balance — 0 to 366 days, in steps of 0.5.`);
        return;
      }
      parsed.push({ id: type.id, days: value });
    }
    setBusy('policy');
    setError('');
    setMessage('');
    /**
     * allSettled, not all: the outcome has to be known per request. Promise.all reports one rejection
     * and cannot say whether the others committed, so reconciling on it refetched over the admin's
     * typed allowances even when nothing had been written — the common failure (offline, 500, expired
     * session) rejects every PATCH and leaves the server exactly as it was.
     */
    const writes: { key: string; run: Promise<unknown> }[] = [
      { key: APPROVER_WRITE, run: updateTimeOffSettings({ finalApproverEmployeeId: approverId }) },
      ...parsed.map((entry) => ({
        key: entry.id,
        run: updateLeaveType(entry.id, { defaultDays: entry.days }),
      })),
    ];
    const results = await Promise.allSettled(writes.map((write) => write.run));
    const rejectedKeys = new Set<string>();
    let rejectedCount = 0;
    let failure = '';
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      rejectedCount += 1;
      const key = writes[index]?.key;
      if (key !== undefined) rejectedKeys.add(key);
      if (!failure) {
        failure = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
    });
    if (rejectedCount === 0) {
      setMessage('Time Off policy saved. Existing yearly balances stay unchanged until you apply defaults.');
      await load();
      return;
    }
    if (rejectedCount === writes.length) {
      // Nothing committed, so there is nothing to reconcile against — refetching would replace every
      // box the admin just filled in with the stored values they were changing away from, and Save
      // could only be retried by retyping the lot.
      setBusy('');
      setError(failure);
      return;
    }
    // Partial commit: a rejected PATCH does not roll back the ones beside it, so show what the server
    // now holds — except the fields that failed, whose input is the only copy of the pending edit.
    // load() clears the banner on entry, which is why the failure is raised after it.
    await load(undefined, {
      approver: rejectedKeys.has(APPROVER_WRITE),
      leaveTypeIds: new Set(parsed.filter((entry) => rejectedKeys.has(entry.id)).map((entry) => entry.id)),
    });
    setError(failure);
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
      const created = await createHoliday({
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
      /**
       * The list is fetched per year, so a holiday dated outside the selected one saves and then is
       * absent from the table this message points at. Follow it instead of blocking the date —
       * queueing next year's calendar is a real use case.
       *
       * Slice the ISO string; `new Date(...).getFullYear()` reads a UTC midnight in local time and
       * puts every Jan 1 in the previous year.
       */
      const createdYear = Number(created.date.slice(0, 4));
      // setYear re-keys `load`, so the effect refetches — awaiting load() here too would double-fetch.
      // Integer-checked because a NaN year would go straight into the next request's query.
      if (Number.isInteger(createdYear) && createdYear !== year) changeYear(createdYear);
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy('');
    }
  };

  const removeHoliday = async (holiday: HolidayDto): Promise<void> => {
    setArmed(null);
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
          <select
            value={year}
            disabled={Boolean(busy)}
            onChange={(event) => changeYear(Number(event.target.value))}
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
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
                  {sortedEmployees.map((employee) => {
                    // Ineligible names stay visible but unselectable: dropping colleagues from the
                    // list altogether reads as "their record is missing", not "they cannot approve".
                    const eligible = eligibleApprover(employee);
                    return (
                      <option key={employee.id} value={employee.id} disabled={!eligible}>
                        {employee.firstName} {employee.lastName}
                        {employee.designation ? ` · ${employee.designation}` : ''}
                        {eligible ? '' : ' · no login linked'}
                      </option>
                    );
                  })}
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
                        // An empty box reads as "0 days" but means "unchanged", so snap it back to the
                        // stored allowance rather than letting it look like a policy of zero.
                        onBlur={() =>
                          setDefaults((current) =>
                            (current[type.id] ?? '').trim() === ''
                              ? { ...current, [type.id]: dayValue(type.defaultDays) }
                              : current,
                          )
                        }
                      />
                      <strong>days / year</strong>
                    </div>
                    <small>{type.isPaid ? 'Paid allowance' : 'Unpaid allowance'}</small>
                  </label>
                ))}
              </div>
              <div className="hr-leave-policy-actions">
                {/* Danger tone, and `.hr-btn-danger`'s margin-right:auto pushes it clear of Save — the
                    two used to sit side by side, same size, same styling, one of them irreversible. */}
                <button type="button" className="hr-btn hr-btn-danger" disabled={Boolean(busy)} onClick={() => setConfirmReset(true)}><RotateCcw size={14} />Apply defaults to {year}</button>
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

          {/* Gated on the loaded year, not the selected one: the rows and the heading above them can
              then never disagree while a switch is in flight. */}
          {data.year === year ? (
          <div className="hr-holiday-settings">
            <div className="hr-holiday-settings-title">
              <div><span>Company calendar</span><h4>{data.year} holidays</h4></div>
              <p>Weekends and full holidays do not consume leave balance. Half-days consume 0.5.</p>
            </div>
            <div className="hr-holiday-create">
              {/* min/max are a hint only — the native pickers still accept a typed out-of-range date,
                  so the selector follows the created holiday instead (see addHoliday). */}
              <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
              <input type="text" value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Holiday name" maxLength={160} />
              <label><input type="checkbox" checked={halfDay} onChange={(event) => setHalfDay(event.target.checked)} />Half day</label>
              {halfDay ? <select value={halfSession} onChange={(event) => setHalfSession(event.target.value as 'morning' | 'afternoon')}><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select> : null}
              <button type="button" className="hr-btn hr-btn-primary" disabled={Boolean(busy)} onClick={() => void addHoliday()}><Plus size={14} />Add</button>
            </div>
            <div className="hr-holiday-table">
              {data.holidays.map((holiday) => {
                /* Two clicks, because a delete is immediate and server-side with no restore path, and
                   these rows are 40px tall in a scroller. The armed row is tracked separately from
                   `busy` on purpose: `busy` disables the button, so the confirming click would land on
                   a disabled control. */
                const isArmed = armed === holiday.id;
                return (
                <div key={holiday.id} className="hr-holiday-setting-row">
                  <span>{new Date(`${holiday.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })}</span>
                  <strong>{holiday.name}</strong>
                  <small>{holiday.isHalfDay ? `${holiday.session} half-day` : holiday.location}</small>
                  <button
                    type="button"
                    aria-label={isArmed ? `Confirm delete ${holiday.name}` : `Delete ${holiday.name}`}
                    title={isArmed ? 'Click again to remove this holiday' : undefined}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (isArmed) void removeHoliday(holiday);
                      else setArmed(holiday.id);
                    }}
                  >
                    {busy === holiday.id ? <HrBusy /> : isArmed ? <Check size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
                );
              })}
              {data.holidays.length === 0 ? <p className="hr-leave-settings-empty">No holidays configured for {data.year}.</p> : null}
            </div>
          </div>
          ) : busy ? (
            /* Any busy state, not just 'load': a write that switches the year (addHoliday following a
               holiday it just created) commits the new year one render before the effect starts the
               refetch, and that gap must not read as a failure. */
            <p className="hr-leave-settings-empty">Loading {year} holidays…</p>
          ) : (
            /* Stale year with nothing in flight means the switch's fetch failed and `data` is still the
               previous year's. Claiming a load is running would strand the section on "Loading…" —
               recoverable only by toggling the select — so offer the retry the panel otherwise lacks. */
            <div className="hr-leave-settings-empty">
              <p style={{ margin: '0 0 10px' }}>Could not load {year} holidays.</p>
              <button type="button" className="hr-btn" onClick={() => void load()}>
                <RotateCcw size={14} />
                Retry
              </button>
            </div>
          )}
        </>
      ) : null}

      {confirmReset ? (
        <HrResetDefaultsConfirm
          year={year}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            void resetYear();
          }}
        />
      ) : null}

      {message ? <p className="hr-settings-ok">{message}</p> : null}
      {error ? <p className="hr-banner-error" role="alert">{error}</p> : null}
    </section>
  );
}

/**
 * Confirmation for "Apply defaults" — the one action on this panel that rewrites other people's data.
 *
 * In-app rather than window.confirm, as every other HR confirmation is: the copy has to name the scope
 * (every active employee, that one year) and that individual allowances are destroyed, which a native
 * dialog cannot say in the module's own voice. Its own component purely so it can hold hooks — a
 * conditionally-rendered branch cannot call `useModalFocus` or register the Escape listener.
 */
function HrResetDefaultsConfirm({
  year,
  onCancel,
  onConfirm,
}: {
  year: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>();

  // The reset only starts once this closes, so there is never a write in flight a dismissal could hide.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="hr-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="hr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hr-leave-reset-title"
        aria-describedby="hr-leave-reset-body"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="hr-modal-head">
          <h2 id="hr-leave-reset-title">Overwrite {year} balances?</h2>
        </header>
        <p id="hr-leave-reset-body">
          This replaces the allocated days of <b>every active employee</b> for {year} with the policy
          defaults above. Individual adjustments to allocated days will be lost, and this cannot be
          undone.
        </p>
        <div className="hr-modal-actions">
          <button type="button" className="hr-btn" onClick={onCancel}>
            Cancel
          </button>
          {/* `.hr-btn-danger` carries margin-right:auto for the department editor's left-aligned
              Delete; here the destructive action IS the primary one, so it stays on the right. */}
          <button
            type="button"
            className="hr-btn hr-btn-danger"
            style={{ marginRight: 0 }}
            onClick={onConfirm}
          >
            <RotateCcw size={14} />
            Overwrite {year} balances
          </button>
        </div>
      </div>
    </div>
  );
}
