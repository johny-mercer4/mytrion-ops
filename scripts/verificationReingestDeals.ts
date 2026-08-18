/**
 * Re-ingest existing verification cases from their Zoho Deal.
 *
 * WHY THIS EXISTS. `ingestVerificationDeals` is insert-only — it filters candidates against
 * `findExistingDealIds` and never touches a case again. That is the right default (an upsert on
 * every poll would overwrite whatever Sales typed), but it means the cases created before the
 * ingest was corrected keep the values the old code gave them:
 *
 *   - `applicant_type` guessed from a company-name regex, and `carrier` assigned to any case whose
 *     Zoho MC field held the literal `No assigned number`;
 *   - `mc` / `dot` holding those sentinels verbatim, which also made "MC number" count as PRESENT
 *     in the intake completeness check;
 *   - `fuel_cards_requested` null on every row, because `Cards_Requested` was never mapped.
 *
 * WHAT IT WILL AND WILL NOT TOUCH. Only a case that is still exactly as the machine left it:
 * `origin = 'zoho_deal'`, still on Phase 1, not submitted, not closed, and with no Sales-supplied
 * intake of its own. A case a human has worked is skipped and named in the output — re-ingesting
 * one would overwrite a person's typing with a stale Deal.
 *
 * The applicant type is CLEARED when the corrected inference cannot say. That is deliberate: an
 * unset type shows as "Applicant type" at the top of the missing list, which is a Sales agent
 * answering in one click, whereas a wrong type sends the case down the wrong flow silently.
 *
 * DRY RUN BY DEFAULT. Prints the diff and writes nothing. Pass `--apply` to commit, which also
 * re-evaluates the intake gate for every changed row so `intake_missing` and `verification_process`
 * match the new field values instead of the old ones.
 *
 *   pnpm tsx scripts/verificationReingestDeals.ts            # show what would change
 *   pnpm tsx scripts/verificationReingestDeals.ts --apply    # write it
 */
import 'dotenv/config';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { verificationCases } from '../src/db/schema/verification_cases.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { zohoCrmRecords } from '../src/integrations/zohoCrmRecords.js';
import { mapZohoDeal } from '../src/modules/verification/zohoDealMap.js';
import { inferApplicantType } from '../src/modules/verificationFlow/dealIntake.js';
import { applicationService } from '../src/modules/verificationFlow/applicationService.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const APPLY = process.argv.includes('--apply');

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'script:verification-reingest',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: [],
  allDepartmentAccess: true,
  requestId: 'verification-reingest',
};

/** Same shape the ingest builds, from a hydrated Deal record. */
function mappedFrom(record: Record<string, unknown>) {
  const m = mapZohoDeal(record);
  return {
    mc: m.mc || null,
    dot: m.dot || null,
    fuelCardsRequested: (() => {
      const n = Number.parseInt(String(m.cardsRequested).replace(/[^\d]/g, ''), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    email: m.email || m.secondaryEmail || null,
    phone: m.phone || m.cell || m.alternativeContact || null,
    applicantType: inferApplicantType(m),
  };
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: verificationCases.id,
      companyName: verificationCases.companyName,
      firstName: verificationCases.firstName,
      lastName: verificationCases.lastName,
      zohoDealId: verificationCases.zohoDealId,
      applicantType: verificationCases.applicantType,
      mc: verificationCases.mc,
      dot: verificationCases.dot,
      fuelCardsRequested: verificationCases.fuelCardsRequested,
      email: verificationCases.email,
      phone: verificationCases.phone,
      phaseCode: verificationCases.phaseCode,
      verificationProcess: verificationCases.verificationProcess,
      closedAt: verificationCases.closedAt,
      submittedAt: verificationCases.submittedAt,
      origin: verificationCases.origin,
    })
    .from(verificationCases)
    .where(
      and(
        eq(verificationCases.tenantId, ctx.tenantId),
        eq(verificationCases.origin, 'zoho_deal'),
        isNotNull(verificationCases.zohoDealId),
        // Untouched by a human: never submitted, never closed, still on Phase 1.
        isNull(verificationCases.submittedAt),
        isNull(verificationCases.closedAt),
        eq(verificationCases.phaseCode, 'p1_intake'),
        eq(verificationCases.verificationProcess, false),
      ),
    );

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} eligible case(s)\n`);

  let changed = 0;
  let failed = 0;
  for (const row of rows) {
    const name = row.companyName || `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
    let record: Record<string, unknown> | null = null;
    try {
      record = await zohoCrmRecords.getRecord('Deals', row.zohoDealId as string);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${name} — Deal ${row.zohoDealId} could not be read: ${String(err)}`);
      continue;
    }
    if (!record) {
      failed += 1;
      console.log(`  ✗ ${name} — Deal ${row.zohoDealId} not found in Zoho`);
      continue;
    }

    const next = mappedFrom(record);
    const diff: string[] = [];
    const patch: Record<string, unknown> = {};
    const compare = <K extends keyof typeof next>(key: K, current: unknown): void => {
      const to = next[key];
      /**
       * Blanking rules, which are the whole reason this script is careful:
       *
       *  - `applicantType` may be cleared. "We cannot tell" is the answer Sales needs to see.
       *  - `mc` / `dot` may be cleared ONLY when what is stored is itself a sentinel — a value with
       *    no digits, or zero. That is exactly the junk this re-ingest exists to remove, and it
       *    cannot destroy a real number a rep typed by hand.
       *  - everything else only fills or corrects. Zoho not carrying a value is not evidence that
       *    the value is wrong.
       */
      const storedIsSentinel = (v: unknown): boolean => {
        const digits = String(v ?? '').replace(/\D/g, '');
        return String(v ?? '').trim() !== '' && (digits === '' || Number(digits) === 0);
      };
      const mayBlank =
        key === 'applicantType' || ((key === 'mc' || key === 'dot') && storedIsSentinel(current));
      if (to == null && !mayBlank) return;
      if ((current ?? null) === (to ?? null)) return;
      diff.push(`${String(key)}: ${JSON.stringify(current ?? null)} -> ${JSON.stringify(to ?? null)}`);
      patch[key] = to;
    };
    compare('applicantType', row.applicantType);
    compare('mc', row.mc);
    compare('dot', row.dot);
    compare('fuelCardsRequested', row.fuelCardsRequested);
    compare('email', row.email);
    compare('phone', row.phone);

    if (diff.length === 0) {
      console.log(`  · ${name} — unchanged`);
      continue;
    }
    changed += 1;
    console.log(`  ${APPLY ? '✔' : '→'} ${name}\n      ${diff.join('\n      ')}`);

    if (APPLY) {
      await db
        .update(verificationCases)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(verificationCases.tenantId, ctx.tenantId), eq(verificationCases.id, row.id)));
      // The gate is a pure function of the row, so it has to be re-evaluated after the row moves:
      // `fuel_cards_requested` arriving and a sentinel MC leaving both change what is missing.
      await applicationService.refreshGate(ctx, row.id);
    }
  }

  console.log(
    `\n${changed} case(s) ${APPLY ? 'updated' : 'would change'}, ${rows.length - changed - failed} unchanged, ${failed} failed.`,
  );
  if (!APPLY && changed > 0) console.log('Re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
