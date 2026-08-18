/**
 * Phase 1 writes — the desk correcting the Sales-owned application.
 *
 * Split out of `deskService` for the 600-line cap, the same way `deskReviews` was. The write itself
 * is here; the closed-case guard, the gate refresh and the detail re-read stay in `deskService`,
 * matching how the review writes are arranged.
 *
 * ONE RULE LIVES HERE: a correction that changes something is a timeline event. Until this existed,
 * saving corrections was the only mutation on the case that left no trace — `patchIntake` writes
 * columns and nothing else, and `setGate` appends only when the gate actually FLIPS — so a reviewer
 * who fixed an EIN watched the Phase log stay exactly as it was and had no way to tell the save had
 * landed. The desk's `eventText` has rendered an `intake_saved` row since the log was built; no
 * writer ever produced one.
 */
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import type { VerificationCase } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { zohoFromCtx, type IntakePatch } from './applicationService.js';

/**
 * Which of the patched columns the write actually MOVED.
 *
 * Compares the row before against the row the update returned rather than trusting the patch keys:
 * the desk sends only the fields it edited, but re-typing a value that was already there is not a
 * correction and must not appear in the case's timeline as one.
 *
 * The two casts index a Drizzle row by a runtime key. Every `IntakePatch` key IS a column of
 * `verification_cases`, but that relationship is not expressible as an index signature on the
 * inferred row type, and a per-field switch here would be twenty lines restating the patch type.
 */
function changedColumns(
  before: VerificationCase,
  after: VerificationCase | undefined,
  patch: IntakePatch,
): string[] {
  if (!after) return [];
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  return Object.keys(patch).filter((key) => String(b[key] ?? '') !== String(a[key] ?? ''));
}

/**
 * Apply the desk's correction and record it.
 *
 * Change-aware on purpose: the intake route accepts `{}` as a no-op read, so appending
 * unconditionally would file an event for every empty submit.
 */
export async function saveIntakeCorrection(
  ctx: TenantContext,
  before: VerificationCase,
  patch: IntakePatch,
): Promise<void> {
  const updated = await verificationFlowRepo.patchIntake(ctx, before.id, patch);
  const corrected = changedColumns(before, updated, patch);
  if (corrected.length === 0) return;

  await verificationFlowRepo.appendEvent(ctx, {
    caseId: before.id,
    fromPhase: before.phaseCode,
    toPhase: before.phaseCode,
    fromStatus: before.statusCode,
    toStatus: before.statusCode,
    eventType: 'intake_saved',
    actorZohoUserId: zohoFromCtx(ctx) ?? null,
    actorName: ctx.userName || ctx.userId,
    notes:
      corrected.length === 1
        ? 'One application field corrected by the desk.'
        : `${corrected.length} application fields corrected by the desk.`,
  });
}
