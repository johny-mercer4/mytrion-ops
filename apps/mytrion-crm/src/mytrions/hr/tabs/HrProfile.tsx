import { HrPageHead, HrSection, Pill, PreviewBanner, toneFor } from '../HrBits';
import { fullName, initials, orDash, PREVIEW_EMPLOYEES } from '../peoplePreview';

/**
 * HR → Profile. One employee record in full.
 *
 * The three sections mirror how Zoho People actually groups the fields, so the later fetch maps
 * straight across (field names in parentheses are the real People API keys, confirmed by the live
 * inspection — see peoplePreview.ts):
 *
 *   Personal   FirstName · LastName · Date_of_birth · Age · Mobile · EmailID
 *   Work       EmployeeID · Department · Designation · LocationName · Dateofjoining · Employeestatus
 *   Reporting  Reporting_To · Second_Reporting_To · Role · Experience
 *
 * `tabularSections` (Education Details / Work experience / Dependent Details) is a nested object
 * rather than a scalar, so it needs its own sub-view later — deliberately not squeezed in here.
 *
 * Which employee this shows is a placeholder choice: today it renders the first preview record. Once
 * wired it becomes either the signed-in user's own record or a directory selection.
 */

const employee = PREVIEW_EMPLOYEES[0]!;

export function HrProfile() {
  return (
    <div className="hr-page">
      <HrPageHead tab="profile" />
      <PreviewBanner what="Profile" />

      <div className="hr-profile-head">
        <span className="hr-avatar">{initials(employee.firstName, employee.lastName)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="hr-profile-name">{fullName(employee)}</div>
          <div className="hr-profile-role">
            {orDash(employee.designation)} · {orDash(employee.department)}
          </div>
        </div>
        <Pill label={employee.status} tone={toneFor(employee.status)} />
      </div>

      <HrSection title="Personal">
        <dl className="hr-dl">
          <div>
            <dt>First name</dt>
            <dd>{orDash(employee.firstName)}</dd>
          </div>
          <div>
            <dt>Last name</dt>
            <dd>{orDash(employee.lastName)}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{orDash(employee.email)}</dd>
          </div>
        </dl>
      </HrSection>

      <HrSection title="Work">
        <dl className="hr-dl">
          <div>
            <dt>Employee ID</dt>
            <dd>{orDash(employee.employeeId)}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{orDash(employee.department)}</dd>
          </div>
          <div>
            <dt>Designation</dt>
            <dd>{orDash(employee.designation)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{orDash(employee.location)}</dd>
          </div>
          <div>
            <dt>Date of joining</dt>
            <dd>{orDash(employee.joined)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{employee.status}</dd>
          </div>
        </dl>
      </HrSection>

      <HrSection title="Reporting">
        <dl className="hr-dl">
          <div>
            <dt>Reports to</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Second reporting to</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{orDash(employee.role)}</dd>
          </div>
          <div>
            <dt>Experience</dt>
            <dd>—</dd>
          </div>
        </dl>
      </HrSection>
    </div>
  );
}
