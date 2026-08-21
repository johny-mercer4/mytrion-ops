import { describe, expect, it } from 'vitest';
import { parseHighwayUpload } from '../../src/modules/verificationFlow/highwayHtmlParser.js';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('parseHighwayUpload', () => {
  it('extracts identity and a labeled status from saved HTML', () => {
    const html = `
      <div>RIDGEVALE FREIGHT LLC</div>
      <div>Partial Pass</div>
      <div>MC-778211</div>
      <div>USDOT-3921884</div>
      <div>DOT STATUS</div>
      <div>ACTIVE</div>
      <div>2 Power Units</div>
      <div>4 yrs old</div>
      <div>Top 10%</div>
    `;
    const result = parseHighwayUpload(bytes(html));
    expect(result.available).toBe(true);
    expect(result.pdfNoText).toBe(false);
    expect(result.fields.carrier_name).toBe('RIDGEVALE FREIGHT LLC');
    expect(result.fields.mc_number).toBe('778211');
    expect(result.fields.dot_number).toBe('3921884');
    expect(result.fields.dot_status).toBe('ACTIVE');
    expect(result.fields.total_power_units).toBe(2);
  });

  it('flags a PDF instead of inventing fields', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const result = parseHighwayUpload(pdf);
    expect(result.pdfNoText).toBe(true);
    expect(result.fields._pdf_no_text).toBe(true);
    expect(result.fields.carrier_name).toBeUndefined();
  });
});
