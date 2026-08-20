/**
 * Every distinct thing the reviewer can set in motion on the case screen.
 *
 * The keys are REGIONS as the reviewer sees them, not endpoints: the three decision-bar buttons are
 * three keys because they are three buttons, while the credit and banking panes are separate because
 * they save separately. `load` is here so a failed open renders through the same one error slot.
 */
export type CaseActionKey =
  | 'load'
  | 'intake'
  | 'principal'
  | 'screening'
  /** Phase 4's register lookup — its own key so only the Authority pane's control reports. */
  | 'authority'
  /** Phase 8's Highway review — its own key, so a failed save reports beside that pane. */
  | 'highway'
  | 'credit'
  | 'banking'
  | 'risk'
  | 'decision'
  | 'attach'
  | 'request'
  | 'pass'
  | 'manager'
  | 'deposit'
  | 'decline'
  /** Withdrawing a phase decision — its own key, so only the Reopen control reports. */
  | 'reopen';
