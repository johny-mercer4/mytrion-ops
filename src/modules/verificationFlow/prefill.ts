/**
 * Turning a warehouse carrier record into Phase-1 suggestions.
 *
 * Pure, so it can be tested against real row shapes rather than a rendered form, and so the rule
 * about WHICH fields may be suggested lives in one readable place.
 *
 * TWO RULES, both about not overwriting a person:
 *
 *  1. A field is only suggested when the case does not already have it. The agent has spoken to
 *     the applicant; a nine-month-old FMCSA row has not. If the case says the phone is X and the
 *     warehouse says Y, the case wins and nothing is offered.
 *  2. Nothing is applied here. This builds a list; the agent clicks. `findBrokerSnapshot` matches
 *     roughly a quarter of cases, and a quarter-reliable source that writes by itself is worse
 *     than no source.
 *
 * `trucksCount` reads FMCSA power units, which is the count of vehicles registered to the
 * authority — close to "number of trucks" but not the same question, so it is offered like
 * everything else rather than trusted.
 */
import type { BrokerSnapshotMatch } from '../../integrations/dwhBrokerSnapshot.js';

/** The case columns a suggestion can target. Deliberately narrow. */
export type PrefillField =
  | 'dot'
  | 'phone'
  | 'email'
  | 'businessAddress'
  | 'residentialAddress'
  | 'trucksCount'
  | 'principalName';

export interface PrefillSuggestion {
  field: PrefillField;
  /** What the agent reads, matching the intake form's own label. */
  label: string;
  value: string;
}

/** The subset of a case this reads. Structural, so a DTO or a DB row both fit. */
export interface PrefillCandidate {
  applicantType: string | null;
  dot: string | null;
  phone: string | null;
  email: string | null;
  businessAddress: string | null;
  residentialAddress: string | null;
  trucksCount: number | null;
  principalCount: number;
}

const blank = (v: string | null | undefined): boolean => (v ?? '').trim() === '';

/** Sentinels count as absent — the same rule the Zoho boundary applies to authority numbers. */
function hasAuthority(value: string | null): boolean {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits !== '' && Number(digits) !== 0;
}

export function suggestionsFor(
  candidate: PrefillCandidate,
  match: BrokerSnapshotMatch,
): PrefillSuggestion[] {
  const out: PrefillSuggestion[] = [];
  const add = (field: PrefillField, label: string, value: string | null): void => {
    if (!blank(value)) out.push({ field, label, value: (value as string).trim() });
  };

  if (!hasAuthority(candidate.dot)) add('dot', 'USDOT number', match.dotNumber);
  if (blank(candidate.phone)) add('phone', 'Phone', match.phoneNumber);
  if (blank(candidate.email)) add('email', 'Email', match.email);

  /**
   * The warehouse holds the PHYSICAL address of the authority. For a company that is the business
   * address; for an owner-operator applying in their own name it is where they are registered,
   * which is the residential address the SOP asks for. An unset type gets neither — offering an
   * address into the wrong field is the kind of "help" that has to be undone by hand.
   */
  if (candidate.applicantType === 'carrier' || candidate.applicantType === 'company') {
    if (blank(candidate.businessAddress)) {
      add('businessAddress', 'Business address', match.physicalAddress);
    }
  } else if (candidate.applicantType === 'owner_operator') {
    if (blank(candidate.residentialAddress)) {
      add('residentialAddress', 'Residential address', match.physicalAddress);
    }
  }

  if (candidate.trucksCount == null) {
    const units = match.powerUnits ?? match.truckSize;
    if (units != null && units > 0) add('trucksCount', 'Number of trucks', String(units));
  }

  /**
   * Flow B needs at least one owner / principal, and it is the item most often outstanding on a
   * live case. `owner_full_name` is exactly that person — but only offer it while the case has
   * none, so a second principal is never suggested over the top of a real one.
   */
  if (candidate.principalCount === 0 && candidate.applicantType !== 'owner_operator') {
    add('principalName', 'Owner / principal', match.ownerFullName);
  }

  return out;
}
