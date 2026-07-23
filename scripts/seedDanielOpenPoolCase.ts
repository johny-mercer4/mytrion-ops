/**
 * Ops one-shot: put one Daniel Brown Phase‑1 case into Sales Open Pool so another
 * agent can claim it (View-as test). Uses the same enterOpenPool patch as production.
 *
 * Usage: corepack pnpm exec tsx scripts/seedDanielOpenPoolCase.ts [caseId]
 */
import 'dotenv/config';
import { buildSystemContext } from '../src/modules/jobs/systemContext.js';
import { enterOpenPool, patchToUpdateInput } from '../src/modules/retention/deadlines.js';
import { notifyOpenPoolOpened } from '../src/modules/retention/notify.js';
import { retentionCaseRepo } from '../src/repos/retentionCaseRepo.js';
import { closeDb } from '../src/db/client.js';

const DANIEL_ZOHO = '6227679000031473048';

async function main(): Promise<void> {
  const ctx = buildSystemContext(['retention', 'sales']);
  const argId = process.argv[2]?.trim();

  let row = argId ? await retentionCaseRepo.findById(ctx, argId) : undefined;
  if (argId && !row) {
    throw new Error(`Case ${argId} not found`);
  }
  if (!row) {
    const open = await retentionCaseRepo.listOpen(ctx);
    // Prefer an already Out-of-Reach Daniel case; else any open Daniel Phase‑1 case.
    row =
      open.find(
        (c) =>
          c.assignedAgentZohoUserId === DANIEL_ZOHO &&
          c.phaseCode === 'phase_1_agent' &&
          c.statusCode === 'p1_out_of_reach',
      ) ??
      open.find(
        (c) => c.assignedAgentZohoUserId === DANIEL_ZOHO && c.phaseCode === 'phase_1_agent',
      );
  }
  if (!row) throw new Error('No open Daniel Brown Phase‑1 case found');
  if (row.assignedAgentZohoUserId !== DANIEL_ZOHO) {
    throw new Error(`Case ${row.id} is not assigned to Daniel Brown`);
  }
  if (row.statusCode === 'p1_open_pool') {
    console.log(JSON.stringify({ ok: true, alreadyInPool: true, caseId: String(row.id), company: row.companyName }, null, 2));
    return;
  }

  const patch = enterOpenPool({
    previousOwnerZohoUserId: row.assignedAgentZohoUserId,
    assignmentCount: row.assignmentCount,
    agentOutcome: 'out_of_reach',
    notes: 'Ops seed: moved to Open Pool for claim UX test (Daniel Brown former owner)',
  });
  const updated = await retentionCaseRepo.update(
    ctx,
    String(row.id),
    patchToUpdateInput(patch, 'system:ops-seed-pool'),
  );
  if (!updated) throw new Error('Update failed');

  await notifyOpenPoolOpened(ctx, {
    caseId: String(row.id),
    carrierId: row.carrierId,
    companyName: row.companyName,
    reason: 'out_of_reach',
    previousOwnerZohoUserId: DANIEL_ZOHO,
    zohoDealId: row.zohoDealId,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        caseId: String(updated.id),
        company: updated.companyName,
        carrierId: updated.carrierId,
        status: updated.statusCode,
        poolOwner: updated.poolOwnerZohoUserId,
        assignee: updated.assignedAgentZohoUserId,
        deadlineType: updated.currentDeadlineType,
        deadlineAt: updated.currentDeadlineAt,
        howToTest:
          'View-as any Sales agent except Daniel Brown → Retention → Open Pool → claim this deal.',
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
