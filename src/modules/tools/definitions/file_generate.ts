/**
 * File-generation tools: structured spec in → stored artifact + presigned URL out.
 *
 * riskClass 'read' is a DELIBERATE, ratified deviation from "non-read needs admin": these
 * tools mutate nothing external — the artifact is tenant-scoped, owner-attributed, size-capped,
 * and fully audited via storeFile + the dispatcher. Marking them 'write' would admin-gate every
 * report export, killing the primary department use case (see the Agentic Core v2 plan).
 */
import { z } from 'zod';
import type { ToolManifest } from '../types.js';
import { generateCsv, type CsvCell } from '../../files/generate/csv.js';
import { generateExcel } from '../../files/generate/excel.js';
import { generatePdf } from '../../files/generate/pdf.js';
import { presignFile, storeFile } from '../../files/fileService.js';

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const storedFileSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
  expiresAt: z.string(),
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const csvInput = z.object({
  name: z.string().min(1).max(120).describe('File name, e.g. debtors-report.csv'),
  columns: z.array(z.string()).min(1).max(100),
  rows: z.array(z.array(cell)).max(100_000),
});

export const fileGenerateCsvTool: ToolManifest<z.infer<typeof csvInput>, z.infer<typeof storedFileSchema>> = {
  name: 'file.generate_csv',
  description:
    'Generate a CSV file from columns + rows, store it, and return a download link (fileId + url). Use for tabular exports.',
  inputSchema: csvInput,
  outputSchema: storedFileSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  rateLimit: { perMinute: 10 },
  async handler(input, ctx) {
    const buffer = generateCsv(input.columns, input.rows as CsvCell[][]);
    const name = input.name.endsWith('.csv') ? input.name : `${input.name}.csv`;
    return storeFile(ctx, { name, mime: 'text/csv', buffer, kind: 'generated', createdBy: 'file.generate_csv' });
  },
};

const excelInput = z.object({
  name: z.string().min(1).max(120),
  sheets: z
    .array(z.object({ name: z.string().min(1).max(31), columns: z.array(z.string()).min(1).max(100), rows: z.array(z.array(cell)) }))
    .min(1)
    .max(10),
});

export const fileGenerateExcelTool: ToolManifest<z.infer<typeof excelInput>, z.infer<typeof storedFileSchema>> = {
  name: 'file.generate_excel',
  description:
    'Generate an Excel (.xlsx) workbook from one or more sheets (columns + rows), store it, and return a download link.',
  inputSchema: excelInput,
  outputSchema: storedFileSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  rateLimit: { perMinute: 10 },
  async handler(input, ctx) {
    const buffer = await generateExcel(
      input.sheets.map((s) => ({ name: s.name, columns: s.columns, rows: s.rows as CsvCell[][] })),
    );
    const name = input.name.endsWith('.xlsx') ? input.name : `${input.name}.xlsx`;
    return storeFile(ctx, { name, mime: XLSX_MIME, buffer, kind: 'generated', createdBy: 'file.generate_excel' });
  },
};

const pdfInput = z.object({
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  sections: z
    .array(
      z.object({
        heading: z.string().max(200).optional(),
        text: z.string().max(20_000).optional(),
        table: z.object({ columns: z.array(z.string()).min(1).max(20), rows: z.array(z.array(cell)).max(2_000) }).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const fileGeneratePdfTool: ToolManifest<z.infer<typeof pdfInput>, z.infer<typeof storedFileSchema>> = {
  name: 'file.generate_pdf',
  description:
    'Generate a PDF report from a structured spec (title + sections of text/tables), store it, and return a download link. For large tables prefer Excel/CSV.',
  inputSchema: pdfInput,
  outputSchema: storedFileSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  rateLimit: { perMinute: 10 },
  async handler(input, ctx) {
    const buffer = await generatePdf({
      title: input.title,
      sections: input.sections.map((s) => ({
        ...(s.heading !== undefined ? { heading: s.heading } : {}),
        ...(s.text !== undefined ? { text: s.text } : {}),
        ...(s.table !== undefined ? { table: { columns: s.table.columns, rows: s.table.rows as CsvCell[][] } } : {}),
      })),
    });
    const name = input.name.endsWith('.pdf') ? input.name : `${input.name}.pdf`;
    return storeFile(ctx, { name, mime: 'application/pdf', buffer, kind: 'generated', createdBy: 'file.generate_pdf' });
  },
};

const getLinkInput = z.object({ fileId: z.string().min(1).max(100) });

export const fileGetLinkTool: ToolManifest<z.infer<typeof getLinkInput>, z.infer<typeof storedFileSchema>> = {
  name: 'file.get_link',
  description: 'Get a fresh download link for a previously stored file by fileId (links expire).',
  inputSchema: getLinkInput,
  outputSchema: storedFileSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const { file, url, expiresAt } = await presignFile(ctx, input.fileId);
    return { fileId: file.id, name: file.name, mime: file.mime, sizeBytes: file.sizeBytes, url, expiresAt };
  },
};
