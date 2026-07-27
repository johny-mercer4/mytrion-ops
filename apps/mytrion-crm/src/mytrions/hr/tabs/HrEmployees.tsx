import { Users } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { HrPageHead } from '../HrBits';

/**
 * HR → Employees. The people directory.
 *
 * Not wired to Zoho People yet, so it shows Coming soon rather than invented employees. The field
 * map that will shape this list — including which columns are sparse enough to need empty states —
 * is recorded in `peopleSchema.ts`.
 */
export function HrEmployees() {
  return (
    <div className="hr-page">
      <HrPageHead tab="employees" />
      <ComingSoon
        icon={<Users size={26} />}
        title="Employee directory"
        body="Every employee with their department, designation, role and status — searchable and filterable by department. The Zoho People field map is already captured; the fetch and pagination are what remain."
        sources={['Zoho People · employee form']}
        tone="var(--tone-sky)"
      />
    </div>
  );
}
