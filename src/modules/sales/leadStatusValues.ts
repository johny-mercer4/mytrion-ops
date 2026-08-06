/**
 * Verbatim Zoho Leads Status + dependent reason picklists (live-verified).
 * Shared by Data Center PATCH validation and Blueprint required-field enrichment.
 */
export const LEAD_STATUS_VALUES = [
  'Interested',
  'Not Interested',
  'First Call',
  'Second Call',
  'Third Call',
  'Follow-up',
  'Unqualified',
  'Application Filled',
  'Email Follow-Up',
  'Unaccounted', // display "New Lead"
] as const;

export const LEAD_UNQUALIFIED_REASONS = [
  'Wrong / inactive phone number',
  'Invalid email',
  'Not in trucking industry',
  'Not using diesel',
  'Local driver',
  'Low credit score for LOC',
  'No response',
] as const;

export const LEAD_NOT_INTERESTED_REASONS = [
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
] as const;
