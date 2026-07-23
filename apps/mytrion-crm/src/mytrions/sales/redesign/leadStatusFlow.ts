/**
 * Lead status flow — "the blueprint of lead statuses". Single source of truth for the Zoho Lead
 * `Status` picklist, the reason-field dependency, and how a finished outbound call advances the
 * status. Shared by the forced post-call wizard (LeadCallWizard) AND the manual editor (LeadModal)
 * so the two can never drift.
 */
import type { IconName } from './icons';

/** Status picklist (verbatim Zoho `Status` values). 'Unaccounted' is stored; it displays "New Lead". */
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'Interested', label: 'Interested' },
  { value: 'Not Interested', label: 'Not Interested' },
  { value: 'First Call', label: 'First Call' },
  { value: 'Second Call', label: 'Second Call' },
  { value: 'Third Call', label: 'Third Call' },
  { value: 'Follow-up', label: 'Follow-up' },
  { value: 'Unqualified', label: 'Unqualified' },
  { value: 'Application Filled', label: 'Application Filled' },
  { value: 'Email Follow-Up', label: 'Email Follow-Up' },
  { value: 'Unaccounted', label: 'New Lead' },
];

export const UNQUALIFIED_REASONS = [
  'Wrong / inactive phone number',
  'Invalid email',
  'Not in trucking industry',
  'Not using diesel',
  'Local driver',
  'Low credit score for LOC',
  'No response',
];
export const NOT_INTERESTED_REASONS = [
  'Wrong language',
  'Wrong expectations',
  'Small discounts',
  'Already has another fuel card',
  'Truck stop coverage',
  'Uncomfortable with mobile app',
  'Unreachable after application',
  'Has own fueling stations',
  'Unwilling to share personal info',
  'Low credit score / bad financials',
  "Didn't apply / applied accidentally",
  'Gas only',
  'Accidental application',
  'Low discounts',
  'Other',
];

/** Which status forces a reason picklist, and which Zoho field it writes. */
export function reasonFieldFor(
  status: string,
): { field: 'Unqualified_Reason' | 'Not_Interested_Reason'; options: string[] } | null {
  if (status === 'Unqualified') return { field: 'Unqualified_Reason', options: UNQUALIFIED_REASONS };
  if (status === 'Not Interested') return { field: 'Not_Interested_Reason', options: NOT_INTERESTED_REASONS };
  return null;
}

/**
 * The "call sequence". A finished outbound call advances the lead one step through it.
 * ENTRY_STATUSES = a lead not yet in the sequence (fresh / uncategorized). Both 'New Lead' and
 * 'Unaccounted' (shown as "New Lead") and the synthetic 'No Status' are treated as entry, so the
 * first call always advances to 'First Call' regardless of which raw value the CRM carries.
 */
export const ENTRY_STATUSES = ['New Lead', 'Unaccounted', 'No Status', ''];
export const CALL_STATUSES = ['First Call', 'Second Call', 'Third Call'];
/** Post-call outcome statuses (reachable after the third call). */
export const OUTCOME_STATUSES = ['Follow-up', 'Email Follow-Up', 'Unqualified'];
/** Set only by automation (Interested → Application Filled) — never a manual transition. */
export const NON_MANUAL_STATUSES = ['Application Filled'];

/**
 * The Zoho Leads Blueprint — the manual transitions allowed FROM each status:
 *   New Lead     → First Call · Interested · Not Interested
 *   First Call   → Second Call                     (strictly sequential — no skipping)
 *   Second Call  → Third Call
 *   Third Call   → Follow-up · Email Follow-Up · Unqualified
 *   Interested   → (Application Filled, set automatically — no manual onward transition)
 * Outcome states are terminal for manual editing. 'Application Filled' is never a manual target.
 */
