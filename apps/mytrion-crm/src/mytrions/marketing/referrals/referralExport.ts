import type { ReferralCalculationPreview } from '../../../api/referrals';
import type { ReferralCardModel } from './referralModel';

export interface ReferralExportRow {
  period: string;
  parentReferrerId: string;
  parentName: string;
  company: string;
  setupStatus: string;
  calculation: string;
  relationshipSummary: string;
  childReferralId: string;
  childName: string;
  dealId: string;
  dealName: string;
  carrierId: number | null;
  bonusType: string;
  rule: string;
  activityMetric: string;
  activityValue: number | null;
  recipientType: string;
  recipient: string;
  frequency: string;
  fuelCodes: string;
  eligibleGallons: number | null;
  uniqueCards: number | null;
  cumulativeGallons: number | null;
  thresholdGallons: number | null;
  rateUsd: number | null;
  calculatedBonusUsd: number | null;
  payableUsd: number | null;
  state: string;
}

const COLUMNS: Array<{ key: keyof ReferralExportRow; label: string; width: number }> = [
  { key: 'period', label: 'Calculation Month', width: 18 },
  { key: 'parentName', label: 'Parent Name', width: 28 },
  { key: 'company', label: 'Company', width: 28 },
  { key: 'calculation', label: 'Calculation Type', width: 22 },
  { key: 'rule', label: 'Calculation Rule', width: 30 },
  { key: 'activityMetric', label: 'Primary Activity Metric', width: 28 },
  { key: 'activityValue', label: 'Primary Activity Value', width: 22 },
  { key: 'calculatedBonusUsd', label: 'Calculated Bonus USD', width: 22 },
  { key: 'payableUsd', label: 'Payable Now USD', width: 18 },
  { key: 'state', label: 'Award Status', width: 16 },
  { key: 'setupStatus', label: 'Setup Status', width: 20 },
  { key: 'relationshipSummary', label: 'Relationship Summary', width: 28 },
  { key: 'parentReferrerId', label: 'Parent Referrer ID', width: 19 },
  { key: 'childReferralId', label: 'Child Referral ID', width: 21 },
  { key: 'childName', label: 'Child Name', width: 28 },
  { key: 'dealId', label: 'Deal ID', width: 21 },
  { key: 'dealName', label: 'Deal Name', width: 28 },
  { key: 'carrierId', label: 'Carrier ID', width: 15 },
  { key: 'bonusType', label: 'Bonus Type', width: 20 },
  { key: 'recipientType', label: 'Recipient Type', width: 16 },
  { key: 'recipient', label: 'Recipient', width: 28 },
  { key: 'frequency', label: 'Frequency', width: 13 },
  { key: 'fuelCodes', label: 'Fuel Codes', width: 18 },
  { key: 'eligibleGallons', label: 'Eligible Gallons', width: 18 },
  { key: 'uniqueCards', label: 'Unique Cards', width: 15 },
  { key: 'cumulativeGallons', label: 'Cumulative Gallons', width: 20 },
  { key: 'thresholdGallons', label: 'Threshold Gallons', width: 19 },
  { key: 'rateUsd', label: 'Rate USD', width: 13 },
];

function setupStatus(card: ReferralCardModel): string {
  if (card.setupState === 'ready') return 'Ready';
  if (card.setupState === 'needs_calculation') return 'Needs calculation';
  if (card.setupState === 'needs_child') return 'Needs child referral';
  return 'Needs Deal / Carrier ID';
}

function rule(preview: ReferralCalculationPreview): string {
  if (preview.bonusType === 'gallons_legacy') return '$0.01 per eligible gallon';
  if (preview.bonusType === 'swipes_legacy') return '$50 per unique card';
  return `$50 at ${preview.thresholdGallons?.toLocaleString('en-US') ?? '—'} cumulative gallons`;
}

function activity(preview: ReferralCalculationPreview): { metric: string; value: number } {
  if (preview.bonusType === 'swipes_legacy') {
    return { metric: 'Unique cards in selected month', value: preview.periodSwipes };
  }
  if (preview.recurring) {
    return { metric: 'Eligible gallons in selected month', value: preview.periodGallons };
  }
  return { metric: 'Cumulative eligible gallons', value: preview.cumulativeGallons };
}

function previewRow(
  card: ReferralCardModel,
  preview: ReferralCalculationPreview,
  periodMonth: string,
): ReferralExportRow {
  const primaryActivity = activity(preview);
  return {
    period: periodMonth.slice(0, 7),
    parentReferrerId: card.referrerId,
    parentName: card.name,
    company: card.company,
    setupStatus: setupStatus(card),
    calculation: preview.calculation,
    relationshipSummary: `${card.children.length} child referrals · ${card.deals.length} deals`,
    childReferralId: preview.childId,
    childName: preview.childName ?? '',
    dealId: preview.dealId,
    dealName: preview.dealName ?? '',
    carrierId: preview.carrierId,
    bonusType: preview.label,
    rule: rule(preview),
    activityMetric: primaryActivity.metric,
    activityValue: primaryActivity.value,
    recipientType: preview.recipientKind === 'parent' ? 'Parent' : 'Child',
    recipient: preview.recipientName ?? '',
    frequency: preview.recurring ? 'Monthly' : 'One-time',
    fuelCodes: preview.fuelCodes.join(', '),
    eligibleGallons: preview.periodGallons,
    uniqueCards: preview.periodSwipes,
    cumulativeGallons: preview.cumulativeGallons,
    thresholdGallons: preview.thresholdGallons,
    rateUsd: preview.rateUsd,
    calculatedBonusUsd: Number(preview.amountUsd),
    payableUsd: Number(preview.payableAmountUsd),
    state: preview.state,
  };
}

