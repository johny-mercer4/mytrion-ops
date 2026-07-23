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
 * Status phases. The "call number" (First → Second → Third Call) is advanced AUTOMATICALLY on the
 * backend from the call-log count on every ended outbound call — call statuses are NEVER manually
 * settable. ENTRY_STATUSES = a fresh / uncategorized lead ('New Lead'/'Unaccounted'/'No Status').
 */
export const ENTRY_STATUSES = ['New Lead', 'Unaccounted', 'No Status', ''];
export const CALL_STATUSES = ['First Call', 'Second Call', 'Third Call'];
/** The manual OUTCOME statuses — the ONLY statuses an agent may set by hand. */
export const OUTCOME_STATUSES = ['Interested', 'Not Interested', 'Follow-up', 'Email Follow-Up', 'Unqualified'];
/**
 * Automation-only statuses — never offered in any manual picker. First/Second/Third Call are set by
 * the call-count auto-advance; Application Filled is set when the application is filled.
 */
export const NON_MANUAL_STATUSES = ['Application Filled', 'First Call', 'Second Call', 'Third Call'];

/**
 * The lead-status "blueprint" — the MANUAL transitions allowed FROM each status. Only OUTCOMES are
 * manual, and only from a calling state:
 *   New Lead / entry → (nothing — call the lead; the call auto-advances the call number)
 *   First / Second / Third Call → Interested · Not Interested · Follow-up · Email Follow-Up · Unqualified
 *   any outcome / terminal → (nothing)
 * First/Second/Third Call and Application Filled are automation-only and never appear as targets.
 */
const BLUEPRINT: Record<string, string[]> = {
  'New Lead': [],
  Unaccounted: [],
  'No Status': [],
  'First Call': OUTCOME_STATUSES,
  'Second Call': OUTCOME_STATUSES,
  'Third Call': OUTCOME_STATUSES,
  Interested: [],
  'Not Interested': [],
  'Follow-up': [],
  'Email Follow-Up': [],
  Unqualified: [],
  'Application Filled': [],
};

/** The manual outcome options (in picklist order) — the post-call wizard's picker. */
export const OUTCOME_OPTIONS = STATUS_OPTIONS.filter((o) => OUTCOME_STATUSES.includes(o.value));

/**
 * Blueprint-allowed manual statuses reachable from the CURRENT status (for the LeadModal editor).
 * New Lead → [] (call only); First/Second/Third Call → the outcomes; any outcome/terminal → [].
 * Unknown status → the outcome set (never trap the agent). Call numbers + Application Filled are
 * never included.
 */
export function allowedStatuses(
  current: string | null | undefined,
): { value: string; label: string }[] {
  if (current == null || current === '') return OUTCOME_OPTIONS;
  const targets = BLUEPRINT[current];
  if (!targets) return OUTCOME_OPTIONS;
  return STATUS_OPTIONS.filter((o) => targets.includes(o.value));
}

/**
 * Whether an ended outbound call should open the post-call OUTCOME wizard. The call-number status is
 * set automatically on the backend from the call count, so the wizard never pre-selects it — it only
 * lets the agent optionally pick an OUTCOME (which supersedes the auto call number). Force it only
 * while the lead is still in the calling phase; a categorized lead is left alone. `preselect` is
 * always '' (the agent picks an outcome or closes).
 */
export function resolveWizardStatus(
  current: string | null | undefined,
): { show: boolean; preselect: string } {
  const key = current ?? '';
  const inCallingPhase = current == null || ENTRY_STATUSES.includes(key) || CALL_STATUSES.includes(key);
  return { show: inCallingPhase, preselect: '' };
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
