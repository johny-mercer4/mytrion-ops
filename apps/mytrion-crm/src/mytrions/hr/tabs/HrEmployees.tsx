import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { HrEmpty, HrPageHead, Pill, PreviewBanner, toneFor } from '../HrBits';
import {
  PREVIEW_EMPLOYEES,
  PEOPLE_DEPARTMENTS,
  fullName,
  initials,
  orDash,
  type HrEmployeeVM,
} from '../peoplePreview';

/**
 * HR → Employees. The people directory.
 *
 * Structure is shaped by the LIVE Zoho People field coverage (see peoplePreview.ts header): the name
 * is composed from FirstName + LastName because `Full_Name` is only ~73% populated, and Department /
 * Designation / Location each render an em-dash because roughly a third of records genuinely have
 * none. Status comes from `Employeestatus` (Active / Terminated).
 *
 * Filtering and search run client-side over the placeholder rows — the same shape the real fetch
 * will return, so wiring it up is swapping the data source, not rewriting this view.
 */

type StatusFilter = 'all' | 'Active' | 'Terminated';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Active', label: 'Active' },
  { id: 'Terminated', label: 'Terminated' },
];

function EmployeeCard({ e }: { e: HrEmployeeVM }) {
  return (
    <article className="hr-emp">
      <div className="hr-emp-top">
        <span className="hr-avatar">{initials(e.firstName, e.lastName)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="hr-emp-name" title={fullName(e)}>
            {fullName(e)}
          </div>
          <div className="hr-emp-id">
            {e.employeeId} · {e.email}
          </div>
        </div>
        <Pill label={e.status} tone={toneFor(e.status)} />
      </div>

      <dl className="hr-emp-meta">
        <div className="hr-emp-cell">
          <dt>Department</dt>
          <dd title={orDash(e.department)}>{orDash(e.department)}</dd>
        </div>
        <div className="hr-emp-cell">
          <dt>Designation</dt>
          <dd title={orDash(e.designation)}>{orDash(e.designation)}</dd>
        </div>
        <div className="hr-emp-cell">
          <dt>Location</dt>
          <dd>{orDash(e.location)}</dd>
        </div>
        <div className="hr-emp-cell">
          <dt>Joined</dt>
          <dd>{orDash(e.joined)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function HrEmployees() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [dept, setDept] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PREVIEW_EMPLOYEES.filter((e) => {
      if (status !== 'all' && e.status !== status) return false;
      if (dept && e.department !== dept) return false;
      if (!needle) return true;
      return (
        fullName(e).toLowerCase().includes(needle) ||
        e.employeeId.toLowerCase().includes(needle) ||
        e.email.toLowerCase().includes(needle) ||
        e.department.toLowerCase().includes(needle) ||
        e.designation.toLowerCase().includes(needle)
      );
    });
  }, [q, status, dept]);

  return (
    <div className="hr-page">
      <HrPageHead tab="employees" />
      <PreviewBanner what="The employee directory" />

      <div className="hr-toolbar">
        <div className="hr-summary">
          <strong>{rows.length}</strong> of <strong>{PREVIEW_EMPLOYEES.length}</strong> placeholder
          records
        </div>
        <label className="hr-search">
          <Search size={15} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, employee id, email…"
          />
        </label>
      </div>

      <div className="hr-chips">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="hr-chip"
            aria-pressed={status === s.id}
            onClick={() => setStatus(s.id)}
          >
            {s.label}
          </button>
        ))}
        <span className="hr-section-line" style={{ maxWidth: 20 }} />
        {/* The real `Department` values from Zoho People — the categories are live even though the
            employee rows are not. */}
        {PEOPLE_DEPARTMENTS.slice(0, 6).map((d) => (
          <button
            key={d}
            type="button"
            className="hr-chip"
            aria-pressed={dept === d}
            onClick={() => setDept(dept === d ? null : d)}
          >
            {d}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <HrEmpty
          icon={<Users size={30} />}
          title="No employees match"
          body="Nothing matches this filter. Once Zoho People is connected this view will list the real directory."
        />
      ) : (
        <div className="hr-emp-grid">
          {rows.map((e) => (
            <EmployeeCard key={e.recordId} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}
