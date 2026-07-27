import { UserRound } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { HrPageHead } from '../HrBits';

/**
 * HR → Profile. One employee record in full.
 *
 * The sections will mirror how Zoho People groups its fields (personal / work / reporting), with
 * `tabularSections` — education, work experience, dependents — as its own sub-view rather than
 * squeezed into a row. See `peopleSchema.ts` for the confirmed field names.
 */
export function HrProfile() {
  return (
    <div className="hr-page">
      <HrPageHead tab="profile" />
      <ComingSoon
        icon={<UserRound size={26} />}
        title="Employee profile"
        body="One employee in full — personal, work and reporting details, plus education, work history and dependents. Which record this opens (the signed-in user, or a directory selection) is still an open decision."
        sources={['Zoho People · employee form']}
        tone="var(--tone-violet)"
      />
    </div>
  );
}
