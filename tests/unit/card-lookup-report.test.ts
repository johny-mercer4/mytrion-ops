import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwhCards.js', () => ({
  FLEET_CARD_LIMIT: 1000,
  listDwhCards: vi.fn(),
}));

vi.mock('../../src/wrappers/efsWrapper.js', () => ({
  efsWrapper: { listCards: vi.fn() },
}));

import { listDwhCards } from '../../src/integrations/dwhCards.js';
import { efsWrapper } from '../../src/wrappers/efsWrapper.js';
import {
  listCardLookupRows,
  renderCardLookupReport,
} from '../../src/modules/carrier/cardLookupReport.js';

const dwh = vi.mocked(listDwhCards);
const efs = vi.mocked(efsWrapper);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Card Lookup report', () => {
  it('merges live EFS fields with the DWH Card ID and returns only the card last-6', async () => {
    dwh.mockResolvedValue([
      {
        cardId: '1000079491580',
        cardNumber: '708305000000007378',
        cardType: 'FLEET',
        status: 'Active',
        balance: null,
      },
    ]);
    efs.listCards.mockResolvedValue({
      data: [
        {
          cardNumber: '708305000000007378',
          unitNumber: '995',
          driverId: '995',
          driverName: 'GIYOSBAKHRIDDIN',
          status: 'Inactive',
          override: 0,
        },
      ],
    });

    await expect(listCardLookupRows('5758544')).resolves.toEqual([
      {
        cardId: '1000079491580',
        cardNumber: '007378',
        unit: '995',
        driverId: '995',
        driverName: 'GIYOSBAKHRIDDIN',
        xRef: '',
        status: 'Inactive',
        override: 'No',
      },
    ]);
  });

  it('renders XLSX with the requested eight columns and no removed fields', async () => {
    const report = await renderCardLookupReport(
      [
        {
          cardId: '1000079491580',
          // Renderer is a second privacy boundary even if a caller passes a raw PAN.
          cardNumber: '708305000000007378',
          unit: '995',
          driverId: '995',
          driverName: 'GIYOSBAKHRIDDIN',
          xRef: '',
          status: 'Inactive',
          override: 'No',
        },
      ],
      'ONZMOVE INC',
      'xlsx',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(report.bytes).buffer);
    const sheet = workbook.getWorksheet('Card Lookup');
    expect(sheet?.getRow(3).values).toEqual([
      undefined,
      'Card ID',
      'Card #',
      'Unit',
      'Driver ID',
      'Driver Name',
      'X-Ref',
      'Status',
      'Override',
    ]);
    expect(sheet?.getRow(3).values).not.toContain('Policy #');
    expect(sheet?.getRow(3).values).not.toContain('SmartFunds');
    expect(sheet?.getCell('A4').value).toBe('1000079491580');
    expect(sheet?.getCell('B4').value).toBe('007378');
  });

  it('renders a valid PDF report', async () => {
    const report = await renderCardLookupReport([{
      cardId: '1000079491580',
      cardNumber: '708305000000007378',
      unit: '995',
      driverId: '995',
      driverName: 'GIYOSBAKHRIDDIN',
      xRef: '',
      status: 'Inactive',
      override: 'No',
    }], 'ONZMOVE INC', 'pdf');
    expect(report.contentType).toBe('application/pdf');
    expect(report.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(report.bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain('007378');
    expect(text).not.toContain('708305000000007378');
  });
});
