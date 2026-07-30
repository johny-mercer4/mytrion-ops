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
import { useHrDirectory } from './hrData';
import { HrBusy } from './HrBits';

const TZ_OPTIONS = [
  'Asia/Tashkent',
  'Asia/Samarkand',
  'UTC',
  'Europe/Moscow',
  'America/New_York',
];

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const [exportEmpId, setExportEmpId] = useState('');
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));

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
    setError('');
    try {
      await assignAttendanceShift(assignShiftId, {
        employeeIds: [assignEmpId],
        effectiveFrom,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (): Promise<void> => {
    if (busy || !exportEmpId) return;
    setBusy(true);
    setError('');
    try {
      const { csv, filename } = await exportAttendanceCsv({
        from: exportFrom,
        to: exportTo,
        employeeId: exportEmpId,
      });
      downloadCsv(csv, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const empLabel = (e: HrEmployeeDto): string =>
    `${e.firstName} ${e.lastName}`.trim() + (e.faceId ? ` · FaceID ${e.faceId}` : '');

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
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TZ_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start (HH:mm)
            <input value={startLocal} onChange={(e) => setStartLocal(e.target.value)} placeholder="19:00" />
          </label>
          <label>
            End (HH:mm)
            <input value={endLocal} onChange={(e) => setEndLocal(e.target.value)} placeholder="03:00" />
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
            <select value={assignShiftId} onChange={(e) => setAssignShiftId(e.target.value)}>
              <option value="">—</option>
              {shifts
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Employee
            <select value={assignEmpId} onChange={(e) => setAssignEmpId(e.target.value)}>
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empLabel(e)}
                </option>
              ))}
            </select>
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
      </section>

      <section className="hr-settings-card">
        <h3>Export attendance</h3>
        <p>Download historical day rows as CSV for one employee.</p>
        <div className="hr-settings-form-grid">
          <label>
            Employee
            <select value={exportEmpId} onChange={(e) => setExportEmpId(e.target.value)}>
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empLabel(e)}
                </option>
              ))}
            </select>
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
      </section>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
