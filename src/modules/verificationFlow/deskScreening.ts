/**
 * Phase 3 — Check A (ban list) and Check B (duplicates + Citifuel).
 *
 * Lifted out of `deskService` because the phase grew four independent probes and the file was over the
 * 600-line cap. The gate stays with `deskService`; everything here assumes the caller already decided
 * this case may be screened, and takes the loaded row rather than an id so it cannot re-decide.
 *
 * FOUR SOURCES, AND NONE OF THEM IS ALLOWED TO SPEAK FOR THE OTHERS:
 *
 *  | Probe | Source | Reaches what nothing else does |
 *  | --- | --- | --- |
 *  | Check A — own list | `verification_blacklist_entries` | declines this desk made itself |
 *  | Check A — real list | `credit_platform.public.blacklist_entries` | the 6,803 entries Octane maintains |
 *  | Check B — cases | `verification_cases` | EIN and phone duplicates; Zoho Deals has neither |
 *  | Check B — Deals | Zoho `Deals` via COQL | applicants who never became a case |
 *
 * A FAILED PROBE IS NOT A CLEAR. Each of the two remote probes returns an `available` flag instead of
 * throwing, and both flags land on the phase findings so the pane can say "could not reach the list"
 * rather than rendering an absence of hits. `Promise.all` here is a fan-out of four independent reads,
 * not a transaction: one unavailable source must not cost the other three.
 */
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { verificationScreeningRepo } from '../../repos/verificationScreeningRepo.js';
import { VERIFICATION_PHASE, type VerificationCase } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { matchCreditPlatformBanList } from '../../integrations/creditPlatformBlacklist.js';
import { screenDealsForCase } from '../../integrations/verificationDealScreening.js';
import { zohoFromCtx } from './applicationService.js';
import { informCollectionsOfBlacklist } from './notify.js';
import { collectIdentifiers } from './screening.js';

/** The identifier set both checks screen on. One definition, so a decline bans what screening probed. */
function identifiersOf(row: VerificationCase) {
  return collectIdentifiers({
    companyName: row.companyName,
    firstName: row.firstName,
    lastName: row.lastName,
    ein: row.ein,
    ssnLast4: row.ssnLast4,
    phone: row.phone,
    email: row.email,
    businessAddress: row.businessAddress,
    residentialAddress: row.residentialAddress,
    mc: row.mc,
    dot: row.dot,
    // No intake surface asks for the applicant's IP, so the list's 697 `ip` entries are unreachable.
    // Passing null is the honest form of that; inventing a value would make the gap invisible.
    applicantIp: null,
  });
}

