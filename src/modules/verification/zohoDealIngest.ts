/**
 * The Zoho Deal poller — the ONLY way a new application comes into existence.
 *
 * Applications are not hand-created on either desk. This job walks Deals that reached an
 * application stage, and hands each new one to `createApplicationFromDeal`, which writes the
 * new-era shared record: red, phase rail seeded, owned by the Deal's Sales agent.
 *
 * The credit_platform-era steps that used to run here — legacy decision-desk stage seeding,
 * `syncCaseFromVerificationDb` and `maybeAdvanceFirstRun` — are gone from this path. They belong to
 * the quarantined desk (`killSwitches.ts`); calling them would write into a system this deployment
 * no longer owns. Carrier enrichment stays: it reads the DWH broker snapshot, which Phase 2 and
 * Phase 4 genuinely use.
 */
import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import { verificationIngestStateRepo } from '../../repos/verificationIngestStateRepo.js';
import { createApplicationFromDeal } from '../verificationFlow/dealIntake.js';
import { matchBrokerSnapshot } from './carrierEnrich.js';
import { resolveVerificationCaseOwnerIds } from './verificationOwner.js';
import { notifyApplicationCreated } from './caseNotify.js';
import { pickStage0Assignee } from './stage0Routing.js';
import { verificationCaseAssignmentRepo } from '../../repos/verificationCaseAssignmentRepo.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import {
  buildDealPollCoql,
  isDealAfterWatermark,
  mapZohoDeal,
  maxApplicationDate,
  resolveFreshIngestWatermark,
} from './zohoDealMap.js';

export interface VerificationIngestSummary {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  watermark: string;
}

