import { createHash } from 'node:crypto';

export interface PlatformCatalogDocument {
  title: string;
  source: string;
  content: string;
  department: string | null;
  sourceVersion: string;
  metadata: Record<string, unknown>;
}

export type PlatformDocumentInput = Omit<PlatformCatalogDocument, 'sourceVersion'>;

/** Build a content-addressed catalog entry so platform sync can supersede only changed material. */
export function platformDocument(input: PlatformDocumentInput): PlatformCatalogDocument {
  const sourceVersion = createHash('sha256').update(input.content).digest('hex').slice(0, 16);
  return { ...input, sourceVersion };
}
