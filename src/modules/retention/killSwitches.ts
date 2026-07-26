/**
 * Retention escalation kill-switches — logic stays in place; flip to `true` to restore.
 *
 * Current product pause (cases still generate / Sales can work stages):
 * - No auto or manual Open Pool entry
 * - No Phase 2 Retention handoff (incl. Dissatisfied → Retention desk)
 * - No Zoho Deal/Contact/Account Owner rewrite on Open Pool claim
 * - CS RoundRobin / handoff Owner transfer stays behind RETENTION_AUTO_ASSIGN_ENABLED
 */

/** enterOpenPool (manual 5× OoR, Reached timer, Retention→Pool timer, claim paths). */
export const RETENTION_OPEN_POOL_ESCALATION_ENABLED = false;

/**
 * handoffToRetention (Dissatisfied, no_action_2bd, escalate_retention, deadline sweep).
 * When false, Dissatisfied stays Phase 1 `p1_dissatisfied` (Sales keeps the case + Zoho Owner).
 */
export const RETENTION_PHASE2_ESCALATION_ENABLED = false;

/**
 * Open Pool claim → Zoho Deal/Contact/Account Owner to claimant.
 * Off = Sales keeps CRM ownership even if a claim were allowed.
 */
export const RETENTION_OPEN_POOL_CLAIM_ZOHO_TRANSFER_ENABLED = false;
