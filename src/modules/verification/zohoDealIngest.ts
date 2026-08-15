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
import {
  VERIFICATION_CASE_OWNER_NAME,
  resolveVerificationCaseOwnerId,
} from './verificationOwner.js';
import { notifyApplicationAwaitingIntake } from './caseNotify.js';
import {
  buildDealPollCoql,
  isDealAfterWatermark,
  mapZohoDeal,
  maxCreatedTime,
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
  // Only used when a Deal has no owner in Zoho — see `createApplicationFromDeal`.
  const fallbackOwnerZohoUserId = await resolveVerificationCaseOwnerId();
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
  const seenTimes: string[] = [watermark];

  for (const row of coql.rows) {
    const dealId = String(row.id ?? '').trim();
    if (!/^\d+$/.test(dealId)) {
      failed += 1;
      continue;
    }
    const createdTime = String(row.Created_Time ?? row.created_time ?? '').trim();
    if (createdTime) seenTimes.push(createdTime);
    if (!isDealAfterWatermark(createdTime, watermark)) {
      skipped += 1;
      continue;
    }
    const existing = await verificationCaseRepo.findByDealId(ctx, dealId);
    if (existing) {
      skipped += 1;
      continue;
    }

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
      const recordCreated = String(record.Created_Time ?? record.created_time ?? createdTime).trim();
      if (recordCreated) seenTimes.push(recordCreated);
      if (!isDealAfterWatermark(recordCreated, watermark)) {
        skipped += 1;
        continue;
      }

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
        businessType: mapped.businessType,
        zohoStage: mapped.zohoStage,
        applicationStatus: mapped.applicationStatus,
        applicationDate: mapped.applicationDate,
        zohoOwnerId: mapped.zohoOwnerId,
        zohoOwnerName: mapped.zohoOwnerName,
        zohoRaw: mapped.zohoRaw,
      }, { fallbackOwnerZohoUserId, fallbackOwnerName: VERIFICATION_CASE_OWNER_NAME });

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

      try {
        await notifyApplicationAwaitingIntake(ctx, {
          caseId: inserted.id,
          ownerZohoUserId: mapped.zohoOwnerId,
          ownerName: mapped.zohoOwnerName,
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

  const nextWatermark = failed === 0 ? maxCreatedTime(seenTimes, watermark) : watermark;
  await verificationIngestStateRepo.saveRun(ctx, {
    watermark: nextWatermark,
    created,
    skipped,
    failed,
  });
  return { created, skipped, failed, total: coql.rows.length, watermark: nextWatermark };
}
