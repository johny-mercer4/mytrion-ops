/**
 * HR → one person, seen whole. What the "View as" picker opens.
 *
 * IT IS A LENS, NOT A DISGUISE. Picking someone here does not sign you in as them: your session, your
 * permissions and your audit trail are unchanged, and the panel only shows what you could already read
 * through the ordinary HR routes. The one block that is genuinely scoped tighter than the directory is
 * attendance, and the server says so per viewer rather than failing the whole page — see `canView`.
 *
 * Everything arrives in ONE request (`/hr/employees/:id/overview`). Five blocks meant five fetches and
 * five separate skeletons flickering in at different moments; one payload paints the panel at once.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CalendarDays,
  Inbox,
  Lock,
  Users,
} from 'lucide-react';
import {
  getHrEmployeeByZohoUser,
  getHrPersonOverview,
  type HrPersonOverviewDto,
  type HrPersonTeamMember,
} from '../../api/hrPerson';
import { departmentIcon, departmentTone } from './departmentAppearance';
import { HrAttendanceWeek } from './HrAttendanceWeek';
import { HrAvatar } from './HrAvatar';
import { HrEmpty, HrPageLoader, Pill, toneFor } from './HrBits';
import { tashkentToday } from './attendanceTime';

const RELATION_LABEL: Record<HrPersonTeamMember['relation'], string> = {
  direct_report: 'Direct report',
  department_member: 'In a department they lead',
};

/** Statuses the server can return for a leave request, mapped onto the shared HR pill tones. */
const LEAVE_STATUS_LABEL: Record<string, string> = {
  pending_lead: 'Pending lead',
  pending_hr: 'Pending HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function leaveTone(status: string): string {
  if (status === 'approved') return 'var(--success)';
  if (status === 'rejected') return 'var(--danger)';
  if (status === 'cancelled') return 'var(--text-muted)';
  return 'var(--warning)';
}

function dayLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function HrPersonView({
  zohoUserId,
  name,
  subtitle,
  onExit,
}: {
  /** The picker knows a Zoho SIGN-IN; the employee row is resolved from it. */
  zohoUserId: string;
  name: string;
  /** "Profile · Role" from the picker — shown while the employee row is still resolving. */
  subtitle?: string;
  onExit: () => void;
}) {
  const today = useMemo(() => tashkentToday(), []);
  const [data, setData] = useState<HrPersonOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** Set when the sign-in resolves to no employee row — a normal state, not a failure. */
  const [unlinked, setUnlinked] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setLoading(true);
      setError('');
      setUnlinked(false);
      try {
        const employee = await getHrEmployeeByZohoUser(zohoUserId, signal);
        const overview = await getHrPersonOverview(employee.id, { signal });
        if (!signal.aborted) setData(overview);
      } catch (err) {
        if (signal.aborted) return;
        setData(null);
        const message = err instanceof Error ? err.message : String(err);
        // The lookup 404s when nobody has linked that Zoho sign-in to an employee record yet. That is
        // an HR data gap with a known fix, not an error the user can do anything with as a red banner.
        if (/no employee record/i.test(message)) setUnlinked(true);
        else setError(message);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [zohoUserId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const employee = data?.employee;
  const displayName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : name;
  const DeptIcon = departmentIcon(data?.department?.icon ?? null);
  const deptTone = departmentTone(data?.department?.iconColor ?? null, data?.department?.id);

  return (
    <div className="hr-page hr-person">
      <div className="hr-person-bar">
        <button type="button" className="hr-btn" onClick={onExit}>
          <ArrowLeft size={14} />
          Back to HR
        </button>
        <span className="hr-person-bar-note">
          Viewing one person&apos;s record. You are still signed in as yourself.
        </span>
      </div>

      <header className="hr-person-head" style={{ ['--dc' as string]: deptTone }}>
        <HrAvatar
          name={displayName}
          employeeId={employee?.id ?? null}
          photoFileId={employee?.photoFileId ?? null}
          size="lg"
        />
        <div className="hr-person-ident">
          <h1>{displayName}</h1>
          <p>{employee?.designation ?? subtitle ?? '—'}</p>
          <span className="hr-person-badges">
            {employee ? <Pill label={employee.status} tone={toneFor(employee.status)} /> : null}
            {data?.department ? (
              <span className="hr-person-dept">
                <DeptIcon size={12} />
                {data.department.name}
              </span>
            ) : null}
            {data?.manager ? (
              <span className="hr-person-manager">Reports to {data.manager.name}</span>
            ) : null}
          </span>
        </div>
      </header>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <HrPageLoader label={`Loading ${displayName}…`} />
      ) : unlinked ? (
        <HrEmpty
          icon={<Users size={26} />}
          title="No employee record"
          body={`${name} can sign in, but no HR employee record is linked to that Zoho user yet. Open the person in Employees and link their Zoho sign-in to see their team, attendance and time off.`}
        />
      ) : !data ? null : (
        <div className="hr-person-grid">
          <section className="hr-person-card">
            <header>
              <Building2 size={16} />
              <h2>Department</h2>
            </header>
            {data.department ? (
              <dl className="hr-person-facts">
                <div>
                  <dt>Department</dt>
                  <dd>{data.department.name}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd className="hr-mono">{data.department.code || '—'}</dd>
                </div>
                <div>
                  <dt>Lead</dt>
                  <dd>{data.department.leadName || '—'}</dd>
                </div>
                <div>
                  <dt>Sits under</dt>
                  <dd>{data.department.parentName || 'Top level'}</dd>
                </div>
                <div>
                  <dt>People in it</dt>
                  <dd>{data.department.headcount}</dd>
                </div>
              </dl>
            ) : (
              <p className="hr-person-none">Not assigned to a department.</p>
            )}
          </section>

          <section className="hr-person-card">
            <header>
              <Users size={16} />
              <h2>Their team</h2>
              <span className="hr-person-count">{data.team.members.length}</span>
            </header>
            {data.team.ledDepartments.length > 0 ? (
              <p className="hr-person-lede">
                Leads {data.team.ledDepartments.map((d) => d.name).join(', ')} · {' '}
                {data.team.directReportCount} direct{' '}
                {data.team.directReportCount === 1 ? 'report' : 'reports'}
              </p>
            ) : null}
            {data.team.members.length === 0 ? (
              <p className="hr-person-none">Nobody reports to this person.</p>
            ) : (
              <ul className="hr-person-team">
                {data.team.members.map((member) => (
                  <li key={member.id}>
                    <HrAvatar
                      name={`${member.firstName} ${member.lastName}`.trim()}
                      employeeId={member.id}
                      photoFileId={member.photoFileId}
                      size="sm"
                    />
                    <span className="hr-person-team-ident">
                      <strong>
                        {member.firstName} {member.lastName}
                      </strong>
                      <span>{member.designation ?? member.department ?? '—'}</span>
                    </span>
                    <span className="hr-person-relation" data-relation={member.relation}>
                      {RELATION_LABEL[member.relation]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="hr-person-card hr-person-wide">
            <header>
              <CalendarClock size={16} />
              <h2>Attendance</h2>
              <span className="hr-person-count">
                {data.attendance.from} — {data.attendance.to}
              </span>
            </header>
            {data.attendance.summary ? (
              <HrAttendanceWeek data={data.attendance.summary} today={today} />
            ) : (
              <p className="hr-person-none hr-person-locked">
                <Lock size={13} aria-hidden="true" />
                {data.attendance.canView
                  ? 'No attendance recorded for this week.'
                  : 'Attendance is limited to this person’s own managers and HR.'}
              </p>
            )}
          </section>

          <section className="hr-person-card hr-person-wide">
            <header>
              <Inbox size={16} />
              <h2>Time off</h2>
              <span className="hr-person-count">{data.timeOff.year}</span>
            </header>
            <div className="hr-person-balances">
              {data.timeOff.balances.map((balance) => (
                <div key={balance.leaveTypeId} className="hr-person-balance">
                  <span>{balance.name}</span>
                  <strong>{dayLabel(balance.availableDays)}</strong>
                  <small>
                    of {dayLabel(balance.allocatedDays)} days
                    {balance.pendingDays > 0 ? ` · ${dayLabel(balance.pendingDays)} pending` : ''}
                  </small>
                </div>
              ))}
              {data.timeOff.balances.length === 0 ? (
                <p className="hr-person-none">No leave allowances configured.</p>
              ) : null}
            </div>

            {data.timeOff.requests.length > 0 ? (
              <ul className="hr-person-requests">
                {data.timeOff.requests.map((row) => (
                  <li key={row.id}>
                    <CalendarDays size={13} aria-hidden="true" />
                    <span className="hr-person-request-type">{row.leaveTypeName}</span>
                    <span className="hr-person-request-dates">
                      {row.fromDate} → {row.toDate}
                    </span>
                    <span className="hr-person-request-days">
                      {dayLabel(row.requestedDays)} {row.requestedDays === 1 ? 'day' : 'days'}
                    </span>
                    <Pill
                      label={LEAVE_STATUS_LABEL[row.status] ?? row.status}
                      tone={leaveTone(row.status)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hr-person-none">No time-off requests in {data.timeOff.year}.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
