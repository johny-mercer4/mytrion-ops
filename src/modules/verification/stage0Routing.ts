/**
 * STAGE 0 — which credit agent a brand-new application goes to.
 *
 * The desk has more than one credit agent (`VERIFICATION_CASE_OWNER_ZOHO_USER_IDS` is a list, and the
 * order in it is deliberate). Before this, every case went to `ids[0]`: one agent was notified about
 * every application in the company and the others were told nothing.
 *
 * LEAST RECENTLY ASSIGNED WINS, declaration order breaks the tie.
 *
 * Not a stored cursor, and that is a decision rather than a shortcut — `mytrion_comms_routing` makes
 * the same argument for its own claim: a counter can drift out of step with what actually happened
 * (an agent added, removed, or reordered mid-rotation), whereas "who has waited longest" is derived
 * from the assignments that really exist and is correct the moment the roster changes. An agent who
 * has never been assigned has waited longest of all, so a new joiner goes first.
 *
 * NOBODY CONFIGURED means NOBODY ASSIGNED. This returns null rather than picking a default, because
 * an unassigned case is visible on the desk queue as unassigned, while a case quietly parked on
 * whoever happened to be first in an env var is a case nobody knows they own.
 */
import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';
import { verificationCaseAssignmentRepo } from '../../repos/verificationCaseAssignmentRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { resolveActAsTarget } from '../auth/actAsDirectory.js';

export interface Stage0Assignee {
  zohoUserId: string;
  /** Directory name, or null when it cannot be resolved. Never a placeholder word. */
  name: string | null;
}

/**
 * The next credit agent in the rotation.
 *
 * `candidateIds` is the configured list IN ORDER. The order is the tie-break, so two agents who have
 * never been assigned resolve to the first one declared — which makes a fresh environment behave
 * exactly like the old single-owner ingest until the second case arrives.
 */
export async function pickStage0Assignee(
  ctx: TenantContext,
  candidateIds: readonly string[],
): Promise<Stage0Assignee | null> {
  if (candidateIds.length === 0) return null;
  if (candidateIds.length === 1) {
    const only = candidateIds[0] as string;
    return { zohoUserId: only, name: await resolveName(only) };
  }

  const lastAssigned = await verificationCaseAssignmentRepo.lastAssignedAt(ctx, candidateIds);

  let winner = candidateIds[0] as string;
  let winnerAt = lastAssigned.get(winner);
  for (const candidate of candidateIds.slice(1)) {
    const at = lastAssigned.get(candidate);
    // Never assigned beats any date; otherwise the older timestamp wins. Equal timestamps keep the
    // incumbent, which is what makes declaration order the tie-break.
    if (winnerAt === undefined) break;
    if (at === undefined || at.getTime() < winnerAt.getTime()) {
      winner = candidate;
      winnerAt = at;
    }
  }

  return { zohoUserId: winner, name: await resolveName(winner) };
}

/**
 * The agent's name from the CRM directory.
 *
 * Best-effort: a directory outage must not stop an application being created or assigned. The name is
 * a snapshot for display and history, and the id is what everything joins on.
 */
async function resolveName(zohoUserId: string): Promise<string | null> {
  try {
    const target = await resolveActAsTarget(zohoUserId);
    return target?.name?.trim() || null;
  } catch (err) {
    logger.warn(
      { err: errorMessage(err), zohoUserId },
      'stage 0 routing: could not resolve the credit agent name — assigning by id only',
    );
    return null;
  }
}