const BLUEPRINT: Record<string, string[]> = {
  'New Lead': ['First Call', 'Interested', 'Not Interested'],
  Unaccounted: ['First Call', 'Interested', 'Not Interested'],
  'No Status': ['First Call', 'Interested', 'Not Interested'],
  'First Call': ['Second Call'],
  'Second Call': ['Third Call'],
  'Third Call': ['Follow-up', 'Email Follow-Up', 'Unqualified'],
  Interested: [],
  'Not Interested': [],
  'Follow-up': [],
  'Email Follow-Up': [],
  Unqualified: [],
  'Application Filled': [],
};

/** Every status an agent may set by hand (everything except the automation-only ones). */
const MANUAL_STATUSES = STATUS_OPTIONS.filter((o) => !NON_MANUAL_STATUSES.includes(o.value));

/** current status → next sequential call step (Third Call has no further call step). */
const NEXT_CALL: Record<string, string> = {
  'First Call': 'Second Call',
  'Second Call': 'Third Call',
};

/** The next sequential call step from the current status, or null if there is none. */
export function nextCallStep(current: string | null | undefined): string | null {
  if (current == null) return null;
  if (ENTRY_STATUSES.includes(current)) return 'First Call';
  return NEXT_CALL[current] ?? null;
}

/**
 * Blueprint-allowed manual statuses reachable from the CURRENT status (in picklist order).
 * Unknown/unmapped status → every manual status (never trap the agent). Automation-only statuses
 * (Application Filled) are never included.
 */
export function allowedStatuses(
  current: string | null | undefined,
): { value: string; label: string }[] {
  if (current == null || current === '') return MANUAL_STATUSES;
  const targets = BLUEPRINT[current];
  if (!targets) return MANUAL_STATUSES;
  return STATUS_OPTIONS.filter((o) => targets.includes(o.value));
}

/**
 * From a lead's CURRENT status, decide whether an ended outbound call forces the wizard and which
 * status to pre-select:
 *  - calling phase (New Lead / First / Second / Third Call, or unknown) → force the wizard
 *  - terminal / outcome status → do NOT force (the call is still logged)
 *  - preselect = the next sequential call step when the blueprint allows it (New Lead→First,
 *    First→Second, Second→Third). At Third Call there is no next call step, so nothing is
 *    pre-selected and the agent picks the outcome. Unknown → no pre-selection.
 */
export function resolveWizardStatus(
  current: string | null | undefined,
): { show: boolean; preselect: string } {
  const key = current ?? '';
  const inCallingPhase = current == null || ENTRY_STATUSES.includes(key) || CALL_STATUSES.includes(key);
  if (!inCallingPhase) return { show: false, preselect: '' };
  const step = nextCallStep(current);
  const allowed = allowedStatuses(current).map((o) => o.value);
  return { show: true, preselect: step && allowed.includes(step) ? step : '' };
}

/** Per-status color (CSS var) + icon for the status pickers — matches the pipeline color scheme. */
const STATUS_META: Record<string, { color: string; icon: IconName }> = {
  'First Call': { color: 'var(--accent)', icon: 'calls' },
  'Second Call': { color: 'var(--accent-2)', icon: 'calls' },
  'Third Call': { color: 'var(--violet)', icon: 'calls' },
  'Follow-up': { color: 'var(--orange)', icon: 'clock' },
  'Email Follow-Up': { color: 'var(--accent)', icon: 'send' },
  Interested: { color: 'var(--ok)', icon: 'check' },
  'Application Filled': { color: 'var(--orange)', icon: 'doc' },
  'Not Interested': { color: 'var(--danger)', icon: 'ban' },
  Unqualified: { color: 'var(--muted)', icon: 'warn' },
  Unaccounted: { color: 'var(--warn)', icon: 'lead' }, // displays "New Lead"
};

/** Color + icon for a status button; unknown values fall back to a neutral lead glyph. */
export function statusMeta(value: string): { color: string; icon: IconName } {
  return STATUS_META[value] ?? { color: 'var(--muted)', icon: 'lead' };
}
