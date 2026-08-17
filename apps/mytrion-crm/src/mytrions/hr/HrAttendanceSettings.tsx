/**
 * Admin shift CRUD + assignment + CSV export — lives on HR Settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  assignAttendanceShift,
  createAttendanceShift,
  deleteAttendanceShift,
  exportAttendanceCsv,
  listAttendanceShifts,
  updateAttendanceShift,
  type HrAttendanceShiftDto,
  type HrEmployeeDto,
} from '../../api/hr';
import { HrSelect, type HrSelectOption } from './HrSelect';
import { useHrDirectory } from './hrData';
import { HrBusy } from './HrBits';
import { tashkentToday } from './attendanceTime';
import { deliverExport } from '@/lib/deliverExport';
import { isTelegramWebView } from '@/telegram/webApp';

/**
 * Only +5 zones are offered: every punch is bucketed, classified and formatted against a fixed
 * +5 offset (modules/hr/attendance/uzbTime.ts), so any other zone would be stored and then
 * silently ignored by the engine. Widen this list only once the engine reads `shift.timezone`.
 */
const TZ_OPTIONS = ['Asia/Tashkent', 'Asia/Samarkand'];

/** UZB calendar arithmetic on a YYYY-MM-DD string; noon UTC keeps the day stable across offsets. */
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function downloadCsv(csv: string, filename: string): Promise<void> {
  await deliverExport(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

export function HrAttendanceSettings() {
  const directory = useHrDirectory();
  const employees = directory.data?.items ?? [];
  const [shifts, setShifts] = useState<HrAttendanceShiftDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('UZB Main');
  const [timezone, setTimezone] = useState('Asia/Tashkent');
  const [startLocal, setStartLocal] = useState('19:00');
  const [endLocal, setEndLocal] = useState('03:00');

  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignEmpId, setAssignEmpId] = useState('');
  // Seeded from the UZB calendar day, not the UTC one: between 00:00 and 05:00 Tashkent the UTC
  // day is still yesterday, which would back-date the assignment (and drop today from the export).
  const [effectiveFrom, setEffectiveFrom] = useState(() => tashkentToday());
  const [assignMessage, setAssignMessage] = useState('');
  const [assignError, setAssignError] = useState('');

  const [exportEmpId, setExportEmpId] = useState('');
  const [exportFrom, setExportFrom] = useState(() => addDays(tashkentToday(), -30));
  const [exportTo, setExportTo] = useState(() => tashkentToday());
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setShifts(await listAttendanceShifts());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await createAttendanceShift({ name, timezone, startLocal, endLocal });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (shift: HrAttendanceShiftDto): Promise<void> => {
    if (busy || !window.confirm(`Delete shift “${shift.name}”?`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteAttendanceShift(shift.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onToggleActive = async (shift: HrAttendanceShiftDto): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await updateAttendanceShift(shift.id, { isActive: !shift.isActive });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onAssign = async (): Promise<void> => {
    if (busy || !assignShiftId || !assignEmpId) return;
    setBusy(true);
    setAssignMessage('');
    setAssignError('');
    try {
      await assignAttendanceShift(assignShiftId, {
        employeeIds: [assignEmpId],
        effectiveFrom,
      });
      // Assign changes nothing on screen (the shift list is unaffected), so the outcome has to be
      // stated inside this card — the shared error banner sits below all three cards, off-screen.
      const shift = shifts.find((s) => s.id === assignShiftId);
      const emp = employees.find((e) => e.id === assignEmpId);
      setAssignMessage(
        `${shift?.name ?? 'Shift'} assigned to ${emp ? empLabel(emp) : 'employee'} from ${effectiveFrom}.`,
      );
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (): Promise<void> => {
    if (busy || !exportEmpId) return;
    setBusy(true);
    setExportMessage('');
    setExportError('');
    try {
      const { csv, filename } = await exportAttendanceCsv({
        from: exportFrom,
        to: exportTo,
        employeeId: exportEmpId,
      });
      await downloadCsv(csv, filename);
      setExportMessage(
        isTelegramWebView() ? 'Sent — check your Horizon bot chat' : `Downloaded ${filename}.`,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const empLabel = (e: HrEmployeeDto): string =>
    `${e.firstName} ${e.lastName}`.trim() + (e.faceId ? ` · FaceID ${e.faceId}` : '');

  /** Built once per render of the source data — the pickers below are all the same shape. */
  const tzOptions: HrSelectOption[] = TZ_OPTIONS.map((tz) => ({ value: tz, label: tz }));
  const employeeOptions: HrSelectOption[] = employees.map((e) => ({
    value: e.id,
    label: empLabel(e),
  }));
  const activeShiftOptions: HrSelectOption[] = shifts
    .filter((shift) => shift.isActive)
    .map((shift) => ({ value: shift.id, label: shift.name }));

  return (
    <>
      <section className="hr-settings-card">
        <h3>Attendance shifts</h3>
        <p>
          Define shift timelines (UZB wall-clock for punches). Overnight shifts use an end time
          earlier than the start (e.g. 19:00–03:00).
        </p>
        {loading ? <HrBusy label="Loading shifts…" /> : null}
        <ul className="hr-settings-shift-list">
          {shifts.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <span>
                  {s.startLocal} – {s.endLocal} · {s.timezone}
                  {!s.isActive ? ' · inactive' : ''}
                </span>
              </div>
              <div className="hr-settings-shift-actions">
                <button type="button" className="hr-btn" disabled={busy} onClick={() => void onToggleActive(s)}>
                  {s.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  className="hr-icon-btn hr-icon-danger"
                  aria-label={`Delete ${s.name}`}
                  disabled={busy}
                  onClick={() => void onDelete(s)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="hr-settings-form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Timezone
            <HrSelect label="Timezone" value={timezone} onChange={setTimezone} options={tzOptions} />
          </label>
          <label>
            Start (HH:mm)
            {/* `type="time"` so the browser validates the shape. It was free text checked only by the
                server's `isValidHhMm`, which meant a typo travelled to the API to be rejected. */}
            <input type="time" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
          </label>
          <label>
            End (HH:mm)
            <input type="time" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
          </label>
        </div>
        <div className="hr-settings-actions">
          <button type="button" className="hr-btn hr-btn-primary" disabled={busy} onClick={() => void onCreate()}>
            <Plus size={14} />
            Create shift
          </button>
        </div>
      </section>

      <section className="hr-settings-card">
        <h3>Assign shift</h3>
        <p>Attach a shift to an employee from an effective date (UZB calendar).</p>
        <div className="hr-settings-form-grid">
          <label>
            Shift
            <HrSelect
              label="Shift to assign"
              value={assignShiftId}
              onChange={setAssignShiftId}
              options={activeShiftOptions}
              placeholder="Choose a shift…"
            />
          </label>
          <label>
            Employee
            <HrSelect
              label="Employee to assign"
              value={assignEmpId}
              onChange={setAssignEmpId}
              options={employeeOptions}
              placeholder="Choose an employee…"
            />
          </label>
          <label>
            Effective from
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
        </div>
        <div className="hr-settings-actions">
          <button type="button" className="hr-btn" disabled={busy} onClick={() => void onAssign()}>
            Assign
          </button>
        </div>
        {assignMessage ? <p className="hr-att-assign-ok">{assignMessage}</p> : null}
        {assignError ? (
          <p className="hr-banner-error" role="alert">
            {assignError}
          </p>
        ) : null}
      </section>

      <section className="hr-settings-card">
        <h3>Export attendance</h3>
        <p>Download historical day rows as CSV for one employee.</p>
        <div className="hr-settings-form-grid">
          <label>
            Employee
            <HrSelect
              label="Employee to export"
              value={exportEmpId}
              onChange={setExportEmpId}
              options={employeeOptions}
              placeholder="Choose an employee…"
            />
          </label>
          <label>
            From
            <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
          </label>
        </div>
        <div className="hr-settings-actions">
          <button type="button" className="hr-btn" disabled={busy} onClick={() => void onExport()}>
            Download CSV
          </button>
        </div>
        {exportMessage ? <p className="hr-att-assign-ok">{exportMessage}</p> : null}
        {exportError ? (
          <p className="hr-banner-error" role="alert">
            {exportError}
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
