/**
 * End-to-end smoke walk of the new verification flow, against whatever database the process is
 * pointed at. Exercises the SERVICE layer rather than HTTP so it needs no listening server.
 *
 * Point it at a throwaway DB:
 *   NODE_ENV=development \
 *   LOCAL_OPS_DATABASE_URL=postgres://octane:octane@localhost:5433/ver_newera \
 *   npx tsx scripts/verificationFlowSmoke.ts
 *
 * It asserts the behaviours the SOP actually cares about — the red/green gate, the routing splits,
 * the hard stops, the policy refusal, the blacklist round-trip and return-to-the-phase-that-asked —
 * and exits non-zero on the first failure.
 */
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { applicationService } from '../src/modules/verificationFlow/applicationService.js';
import { deskService } from '../src/modules/verificationFlow/deskService.js';
import { verificationCaseAssetRepo } from '../src/repos/verificationCaseAssetRepo.js';
import { verificationPolicyRepo } from '../src/repos/verificationReviewRepo.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const sales: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:900',
  userName: 'Smoke Agent',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['sales'],
  allDepartmentAccess: true,
  requestId: 'smoke',
} as TenantContext;

const desk: TenantContext = { ...sales, userId: 'zoho:901', departments: ['verification'] };

let failures = 0;
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectThrows(label: string, fn: () => Promise<unknown>, match: RegExp): Promise<void> {
  try {
    await fn();
    check(label, false, 'expected a refusal, got success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, match.test(message), `message was "${message}"`);
  }
}

async function main(): Promise<void> {
  console.log('\n=== 1. Sales intake: the red/green gate ===');
  let app = await applicationService.create(sales, { applicantType: 'carrier', ownerName: 'Smoke Agent' });
  const caseId = app.case.id;
  check('a new application is RED', app.case.verificationProcess === false);
  check('it lists what is outstanding', app.intake.missing.length > 0);

  await expectThrows(
    'submitting an incomplete application is refused',
    () => applicationService.submit(sales, caseId),
    /missing/i,
  );
  await expectThrows(
    'a red case cannot be underwritten',
    () => deskService.decidePhase(desk, caseId, 'p2_identity', { outcome: 'pass' }),
    /still with Sales/i,
  );

  app = await applicationService.patch(sales, caseId, {
    companyName: 'Smoke Freight LLC',
    ein: '87-1234567',
    mc: 'MC-884210',
    dot: '3391044',
    businessAddress: '4400 Industrial Pkwy, Columbus OH',
    email: 'ops@smokefreight.test',
    phone: '6145550110',
    trucksCount: 14,
    fuelCardsRequested: 12,
    requestedLimit: '38000.00',
    bankingSource: 'statements',
  });
  await applicationService.addPrincipal(sales, caseId, { fullName: 'Anders Kaiser' });

  // Three received bank statements satisfy the SOP's banking requirement.
  for (let i = 0; i < 3; i += 1) {
    await verificationCaseAssetRepo.addDocument(sales, {
      caseId,
      docType: 'bank_statement',
      status: 'received',
      fileName: `statement-${i + 1}.pdf`,
      mime: 'application/pdf',
      sizeBytes: 1024,
      s3Key: `${DEFAULT_TENANT_ID}/${caseId}/bank_statement/smoke-${i}`,
      storageProvider: 'dropbox_verification',
    });
  }

  app = await applicationService.get(sales, caseId);
  check('complete application still RED until submitted', app.case.verificationProcess === false);
  check('nothing outstanding now', app.intake.complete === true, JSON.stringify(app.intake.missing));

  app = await applicationService.submit(sales, caseId);
  check('submit turns it GREEN', app.case.verificationProcess === true);
  check('12 cards route to Octane internal', app.underwritingRoute === 'octane_internal');
  check('14-truck carrier is banking-first', app.reviewOrder === 'banking_first');

  console.log('\n=== 2. Desk: rail, skips and screening ===');
  let detail = await deskService.detail(desk, caseId);
  check('rail has ten phases', detail.rail.length === 10);
  check('a carrier runs every phase', detail.rail.every((p) => p.applies));

  detail = await deskService.runScreening(desk, caseId);
  check('screening runs with no blacklist match', detail.screening.summary.blacklistConfirmed === false);

  detail = await deskService.decidePhase(desk, caseId, 'p1_intake', { outcome: 'pass' });
  detail = await deskService.decidePhase(desk, caseId, 'p2_identity', { outcome: 'pass' });
  detail = await deskService.decidePhase(desk, caseId, 'p3_screening', { outcome: 'pass' });
  check('passing screening advances a carrier to authority', detail.case.phaseCode === 'p4_authority');

  console.log('\n=== 3. Pending documents return to the phase that asked ===');
  detail = await deskService.requestDocuments(desk, caseId, {
    phaseCode: 'p4_authority',
    items: [{ docType: 'insurance', label: 'Certificate of insurance' }],
  });
  check('case parks on pending_docs', detail.case.statusCode === 'pending_docs');
  await expectThrows(
    'cannot resume while a document is outstanding',
    () => deskService.resumeAfterDocuments(desk, caseId),
    /outstanding/i,
  );

  const requested = (await verificationCaseAssetRepo.listOutstandingRequests(desk, caseId))[0];
  if (requested) {
    await verificationCaseAssetRepo.updateDocument(desk, caseId, requested.id, {
      status: 'received',
      fileName: 'coi.pdf',
      s3Key: `${DEFAULT_TENANT_ID}/${caseId}/insurance/coi`,
    });
  }
  detail = await deskService.resumeAfterDocuments(desk, caseId);
  check('resumes at the ASKING phase, not at intake', detail.case.phaseCode === 'p4_authority');

  console.log('\n=== 4. Reviews, hard stops and capacity ===');
  await deskService.decidePhase(desk, caseId, 'p4_authority', { outcome: 'pass' });
  await deskService.decidePhase(desk, caseId, 'p5_routing', { outcome: 'pass' });

  await deskService.saveCreditReview(desk, caseId, { creditScore: 712, outcome: 'pass', bureauNoHit: false });
  detail = await deskService.saveBankingReview(desk, caseId, {
    recurringWeeklyIncome: '12000',
    recurringWeeklyExpenses: '9500',
    avgWeeklyFuelExpense: '3200',
    avgDailyBalance: '8400',
    nsfCount: 0,
    achReturnCount: 0,
  });
  check(
    'net cash flow is DERIVED server-side',
    detail.banking?.avgWeeklyNetCashFlow === '2500.00',
    String(detail.banking?.avgWeeklyNetCashFlow),
  );
  check('hard stops pass on positive cash flow', detail.hardStops.passed === true);

  await deskService.decidePhase(desk, caseId, 'p6_credit_banking', { outcome: 'pass' });
  await deskService.decidePhase(desk, caseId, 'p7_hard_stops', { outcome: 'pass' });
  await deskService.decidePhase(desk, caseId, 'p8_highway', { outcome: 'pass' });

  await expectThrows(
    'an unset MODERATE factor refuses to price',
    () => deskService.saveRiskAssessment(desk, caseId, { riskTier: 'moderate' }),
    /no approved risk factor/i,
  );

  detail = await deskService.saveRiskAssessment(desk, caseId, { riskTier: 'strong' });
  check('adjusted capacity = net cash flow + fuel', detail.risk?.adjustedWeeklyCapacity === '5700.00');
  check('recommended limit = capacity x 0.80', detail.risk?.recommendedLimit === '4560.00');

  console.log('\n=== 4b. Both reviews are required before capacity ===');
  {
    const solo = await applicationService.create(sales, { applicantType: 'carrier' });
    await applicationService.patch(sales, solo.case.id, {
      companyName: 'Banking Only LLC',
      ein: '11-1111111',
      mc: 'MC-111111',
      dot: '1111111',
      businessAddress: '9 Only Banking',
      email: 'solo@smoke.test',
      phone: '5552223333',
      trucksCount: 4,
      fuelCardsRequested: 4,
      requestedLimit: '9000',
      bankingSource: 'plaid',
      plaidConnected: true,
    });
    await applicationService.addPrincipal(sales, solo.case.id, { fullName: 'Solo Owner' });
    await applicationService.submit(sales, solo.case.id);
    await deskService.saveBankingReview(desk, solo.case.id, {
      recurringWeeklyIncome: '9000',
      recurringWeeklyExpenses: '7000',
      avgWeeklyFuelExpense: '2000',
    });
    await expectThrows(
      'banking alone cannot produce a limit — credit is still outstanding',
      () => deskService.saveRiskAssessment(desk, solo.case.id, { riskTier: 'strong' }),
      /credit review is still outstanding/i,
    );
  }

  console.log('\n=== 5. Final decision ===');
  await deskService.decidePhase(desk, caseId, 'p9_risk_capacity', { outcome: 'pass' });
  detail = await deskService.decide(desk, caseId, { decision: 'approve', approvedLimit: 4560 });
  check('approved and closed', detail.case.statusCode === 'approved' && detail.case.closedAt !== null);
  check('a timeline exists', detail.events.length > 5, `${detail.events.length} events`);

  const summary = (detail.risk?.summary ?? {}) as Record<string, unknown>;
  const summaryKeys = [
    'applicantType',
    'underwritingRoute',
    'screening',
    'credit',
    'banking',
    'highway',
    'capacity',
    'requestedLimit',
    'supportingDocuments',
    'managementExceptions',
  ];
  check(
    'the underwriting summary carries every SOP section',
    summaryKeys.every((k) => k in summary),
    summaryKeys.filter((k) => !(k in summary)).join(', '),
  );

  console.log('\n=== 6. Owner-operator skips + WEX route ===');
  let oo = await applicationService.create(sales, { applicantType: 'owner_operator' });
  await applicationService.patch(sales, oo.case.id, {
    firstName: 'Marisol',
    lastName: 'Otero',
    dateOfBirth: '1984-03-11',
    dlLast4: '9921',
    ssnLast4: '4821',
    residentialAddress: '18 Cedar Row, Laredo TX',
    email: 'm.otero@smoke.test',
    phone: '5551234567',
    trucksCount: 2,
    fuelCardsRequested: 25,
    requestedLimit: '4000.00',
    bankingSource: 'plaid',
    plaidConnected: true,
  });
  // Flow A also needs the licence and SSN card themselves — SOP Phase 1.
  const ooBefore = await applicationService.get(sales, oo.case.id);
  check(
    'Flow A demands the licence and SSN card documents',
    ooBefore.intake.missing.some((m) => m.field === 'ssnCardDoc') &&
      ooBefore.intake.missing.some((m) => m.field === 'driversLicenseDoc'),
  );
  for (const docType of ['drivers_license', 'ssn_card'] as const) {
    await verificationCaseAssetRepo.addDocument(sales, {
      caseId: oo.case.id,
      docType,
      status: 'received',
      fileName: `${docType}.pdf`,
      mime: 'application/pdf',
      sizeBytes: 512,
      s3Key: `${DEFAULT_TENANT_ID}/${oo.case.id}/${docType}/smoke`,
      storageProvider: 'dropbox_verification',
    });
  }

  oo = await applicationService.submit(sales, oo.case.id);
  check('25 cards route to WEX', oo.underwritingRoute === 'wex');
  check('owner-operator is credit-first', oo.reviewOrder === 'credit_first');

  const ooDetail = await deskService.detail(desk, oo.case.id);
  const authority = ooDetail.rail.find((p) => p.code === 'p4_authority');
  const highway = ooDetail.rail.find((p) => p.code === 'p8_highway');
  check('authority is skipped with a stated reason', authority?.status === 'skipped' && Boolean(authority?.skipReason));
  check('Highway is skipped with a stated reason', highway?.status === 'skipped' && Boolean(highway?.skipReason));

  await deskService.decidePhase(desk, oo.case.id, 'p3_screening', { outcome: 'pass' });
  const afterScreening = await deskService.detail(desk, oo.case.id);
  check('screening jumps straight to routing, skipping authority', afterScreening.case.phaseCode === 'p5_routing');

  console.log('\n=== 7. Blacklist round-trip ===');
  const bad = await applicationService.create(sales, { applicantType: 'carrier' });
  await applicationService.patch(sales, bad.case.id, {
    companyName: 'Blocklist Hauling',
    ein: '99-9999999',
    mc: 'MC-000001',
    dot: '9999999',
    businessAddress: '1 Nowhere',
    email: 'bad@smoke.test',
    phone: '5559990000',
    trucksCount: 3,
    fuelCardsRequested: 3,
    requestedLimit: '5000',
    bankingSource: 'plaid',
    plaidConnected: true,
  });
  await applicationService.addPrincipal(sales, bad.case.id, { fullName: 'A Person' });
  await applicationService.submit(sales, bad.case.id);
  await deskService.decide(desk, bad.case.id, {
    decision: 'decline_blacklist',
    note: 'Smoke test blacklist.',
  });

  const copycat = await applicationService.create(sales, { applicantType: 'carrier' });
  await applicationService.patch(sales, copycat.case.id, {
    companyName: 'Second Attempt LLC',
    ein: '99-9999999', // same EIN as the blacklisted applicant
    mc: 'MC-000002',
    dot: '8888888',
    businessAddress: '2 Elsewhere',
    email: 'new@smoke.test',
    phone: '5551110000',
    trucksCount: 3,
    fuelCardsRequested: 3,
    requestedLimit: '5000',
    bankingSource: 'plaid',
    plaidConnected: true,
  });
  await applicationService.addPrincipal(sales, copycat.case.id, { fullName: 'B Person' });
  await applicationService.submit(sales, copycat.case.id);
  const screened = await deskService.runScreening(desk, copycat.case.id);
  const blacklistHits = screened.screening.hits.filter((h) => h.checkType === 'blacklist');
  check('the blacklisted EIN is caught on the next application', blacklistHits.length > 0);
  check(
    'and it needs a human verdict before anything happens',
    blacklistHits.every((h) => h.verdict === 'unverified'),
  );

  console.log('\n=== 8. Policy ===');
  const policy = await verificationPolicyRepo.get(desk);
  check('strong factor seeded at 0.800', policy.strongFactor === '0.800');
  check('moderate factor deliberately unset', policy.moderateFactor === null);
  check('weak factor deliberately unset', policy.weakFactor === null);

  console.log(
    failures === 0 ? '\nAll smoke checks passed.\n' : `\n${failures} smoke check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nSmoke run threw:', err);
  process.exit(1);
});
