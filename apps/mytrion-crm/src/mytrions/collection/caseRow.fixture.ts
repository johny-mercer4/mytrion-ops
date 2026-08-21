/**
 * One collection case row for tests.
 *
 * Three test files each carried their own hand-written literal, so adding a column to
 * `CollectionCaseRow` broke all three at once and each had to be patched separately. The row has
 * sixty-odd fields now and will grow again; this is the single place that has to change.
 *
 * Not imported by any component, so it is tree-shaken out of the bundle.
 */
import type { CollectionCaseRow } from '@/api/collection';

export function caseRowFixture(over: Partial<CollectionCaseRow> = {}): CollectionCaseRow {
  return {
    id: 'cc_1',
    carrierId: '5776662',
    status: 'open',
    collectionStage: 'intake',
    displayName: 'Display',
    debtorCompanyName: 'SANGHA TRANS',
    debtorFullName: null,
    debtorEmail: null,
    debtorSecondaryEmail: null,
    debtorPhone: null,
    debtorCellPhone: null,
    debtorAddress: null,
    debtorCity: null,
    debtorState: null,
    debtorZipCode: null,
    debtorMcDot: null,
    debtorDateOfBirth: null,
    totalDebtAmount: '90878.84',
    totalInvoiceAmount: '90878.84',
    totalAmountPaid: '0.00',
    issueInvoiceCount: 2,
    daysPastDue: 90,
    firstDelinquentDate: null,
    placementDate: null,
    caseCreatedDate: '2026-05-01',
    closedAt: null,
    closedReason: null,
    zohoDealId: null,
    zohoRecordId: null,
    agencyTransferDate: null,
    firstCollectionAgency: null,
    currentAgency: null,
    secondCollectionAgency: null,
    caineWeinerTier: null,
    agencyResponseStatus: null,
    legalActionRequired: false,
    courtType: null,
    legalFilingDate: null,
    legalDocumentsAttached: false,
    courtStatus: null,
    skipTraceRequired: false,
    verifiedEmail: null,
    verifiedPhone: null,
    verifiedAddress: null,
    escalationRequired: false,
    escalationDate: null,
    cooperationStatus: null,
    lossReason: null,
    paymentReceived: false,
    paymentReceivedDate: null,
    reminderCycleActive: false,
    earlyBadDebtorFlag: false,
    totalCostIncurred: '0.00',
    totalMerchantFee: '0.00',
    assigneeUserId: null,
    assigneeName: null,
    assignedAt: null,
    currency: 'USD',
    reopenCount: 0,
    lastSyncedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}