/** Run all four probes and store the hits. Returns nothing — the caller re-reads the detail bundle. */
export async function runCaseScreening(ctx: TenantContext, row: VerificationCase): Promise<void> {
  const identifiers = identifiersOf(row);

  const [ours, platform, duplicates, deals] = await Promise.all([
    verificationScreeningRepo.matchBlacklist(ctx, identifiers.map((i) => i.hash)),
    matchCreditPlatformBanList(identifiers.map((i) => ({ entryType: i.entryType, value: i.value }))),
    verificationScreeningRepo.matchDuplicates(ctx, row.id, {
      ein: row.ein,
      mc: row.mc,
      dot: row.dot,
      email: row.email,
      phone: row.phone,
      companyName: row.companyName,
    }),
    screenDealsForCase({
      dealId: row.zohoDealId,
      email: row.email,
      mc: row.mc,
      dot: row.dot,
      companyName: row.companyName,
    }),
  ]);

  const byHash = new Map(identifiers.map((i) => [i.hash, i]));
  const displayByType = new Map(identifiers.map((i) => [i.entryType, i.display]));

  const hits = [
    ...ours.map((entry) => ({
      checkType: 'blacklist' as const,
      entryType: entry.entryType,
      matchedValueDisplay: byHash.get(entry.valueHash)?.display ?? entry.valueDisplay,
      matchedEntryId: entry.id,
      verdict: 'unverified' as const,
    })),
    ...platform.hits.map((hit) => ({
      checkType: 'blacklist' as const,
      entryType: hit.entryType,
      // The MASKED form of our own identifier, never the platform's stored plaintext — a hit says
      // "this applicant's email is listed", and printing the listed value adds nothing the reviewer
      // needs and everything a screenshot should not carry.
      matchedValueDisplay: displayByType.get(hit.entryType) ?? hit.cpType,
      // `cp:` prefixed so a platform row can never collide with one of our own text ids, and so the
      // desk can tell the reviewer which list a hit came from.
      matchedEntryId: `cp:${hit.entryId}`,
      note: [
        `Credit platform ban list (${hit.cpType})`,
        hit.reason?.trim() ? hit.reason.trim() : null,
        hit.addedBy?.trim() ? `added by ${hit.addedBy.trim()}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      verdict: 'unverified' as const,
    })),
    ...duplicates.map((dup) => ({
      checkType: 'duplicate' as const,
      entryType: dup.entryType,
      matchedValueDisplay: dup.display,
      matchedCaseId: dup.id,
      matchedCaseLabel: dup.display,
      verdict: 'unverified' as const,
    })),
    ...deals.duplicates.map((dup) => ({
      checkType: 'duplicate' as const,
      entryType: dup.matchedOn,
      matchedValueDisplay: dup.dealName ?? dup.dealId,
      // A Deal is not one of our cases, so it goes in `matchedEntryId` with its own prefix rather
      // than `matchedCaseId` — that column is a case reference the desk will try to open.
      matchedEntryId: `deal:${dup.dealId}`,
      matchedCaseLabel: dup.dealName ?? dup.dealId,
      note: [
        `Zoho Deal ${dup.dealId}`,
        dup.stage ? `stage ${dup.stage}` : null,
        dup.applicationDate ? `applied ${dup.applicationDate}` : null,
        dup.citifuelStatus ? `Citifuel ${dup.citifuelStatus}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      verdict: 'unverified' as const,
    })),
  ];

  const stored = await verificationScreeningRepo.replaceHits(ctx, row.id, hits);
  // `recordPhaseObservation`, NOT `upsertPhase`: re-running the check on a phase a reviewer has
  // already passed must update the findings and leave their verdict standing. `upsertPhase` would
  // null the outcome and the decider — see the repo method's own comment.
  await verificationCaseAssetRepo.recordPhaseObservation(ctx, row.id, {
    phaseCode: VERIFICATION_PHASE.screening,
    status: 'in_progress',
    findings: {
      ranAt: new Date().toISOString(),
      identifiersScreened: identifiers.length,
      blacklistHits: stored.filter((h) => h.checkType === 'blacklist').length,
      duplicateHits: stored.filter((h) => h.checkType === 'duplicate').length,
      /**
       * WHETHER EACH LIST WAS ACTUALLY READ.
       *
       * A lookup that failed must not read as a clear. The desk shows these verbatim, so "no match"
       * and "could not reach the list" are different sentences on screen — which is the whole reason
       * both remote probes return a flag instead of throwing.
       */
      banList: {
        source: 'credit_platform.public.blacklist_entries',
        available: platform.available,
        error: platform.error,
        platformHits: platform.hits.length,
        ownHits: ours.length,
      },
      duplicateScan: {
        /** Two populations, and the reviewer needs to know which one an absence came from. */
        caseHits: duplicates.length,
        dealHits: deals.duplicates.length,
        dealsAvailable: deals.available,
        dealsError: deals.error,
        dealsTruncated: deals.truncated,
        // EIN and phone are matched against our own cases only — Zoho Deals carries neither in a
        // form COQL can compare. Stated on the findings so the pane does not imply otherwise.
        dealFields: ['email', 'mc', 'usdot', 'name'],
      },
      citifuel: {
        source: 'Deals.citifuel_Status',
        available: deals.available,
        status: deals.citifuel.status,
        verdict: deals.citifuel.verdict,
      },
    },
  });
}

/**
 * Add every identifier of a declined case to OUR blacklist, so Check A catches the next application.
 *
 * This is the writeback the credit platform does not do: nothing over there adds to
 * `blacklist_entries` on a decline, so without this the decision means nothing for the next
 * application. It writes to our own table — we do not own theirs — which is why `runCaseScreening`
 * unions the two lists rather than reading only the bigger one.
 */
export async function blacklistCaseIdentifiers(
  ctx: TenantContext,
  row: VerificationCase,
  reason?: string,
): Promise<number> {
  const identifiers = identifiersOf(row);
  const added = await verificationScreeningRepo.addBlacklistEntries(
    ctx,
    identifiers.map((i) => ({
      entryType: i.entryType,
      valueHash: i.hash,
      valueLast4: i.last4,
      valueDisplay: i.display,
      reason: reason ?? 'Confirmed blacklist match or fraud at underwriting.',
      sourceCaseId: row.id,
      addedBy: zohoFromCtx(ctx) ?? ctx.userId,
    })),
  );

  // SOP Phase 3: "Decline + Blacklist -> Inform Collections Department." Blacklisting silently would
  // leave the team that chases money unaware an applicant was refused for fraud.
  await informCollectionsOfBlacklist(ctx, {
    caseId: row.id,
    applicantName:
      row.companyName ?? [row.firstName, row.lastName].filter(Boolean).join(' ') ?? row.id,
    identifierCount: added,
    reason,
    actorName: ctx.userName || ctx.userId,
  });

  return added;
}
