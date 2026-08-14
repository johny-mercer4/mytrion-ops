import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import { verificationCaseStageRepo } from '../../repos/verificationCaseStageRepo.js';
import { verificationIngestStateRepo } from '../../repos/verificationIngestStateRepo.js';
import { matchBrokerSnapshot } from './carrierEnrich.js';
import { notifyVerificationCaseCreated } from './caseNotify.js';
import { syncCaseFromVerificationDb } from './caseSync.js';
import { maybeAdvanceFirstRun } from './firstRunTrigger.js';
import {
  VERIFICATION_CASE_OWNER_NAME,
  resolveVerificationCaseOwnerId,
} from './verificationOwner.js';
import { DECISION_DESK_STAGE_IDS } from './verificationStages.js';
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
  const ownerZohoUserId = await resolveVerificationCaseOwnerId();
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

      const inserted = await verificationCaseRepo.insert(ctx, {
        zohoDealId: mapped.zohoDealId,
        zohoApplicationId: mapped.zohoApplicationId || null,
        carrierId: mapped.carrierId || null,
        companyName: mapped.companyName || null,
        firstName: mapped.firstName || null,
        lastName: mapped.lastName || null,
        email: mapped.email || null,
        phone: mapped.phone || null,
        cell: mapped.cell || null,
        address: mapped.address || null,
        city: mapped.city || null,
        state: mapped.state || null,
        zip: mapped.zip || null,
        dateOfBirth: mapped.dateOfBirth || null,
        dot: mapped.dot || null,
        mc: mapped.mc || null,
        truckCount: mapped.truckCount || null,
        businessType: mapped.businessType || null,
        zohoStage: mapped.zohoStage || null,
        applicationStatus: mapped.applicationStatus || null,
        applicationDate: mapped.applicationDate || null,
        creditScore: mapped.creditScore || null,
        creditsafeGrade: mapped.creditsafeGrade || null,
        zohoOwnerId: mapped.zohoOwnerId || null,
        zohoOwnerName: mapped.zohoOwnerName || null,
        zohoRaw: mapped.zohoRaw,
        distributeType: 'shared',
        ownerZohoUserId,
        ownerName: VERIFICATION_CASE_OWNER_NAME,
        status: 'new',
      });
      await verificationCaseStageRepo.seedForCase(ctx, inserted.id, DECISION_DESK_STAGE_IDS);

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
        await notifyVerificationCaseCreated(ctx, {
          caseId: inserted.id,
          ownerZohoUserId,
          companyName: mapped.companyName,
          zohoDealId: mapped.zohoDealId,
        });
      } catch (err) {
        logger.warn({ err: errorMessage(err), dealId }, 'verification inbox notify failed');
      }

      try {
        const synced = await syncCaseFromVerificationDb(ctx, inserted.id, mapped.zohoDealId);
        if (synced.bound) {
          await maybeAdvanceFirstRun(ctx, inserted.id, { agent: 'system', wait: false });
        }
      } catch (err) {
        logger.warn({ err: errorMessage(err), dealId }, 'verification first-run after ingest skipped');
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