export async function ingestVerificationDeals(ctx: TenantContext): Promise<VerificationIngestSummary> {
  /**
   * EVERY credit agent the desk can route to, in declaration order.
   *
   * Resolved once per run rather than per Deal — it is env plus, in the no-config case, a CRM
   * directory lookup. The rotation itself is decided per case inside the loop, because each
   * assignment changes who is next.
   */
  const creditAgentIds = await resolveVerificationCaseOwnerIds();
  const state = await verificationIngestStateRepo.getOrCreate(ctx);
  const watermark = resolveFreshIngestWatermark(state.pollDealDateWatermark);
  if (watermark !== state.pollDealDateWatermark) {
    await verificationIngestStateRepo.pinWatermark(ctx, watermark);
    logger.info(
      { from: state.pollDealDateWatermark, to: watermark },
      'verification ingest watermark pinned fresh-only',
    );
  }
  const coql = await zohoCrm.runCoql(buildDealPollCoql(watermark));
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const seenDates: string[] = [watermark];

  /**
   * Reduce the page to the deals worth fetching, BEFORE touching Zoho or the database per row.
   *
   * The cursor rests on a date, so every run re-reads at least one whole day of applications and
   * most of what comes back is already ingested. Filtering first — then one batched existence
   * check — means a quiet run costs a single query and zero record fetches instead of a round trip
   * per deal.
   */
  const candidates: Array<{ dealId: string; applicationDate: string }> = [];
  const seenInPage = new Set<string>();
  for (const row of coql.rows) {
    const dealId = String(row.id ?? '').trim();
    if (!/^\d+$/.test(dealId)) {
      failed += 1;
      continue;
    }
    const applicationDate = String(row.Application_Date ?? row.application_date ?? '').trim();
    if (applicationDate) seenDates.push(applicationDate);
    if (!isDealAfterWatermark(applicationDate, watermark)) {
      skipped += 1;
      continue;
    }
    // Zoho can return the same deal twice across a boundary; a page-local set keeps the batched
    // lookup honest and stops two inserts racing on the same id.
    if (seenInPage.has(dealId)) {
      skipped += 1;
      continue;
    }
    seenInPage.add(dealId);
    candidates.push({ dealId, applicationDate });
  }

  const alreadyIngested = await verificationCaseRepo.findExistingDealIds(
    ctx,
    candidates.map((c) => c.dealId),
  );
  const fresh = candidates.filter((c) => !alreadyIngested.has(c.dealId));
  skipped += candidates.length - fresh.length;

  logger.info(
    { returned: coql.rows.length, candidates: candidates.length, fresh: fresh.length, watermark },
    'verification deal poll',
  );

  for (const { dealId } of fresh) {
    try {
      const record = await zohoCrmRecords.getRecord('Deals', dealId);
      if (!record) {
        failed += 1;
        continue;
      }
      const mapped = mapZohoDeal(record);
      if (!mapped.zohoDealId) {
        failed += 1;
        continue;
      }
      const recordApplied = String(record.Application_Date ?? record.application_date ?? '').trim();
      if (recordApplied) seenDates.push(recordApplied);

      const inserted = await createApplicationFromDeal(ctx, {
        zohoDealId: mapped.zohoDealId,
        zohoApplicationId: mapped.zohoApplicationId,
        carrierId: mapped.carrierId,
        companyName: mapped.companyName,
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        email: mapped.email,
        phone: mapped.phone,
        cell: mapped.cell,
        address: mapped.address,
        city: mapped.city,
        state: mapped.state,
        zip: mapped.zip,
        dateOfBirth: mapped.dateOfBirth,
        dot: mapped.dot,
        mc: mapped.mc,
        truckCount: mapped.truckCount,
        cardsRequested: mapped.cardsRequested,
        secondaryEmail: mapped.secondaryEmail,
        alternativeContact: mapped.alternativeContact,
        businessType: mapped.businessType,
        zohoStage: mapped.zohoStage,
        applicationStatus: mapped.applicationStatus,
        applicationDate: mapped.applicationDate,
        zohoOwnerId: mapped.zohoOwnerId,
        zohoOwnerName: mapped.zohoOwnerName,
        zohoRaw: mapped.zohoRaw,
      });

      /**
       * STAGE 0 — hand the case to a credit agent, and record who.
       *
       * Two writes, and both matter. The case row carries the CURRENT assignee so the desk queue can
       * name it without a subquery per row; `verification_case_assignments` carries the history, which
       * is also where the next rotation reads "who has waited longest".
       *
       * Best-effort, like the enrichment above: an application that exists but is unassigned shows on
       * the desk queue as unassigned and can be picked up, whereas failing the ingest would mean the
       * application does not exist at all.
       */
      let assignee: Awaited<ReturnType<typeof pickStage0Assignee>> = null;
      try {
        assignee = await pickStage0Assignee(ctx, creditAgentIds);
        if (assignee) {
          await verificationFlowRepo.patchIntake(ctx, inserted.id, {
            verificationOwnerZohoUserId: assignee.zohoUserId,
            verificationOwnerName: assignee.name,
          });
          await verificationCaseAssignmentRepo.record(ctx, {
            caseId: inserted.id,
            zohoUserId: assignee.zohoUserId,
            assigneeName: assignee.name,
            reason: 'stage0_round_robin',
          });
        } else {
          // Said out loud: no credit agent is configured, so nobody has been told to underwrite this.
          logger.warn(
            { caseId: inserted.id, dealId },
            'stage 0 routing: no credit agent configured — application created unassigned',
          );
        }
      } catch (err) {
        logger.warn(
          { err: errorMessage(err), caseId: inserted.id, dealId },
          'stage 0 routing failed — application left unassigned',
        );
      }

      // Enrichment and notification are best-effort: neither is worth losing an application over,
      // and the poller must not re-create a row it already wrote.
      try {
        const match = await matchBrokerSnapshot({
          phone: mapped.phone || mapped.cell,
          email: mapped.email,
          dot: mapped.dot,
          companyName: mapped.companyName,
        });
        if (match) {
          await verificationCaseRepo.update(ctx, inserted.id, {
            matchedSnapshotId: match.snapshotId,
            matchedVia: match.via,
            carrierOperatingStatus: match.operatingStatus || null,
            carrierUnits: match.units || null,
            carrierAddress: match.address || null,
            carrierDot: match.dot || null,
            carrierPhone: match.phone || null,
            carrierEmail: match.email || null,
          });
        }
      } catch (err) {
        logger.warn({ err: errorMessage(err), dealId }, 'verification carrier enrich failed');
      }

      // Both desks are told. Each recipient is best-effort inside the notifier, so this only
      // catches a failure to build the messages at all.
      try {
        await notifyApplicationCreated(ctx, {
          caseId: inserted.id,
          salesOwnerZohoUserId: mapped.zohoOwnerId,
          salesOwnerName: mapped.zohoOwnerName,
          // The agent Stage 0 actually picked, not `ids[0]`. This is the whole point of the rotation:
          // the "New application" message goes to whoever now owns it.
          verificationOwnerZohoUserId: assignee?.zohoUserId ?? '',
          verificationOwnerName: assignee?.name ?? null,
          companyName: mapped.companyName,
          zohoDealId: mapped.zohoDealId,
        });
      } catch (err) {
        logger.warn({ err: errorMessage(err), dealId }, 'verification intake notify failed');
      }

      created += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err: errorMessage(err), dealId }, 'verification deal ingest failed');
    }
  }

  const nextWatermark = failed === 0 ? maxApplicationDate(seenDates, watermark) : watermark;
  await verificationIngestStateRepo.saveRun(ctx, {
    watermark: nextWatermark,
    created,
    skipped,
    failed,
  });
  return { created, skipped, failed, total: coql.rows.length, watermark: nextWatermark };
}