/** Full, unfiltered export rows. Parents that are not calculable remain visible as setup rows. */
export function buildReferralExportRows(
  cards: ReferralCardModel[],
  periodMonth: string,
): ReferralExportRow[] {
  return cards.flatMap((card) => {
    if (card.previews.length) {
      return card.previews.map((preview) => previewRow(card, preview, periodMonth));
    }
    return [
      {
        period: periodMonth.slice(0, 7),
        parentReferrerId: card.referrerId,
        parentName: card.name,
        company: card.company,
        setupStatus: setupStatus(card),
        calculation: card.calculation,
        relationshipSummary: `${card.children.length} child referrals · ${card.deals.length} deals`,
        childReferralId: '',
        childName: '',
        dealId: '',
        dealName: '',
        carrierId: null,
        bonusType: '',
        rule: '',
        activityMetric: '',
        activityValue: null,
        recipientType: '',
        recipient: '',
        frequency: '',
        fuelCodes: '',
        eligibleGallons: null,
        uniqueCards: null,
        cumulativeGallons: null,
        thresholdGallons: null,
        rateUsd: null,
        calculatedBonusUsd: null,
        payableUsd: null,
        state: 'setup required',
      },
    ];
  });
}

function deliverBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadReferralCsv(cards: ReferralCardModel[], periodMonth: string): void {
  const rows = buildReferralExportRows(cards, periodMonth);
  const lines = [
    COLUMNS.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(row[column.key])).join(',')),
  ];
  deliverBlob(
    new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }),
    `referral-calculations_${periodMonth.slice(0, 7)}.csv`,
  );
}

export async function downloadReferralExcel(
  cards: ReferralCardModel[],
  periodMonth: string,
): Promise<void> {
  const rows = buildReferralExportRows(cards, periodMonth);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mytrion Manager';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Summary');
  const totalPayable = rows.reduce((sum, row) => sum + (row.payableUsd ?? 0), 0);
  const totalGallons = rows.reduce((sum, row) => sum + (row.eligibleGallons ?? 0), 0);
  const totalCards = rows.reduce((sum, row) => sum + (row.uniqueCards ?? 0), 0);
  const readyParents = cards.filter((card) => card.setupState === 'ready').length;
  const setupRequired = cards.length - readyParents;
  const earnedAwards = rows.filter((row) => row.state === 'earned').length;
  const paidAwards = rows.filter((row) => row.state === 'paid').length;
  summary.addRows([
    ['Referral calculation export'],
    ['Calculation month', periodMonth.slice(0, 7)],
    ['Parent referrers', cards.length],
    ['Ready parent referrers', readyParents],
    ['Parents needing setup', setupRequired],
    ['Calculation rows', rows.filter((row) => row.carrierId !== null).length],
    ['Earned awards', earnedAwards],
    ['Previously paid awards', paidAwards],
    ['Eligible gallons', totalGallons],
    ['Unique cards', totalCards],
    ['Payable USD', totalPayable],
  ]);
  summary.getColumn(1).width = 26;
  summary.getColumn(2).width = 24;
  summary.getRow(1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF172033' },
  };
  summary.getCell('B11').numFmt = '$#,##0.00';
  summary.getCell('B9').numFmt = '#,##0.00';
  summary.getCell('B10').numFmt = '#,##0';

  const calculations = workbook.addWorksheet('Calculations', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  calculations.columns = COLUMNS.map((column) => ({
    key: column.key,
    header: column.label,
    width: column.width,
  }));
  calculations.addRows(rows);
  calculations.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };
  const header = calculations.getRow(1);
  header.height = 25;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172033' } };
  header.alignment = { vertical: 'middle' };
  ['activityValue', 'eligibleGallons', 'cumulativeGallons', 'thresholdGallons'].forEach((key) => {
    calculations.getColumn(key).numFmt = '#,##0.00';
  });
  calculations.getColumn('uniqueCards').numFmt = '#,##0';
  ['rateUsd', 'calculatedBonusUsd', 'payableUsd'].forEach((key) => {
    calculations.getColumn(key).numFmt = '$#,##0.00';
  });
  calculations.eachRow((row, rowNumber) => {
    row.alignment = { vertical: 'middle' };
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  deliverBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `referral-calculations_${periodMonth.slice(0, 7)}.xlsx`,
  );
}
