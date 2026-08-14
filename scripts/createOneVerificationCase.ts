/**
 * Ops one-shot: run the same Zoho Deals COQL the ingest job uses, then create
 * exactly one verification_cases row. Does NOT start the cron, does NOT advance
 * the watermark, and does NOT call credit-platform.
 *
 * Forced onto local Postgres so a .env pointed at Render cannot write prod.
 * Same override as `pnpm dev:local-db` (`LOCAL_OPS_DATABASE_URL`).
 *
 * Usage: corepack pnpm exec tsx scripts/createOneVerificationCase.ts
 */
import 'dotenv/config';

process.env.MYTRION_OPS_DATABASE_URL =
  process.env.LOCAL_OPS_DATABASE_URL ||
  'postgresql://octane:octane@localhost:5433/octane_assistant';

const { closeDb } = await import('../src/db/client.js');
const { zohoCrm } = await import('../src/integrations/zohoCrm.js');
const { zohoCrmRecords } = await import('../src/integrations/zohoCrmRecords.js');
const { buildSystemContext } = await import('../src/modules/jobs/systemContext.js');
const { matchBrokerSnapshot } = await import('../src/modules/verification/carrierEnrich.js');
const { notifyVerificationCaseCreated } = await import('../src/modules/verification/caseNotify.js');
const {
  VERIFICATION_CASE_OWNER_NAME,
  resolveVerificationCaseOwnerId,
} = await import('../src/modules/verification/verificationOwner.js');
const { DECISION_DESK_STAGE_IDS } = await import('../src/modules/verification/verificationStages.js');
const { buildDealPollCoql, mapZohoDeal } = await import('../src/modules/verification/zohoDealMap.js');
const { verificationCaseRepo } = await import('../src/repos/verificationCaseRepo.js');
const { verificationCaseStageRepo } = await import('../src/repos/verificationCaseStageRepo.js');
const { defaultDealWatermark } = await import('../src/repos/verificationIngestStateRepo.js');

async function main(): Promise<void> {
  const ctx = buildSystemContext(['verification']);
  const ownerZohoUserId = await resolveVerificationCaseOwnerId();
  const watermark = defaultDealWatermark();
  const coql = buildDealPollCoql(watermark, 20);
  const page = await zohoCrm.runCoql(coql);

  let created:
    | {
        caseId: string;
        zohoDealId: string;
        companyName: string;
        zohoStage: string;
        applicationDate: string;
        dot: string;
        matchedVia: string | null;
        ownerZohoUserId: string;
        ownerName: string;
        status: string;
        inbox: boolean;
      }
    | undefined;
  let skippedExisting = 0;
  const candidates: Array<{ id: string; applicationDate: string }> = [];

  for (const row of page.rows) {
    const dealId = String(row.id ?? '').trim();
    if (!/^\d+$/.test(dealId)) continue;
    candidates.push({
      id: dealId,
      applicationDate: String(row.Application_Date ?? '').slice(0, 10),
    });
    const existing = await verificationCaseRepo.findByDealId(ctx, dealId);
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const record = await zohoCrmRecords.getRecord('Deals', dealId);
    if (!record) continue;
    const mapped = mapZohoDeal(record);
    if (!mapped.zohoDealId) continue;

    const inserted = await verificationCaseRepo.insert(ctx, {
      zohoDealId: mapped.zohoDealId,
      zohoApplicationId: mapped.zohoApplicationId || null,
      carrierId: mapped.carrierId || null,
      requestId: mapped.zohoDealId,
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

    let matchedVia: string | null = null;
    try {
      const match = await matchBrokerSnapshot({
        phone: mapped.phone || mapped.cell,
        email: mapped.email,
        dot: mapped.dot,
        companyName: mapped.companyName,
      });
      if (match) {
        matchedVia = match.via;
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
      console.warn('carrier enrich failed:', err instanceof Error ? err.message : err);
    }

    let inbox = false;
    try {
      await notifyVerificationCaseCreated(ctx, {
        caseId: inserted.id,
        ownerZohoUserId,
        companyName: mapped.companyName,
        zohoDealId: mapped.zohoDealId,
      });
      inbox = true;
    } catch (err) {
      console.warn('inbox notify failed:', err instanceof Error ? err.message : err);
    }

    created = {
      caseId: inserted.id,
      zohoDealId: mapped.zohoDealId,
      companyName: mapped.companyName,
      zohoStage: mapped.zohoStage,
      applicationDate: mapped.applicationDate,
      dot: mapped.dot,
      matchedVia,
      ownerZohoUserId,
      ownerName: VERIFICATION_CASE_OWNER_NAME,
      status: 'new',
      inbox,
    };
    break;
  }

  console.log(
    JSON.stringify(
      {
        db: 'localhost:5433/octane_assistant',
        creditPlatform: 'skipped',
        ingestJob: 'not started',
        watermarkAdvanced: false,
        watermark,
        coqlRows: page.rows.length,
        skippedExisting,
        ownerZohoUserId,
        candidates: candidates.slice(0, 5),
        created: created ?? null,
      },
      null,
      2,
    ),
  );

  if (!created) {
    throw new Error('No unused Deal in the first COQL page — nothing created');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
