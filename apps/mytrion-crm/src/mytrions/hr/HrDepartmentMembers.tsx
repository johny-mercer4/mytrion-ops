/**
 * People assigned to a department — shown inside the department modal.
 *
 * Add/remove write `departmentId` on the employee (via PATCH), the same path the org canvas uses.
 * Zoho-synced rows can be reassigned by the next People sync; that is an existing product caveat,
 * not unique to this picker.
 */
import { useMemo, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { updateHrEmployee, type HrEmployeeDto } from '../../api/hr';
import { isActiveStatus } from './hrData';
import { HrAvatar } from './HrAvatar';
import { HrBusy } from './HrBits';

const displayName = (e: HrEmployeeDto): string => `${e.firstName} ${e.lastName}`.trim();

export function HrDepartmentMembers({
  departmentId,
  departmentName,
  employees,
  admin,
  onChanged,
}: {
  departmentId: string;
  departmentName: string;
  employees: readonly HrEmployeeDto[];
  admin: boolean;
  onChanged: () => void;
}) {
  const [addId, setAddId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const members = useMemo(
    () =>
      employees
        .filter((e) => e.departmentId === departmentId)
        .slice()
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [employees, departmentId],
  );

  const candidates = useMemo(
    () =>
      employees
        .filter((e) => e.departmentId !== departmentId && isActiveStatus(e.status))
        .slice()
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [employees, departmentId],
  );

  const move = async (employeeId: string, nextDepartmentId: string | null): Promise<void> => {
    if (!admin || busyId) return;
    setBusyId(employeeId);
    setError('');
    try {
      await updateHrEmployee(employeeId, { departmentId: nextDepartmentId });
      setAddId('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="hr-deptm-members">
      <h3>
        People
        <span className="hr-deptm-members-count">
          {members.length} in {departmentName}
        </span>
      </h3>

      {members.length === 0 ? (
        <p className="hr-rt-empty">No one assigned to this department yet.</p>
      ) : (
        <ul className="hr-deptm-member-list">
          {members.map((e) => {
            const name = displayName(e);
            return (
              <li key={e.id} className={busyId === e.id ? 'is-busy' : undefined}>
                <HrAvatar name={name} photoUrl={e.photoUrl} size="sm" />
                <span className="hr-deptm-member-ident">
                  <strong>{name}</strong>
                  <span>{e.designation ?? e.email ?? '—'}</span>
                </span>
                {admin ? (
                  <button
                    type="button"
                    className="hr-icon-btn hr-icon-danger"
                    aria-label={`Remove ${name} from ${departmentName}`}
                    title="Remove from department"
                    disabled={busyId != null}
                    onClick={() => void move(e.id, null)}
                  >
                    <UserMinus size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {admin ? (
        <div className="hr-deptm-member-add">
          <label>
            Add person
            <select
              value={addId}
              disabled={busyId != null || candidates.length === 0}
              onChange={(e) => setAddId(e.target.value)}
            >
              <option value="">
                {candidates.length === 0 ? 'Everyone is already assigned' : '— choose someone —'}
              </option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {displayName(e)}
                  {e.department ? ` · ${e.department}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="hr-btn"
            disabled={!addId || busyId != null}
            onClick={() => {
              if (addId) void move(addId, departmentId);
            }}
          >
            <UserPlus size={14} />
            Add
          </button>
        </div>
      ) : null}

      {busyId ? <HrBusy label="Updating…" /> : null}
      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
