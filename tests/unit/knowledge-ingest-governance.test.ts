import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repoMock, embedMock, auditMock } = vi.hoisted(() => ({
  repoMock: {
    findDocByChecksum: vi.fn(),
    createDoc: vi.fn(),
    updateDoc: vi.fn(),
    setDepartment: vi.fn(),
    commitIngestion: vi.fn(),
    markVerified: vi.fn(),
  },
  embedMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('../../src/repos/knowledgeRepo.js', () => ({ knowledgeRepo: repoMock }));
vi.mock('../../src/modules/knowledge/embedder.js', () => ({ embedTexts: embedMock }));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({ auditFromContext: auditMock }));

import { ingestDocument } from '../../src/modules/knowledge/ingestService.js';
import { makeContext } from '../fixtures/seed.js';

const ctx = makeContext({ role: 'admin', departments: ['sales'] });
const doc = {
  id: 'doc-1',
  status: 'pending',
  sourceVersion: '1',
  chunkCount: 0,
  departmentAccess: 'sales',
};

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.findDocByChecksum.mockResolvedValue(undefined);
  repoMock.createDoc.mockResolvedValue({ doc, inserted: true });
  repoMock.updateDoc.mockResolvedValue(doc);
  repoMock.setDepartment.mockResolvedValue(undefined);
  repoMock.commitIngestion.mockResolvedValue(undefined);
  repoMock.markVerified.mockResolvedValue(true);
  auditMock.mockResolvedValue(undefined);
  embedMock.mockResolvedValue([new Array(1536).fill(0.01)]);
});

