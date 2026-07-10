/**
 * Minimal single-page PDF writer for the invoice download — ported from the design prototype.
 * Hand-writes a PDF 1.4 (two Type1 fonts, filled rects, text runs) so there's no dependency; a
 * real invoice service can replace this wholesale later.
 */
import type { InvoiceDoc } from './demo';

type RGB = [number, number, number];

interface TextRun {
  x: number;
  y: number;
  sz: number;
  t: string;
  bold: boolean;
  color: RGB | null;
  right: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  c: RGB;
}

const ORANGE: RGB = [1, 0.42, 0];
const AMBER: RGB = [1, 0.84, 0.13];
const GRAY: RGB = [0.54, 0.56, 0.6];
const DARK: RGB = [0.09, 0.075, 0.06];

export function buildInvoicePdf(id: string, doc: InvoiceDoc, billToName: string, billToCompany: string): Blob {
  const A = (s: string) => s.replace(/[•]/g, '').replace(/[·—–]/g, '-').replace(/[^\x20-\x7E]/g, '').trim();
  const E = (s: string) => A(s).replace(/[\\()]/g, '\\$&');
  const W = (t: string, sz: number) => A(t).length * sz * 0.5;

  const L: TextRun[] = [];
  const R: Rect[] = [];
  const add = (x: number, y: number, sz: number, t: string, o: { bold?: boolean; color?: RGB; right?: boolean } = {}) =>
    L.push({ x, y, sz, t, bold: !!o.bold, color: o.color ?? null, right: !!o.right });
  const rect = (x: number, y: number, w: number, h: number, c: RGB) => R.push({ x, y, w, h, c });

  add(50, 58, 17, 'OCTANE', { bold: true });
  add(50, 76, 9, 'TSS Technology LLC - 7901 4th St N, Ste 300, St. Petersburg, FL 33702', { color: GRAY });
  add(50, 90, 9, 'Phone: 953867683 - billing@octanefuel.com', { color: GRAY });
  add(545, 60, 20, 'INVOICE', { bold: true, right: true, color: ORANGE });
  add(545, 79, 11, '# ' + id, { bold: true, right: true });
  add(545, 96, 10, 'Date: ' + doc.date, { right: true, color: GRAY });
  add(545, 110, 10, 'Due: ' + doc.due, { right: true, color: GRAY });
  add(545, 124, 10, 'Customer ID: ' + doc.customerId, { right: true, color: GRAY });
  add(545, 138, 10, 'Period: ' + doc.start + ' - ' + doc.end, { right: true, color: GRAY });
  add(50, 124, 9, 'BILL TO', { bold: true, color: ORANGE });
  add(50, 140, 12, billToName, { bold: true });
  add(50, 155, 10, billToCompany, { color: GRAY });
  rect(50, 178, 495, 20, AMBER);
  add(58, 192, 9, 'DESCRIPTION', { bold: true, color: DARK });
  add(537, 192, 9, 'AMOUNT', { bold: true, right: true, color: DARK });
  let y = 218;
  doc.rows.forEach((r) => {
    add(58, y, 11, r.d);
    add(537, y, 11, r.a, { bold: true, right: true });
    y += 19;
  });
  rect(50, y - 8, 495, 26, [1, 0.55, 0.12]);
  add(58, y + 9, 12, 'TOTAL DUE', { bold: true, color: DARK });
  add(537, y + 9, 13, doc.total, { bold: true, right: true, color: DARK });
  y += 46;
  add(50, y, 11, 'Status: ' + (doc.paid ? 'PAID' : 'DUE'), { bold: true, color: ORANGE });
  y += 28;
  add(50, y, 9, 'OTHER COMMENTS', { bold: true, color: ORANGE });
  y += 15;
  add(50, y, 10, '1. Total payment due in 24 hours', { color: GRAY });
  y += 14;
  add(50, y, 10, '2. Please include the invoice number on your check', { color: GRAY });
  add(50, 790, 9, 'Questions? TSS Technology LLC - 953867683 - billing@octanefuel.com', { color: GRAY });
  add(50, 806, 10, 'Thank You For Your Business!', { bold: true, color: ORANGE });

  let cs = '';
  R.forEach((r) => {
    cs += r.c[0] + ' ' + r.c[1] + ' ' + r.c[2] + ' rg ' + r.x + ' ' + (842 - r.y - r.h) + ' ' + r.w + ' ' + r.h + ' re f\n';
  });
  L.forEach((o) => {
    const col = o.color ? o.color[0] + ' ' + o.color[1] + ' ' + o.color[2] + ' rg' : '0 0 0 rg';
    const x = o.right ? o.x - W(o.t, o.sz) : o.x;
    cs += 'BT /' + (o.bold ? 'F2' : 'F1') + ' ' + o.sz + ' Tf ' + col + ' ' + x.toFixed(1) + ' ' + (842 - o.y).toFixed(1) + ' Td (' + E(o.t) + ') Tj ET\n';
  });

  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
    '<</Length ' + cs.length + '>>\nstream\n' + cs + 'endstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>',
  ];
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((body, i) => {
    off.push(out.length);
    out += i + 1 + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  off.forEach((o) => (out += String(o).padStart(10, '0') + ' 00000 n \n'));
  out += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([out], { type: 'application/pdf' });
}

export function downloadInvoicePdf(id: string, doc: InvoiceDoc, billToName: string, billToCompany: string): void {
  const blob = buildInvoicePdf(id, doc, billToName, billToCompany);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'invoice-' + id + '.pdf';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 600);
}
