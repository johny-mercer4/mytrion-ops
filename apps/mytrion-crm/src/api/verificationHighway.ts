/**
 * Data Center → Highway HTML parse. No vendor HTTP. View-only.
 */
import { requestMultipart } from './transport';

export interface HighwayParseResult {
  available: boolean;
  error: string | null;
  parser: 'highway_html_v2';
  pdfNoText: boolean;
  blockCount: number;
  fields: Record<string, unknown>;
}

export async function parseHighwayFile(file: File): Promise<HighwayParseResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  return (await requestMultipart('/verification/flow/highway/parse', form)) as HighwayParseResult;
}