describe('governed knowledge ingestion', () => {
  it('fails closed on empty extraction before touching the repository', async () => {
    await expect(ingestDocument(ctx, { title: 'Empty', content: '  \n ' })).rejects.toMatchObject({
      code: 'KNOWLEDGE_EMPTY_CONTENT',
    });
    expect(repoMock.findDocByChecksum).not.toHaveBeenCalled();
  });

  it('requires ownership and version metadata for platform documents', async () => {
    await expect(ingestDocument(ctx, {
      title: 'Platform',
      content: 'Platform content',
      domain: 'platform',
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_PLATFORM_METADATA_REQUIRED' });
  });

  it('rejects invalid freshness windows before repository admission', async () => {
    await expect(ingestDocument(ctx, {
      title: 'Policy',
      content: 'Policy content',
      effectiveAt: new Date('2026-08-07T00:00:00Z'),
      expiresAt: new Date('2026-08-06T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_FRESHNESS' });
    expect(repoMock.findDocByChecksum).not.toHaveBeenCalled();
  });

  it('rejects an in-progress checksum instead of racing a second writer', async () => {
    repoMock.findDocByChecksum.mockResolvedValue({ ...doc, status: 'processing' });
    await expect(ingestDocument(ctx, { title: 'SOP', content: 'Same content' })).rejects.toMatchObject({
      code: 'KNOWLEDGE_INGEST_IN_PROGRESS',
      statusCode: 409,
    });
    expect(embedMock).not.toHaveBeenCalled();
    expect(repoMock.commitIngestion).not.toHaveBeenCalled();
  });

  it('handles a database uniqueness race as an in-progress admission', async () => {
    repoMock.createDoc.mockResolvedValue({ doc: { ...doc, status: 'pending' }, inserted: false });
    await expect(ingestDocument(ctx, { title: 'SOP', content: 'Raced content' })).rejects.toMatchObject({
      code: 'KNOWLEDGE_INGEST_IN_PROGRESS',
    });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('marks the document failed and never commits a malformed embedding', async () => {
    embedMock.mockResolvedValue([[0.1, 0.2]]);
    await expect(ingestDocument(ctx, { title: 'SOP', content: 'A valid procedure body.' }))
      .rejects.toMatchObject({ code: 'EMBEDDING_DIMENSION_MISMATCH' });
    expect(repoMock.commitIngestion).not.toHaveBeenCalled();
    expect(repoMock.updateDoc).toHaveBeenLastCalledWith(
      ctx,
      'doc-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('commits chunks and ready state through one repository transaction', async () => {
    const result = await ingestDocument(ctx, {
      title: 'Sales SOP',
      content: '# Sales\nUse the verified procedure.',
      department: 'sales',
      language: 'en',
      owner: 'Sales Operations',
      sourceVersion: '2026-08-06',
      verified: true,
    });

    expect(result).toMatchObject({ docId: 'doc-1', status: 'ready', chunkCount: 1 });
    expect(repoMock.commitIngestion).toHaveBeenCalledOnce();
    const chunks = repoMock.commitIngestion.mock.calls[0]?.[2] as Array<Record<string, unknown>>;
    expect(chunks[0]).toMatchObject({
      embeddingDimensions: 1536,
      sourceVersion: '2026-08-06',
      sectionPath: 'Sales',
    });
    expect(chunks[0]?.['retrievalText']).toContain('Document: Sales SOP');
    expect(repoMock.markVerified).toHaveBeenCalledWith(ctx, 'doc-1');
  });
});

/**
 * The default dedupe is keyed on the DOCUMENT checksum, not on how it was split. That is right for
 * "the same file was uploaded twice" and wrong after a chunker or embedding-model change: when the
 * chunk-packing fix landed, every already-ingested document kept its old fragmentation and no number
 * of sync re-runs could touch it, because the text had not changed.
 */
describe('ingestDocument — rechunk', () => {
  const ready = { ...doc, status: 'ready', chunkCount: 6, departmentAccess: 'sales' };

  it('skips a ready checksum match by default', async () => {
    repoMock.findDocByChecksum.mockResolvedValue(ready);
    const out = await ingestDocument(ctx, { title: 'SOP', content: 'Unchanged body.', department: 'sales' });
    expect(out).toMatchObject({ status: 'skipped', chunkCount: 6 });
    expect(embedMock).not.toHaveBeenCalled();
    expect(repoMock.commitIngestion).not.toHaveBeenCalled();
  });

  it('re-chunks and re-embeds the same content when asked', async () => {
    repoMock.findDocByChecksum.mockResolvedValue(ready);
    const out = await ingestDocument(
      ctx,
      { title: 'SOP', content: 'Unchanged body.', department: 'sales' },
      { rechunk: true },
    );
    expect(out.status).toBe('ready');
    expect(embedMock).toHaveBeenCalled();
    expect(repoMock.commitIngestion).toHaveBeenCalled();
  });

  it('still applies a department re-tag on the way past the skip', async () => {
    repoMock.findDocByChecksum.mockResolvedValue({ ...ready, departmentAccess: 'billing' });
    await ingestDocument(
      ctx,
      { title: 'SOP', content: 'Unchanged body.', department: 'sales' },
      { rechunk: true },
    );
    expect(repoMock.setDepartment).toHaveBeenCalledWith(ctx, ready.id, 'sales');
    expect(repoMock.commitIngestion).toHaveBeenCalled();
  });

  it('refuses to re-chunk a document another ingest is still processing', async () => {
    repoMock.findDocByChecksum.mockResolvedValue({ ...ready, status: 'processing' });
    await expect(
      ingestDocument(ctx, { title: 'SOP', content: 'Unchanged body.' }, { rechunk: true }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_INGEST_IN_PROGRESS' });
    expect(repoMock.commitIngestion).not.toHaveBeenCalled();
  });

  it('re-chunks after losing the create race to an already-ready row', async () => {
    repoMock.findDocByChecksum.mockResolvedValue(undefined);
    repoMock.createDoc.mockResolvedValue({ doc: ready, inserted: false });
    const out = await ingestDocument(
      ctx,
      { title: 'SOP', content: 'Unchanged body.', department: 'sales' },
      { rechunk: true },
    );
    expect(out.status).toBe('ready');
    expect(repoMock.commitIngestion).toHaveBeenCalled();
  });
});
