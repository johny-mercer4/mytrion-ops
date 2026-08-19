import { describe, expect, it } from 'vitest';
import type {
  ApplicationDetail,
  VerificationDocument,
  VerificationMissingItem,
} from '@/api/verificationFlow';
import {
  caseSurface,
  documentsAfterDelete,
  fieldVisiblyMissing,
  mergeDocuments,
  prefillMatchLine,
  visibleMissingItems,
} from './applicationIntakeState';

function doc(id: string, fileName = `${id}.pdf`): VerificationDocument {
  return {
    id,
    docType: 'other',
    label: null,
    status: 'received',
    requestedInPhase: null,
    fileName,
    mime: 'application/pdf',
    sizeBytes: 10,
    uploadedByName: null,
    requestedAt: null,
    createdAt: '2026-08-18T10:00:00.000Z',
  };
}

describe('fieldVisiblyMissing', () => {
  it('clears when the local value is populated and stays when empty', () => {
    const missing = new Set(['ein']);
    expect(fieldVisiblyMissing(missing, 'ein', '')).toBe(true);
    expect(fieldVisiblyMissing(missing, 'ein', '12-3456789')).toBe(false);
    expect(fieldVisiblyMissing(missing, 'ein', '   ')).toBe(true);
    expect(fieldVisiblyMissing(missing, 'companyName', '')).toBe(false);
  });
});

describe('visibleMissingItems', () => {
  const items: VerificationMissingItem[] = [
    { field: 'ein', label: 'EIN', section: 'business' },
    { field: 'bankStatements', label: 'Bank statements', section: 'banking' },
  ];

  it('hides a form-backed item once typed, and never hides document items', () => {
    expect(visibleMissingItems(items, { ein: '12-3456789' }).map((m) => m.field)).toEqual([
      'bankStatements',
    ]);
    expect(visibleMissingItems(items, { ein: '' }).map((m) => m.field)).toEqual([
      'ein',
      'bankStatements',
    ]);
  });
});

describe('prefillMatchLine', () => {
  const match = {
    matchedOn: 'phone' as const,
    operatingStatus: 'AUTHORIZED FOR PROPERTY',
    authorityAddedOn: '2026-03-01',
  };

  it('does not put company-authority copy on an owner-operator case', () => {
    expect(prefillMatchLine(match, 'owner_operator')).toBe('matched on phone number');
  });

  it('states FMCSA status for a company without doubling “authority”', () => {
    expect(prefillMatchLine(match, 'carrier')).toBe(
      'matched on phone number · authorized for property since 2026',
    );
  });
});

describe('caseSurface', () => {
  it('maps pending_docs onto the existing Sales needs-more banner', () => {
    expect(
      caseSurface({
        case: { statusCode: 'pending_docs', closedAt: null, verificationProcess: true },
        intake: { complete: true, missing: [] },
      } as unknown as ApplicationDetail),
    ).toBe('needs_more');
  });
});

describe('document merge', () => {
  it('unions by id so a slower upload cannot drop a newer file', () => {
    const merged = mergeDocuments([doc('a', 'one.pdf')], [doc('b', 'two.pdf')]);
    expect(merged.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('drops the deleted id and keeps extras the delete payload has not seen', () => {
    const after = documentsAfterDelete([doc('keep'), doc('gone'), doc('inflight')], [doc('keep')], 'gone');
    expect(after.map((d) => d.id).sort()).toEqual(['inflight', 'keep']);
  });
});

/**
 * `bankingSource` is the one field that changes WHICH other requirement applies, and the server's
 * verdict is always one save behind. Without this the agent picks Plaid, watches the statement slots
 * leave the form, and Ready to Submit still asks for "Last 3 bank statements (0 of 3 uploaded)".
 */
describe('banking requirements follow the unsaved choice', () => {
  const statements = {
    field: 'bankStatements',
    label: 'Last 3 bank statements (0 of 3 uploaded)',
    section: 'banking' as const,
  };
  const plaid = { field: 'plaidConnected', label: 'Plaid bank connection', section: 'banking' as const };

  it('drops the statement ask once the form says Plaid', () => {
    expect(visibleMissingItems([statements], { bankingSource: 'plaid' })).toEqual([]);
  });

  it('drops the Plaid ask once the form says statements', () => {
    expect(visibleMissingItems([plaid], { bankingSource: 'statements' })).toEqual([]);
  });

  it('keeps the statement ask while the form still says statements', () => {
    expect(visibleMissingItems([statements], { bankingSource: 'statements' })).toEqual([statements]);
    // …and when the field has not been touched at all, statements is the default.
    expect(visibleMissingItems([statements], {})).toEqual([statements]);
  });

  /** It only hides a STALE banking ask. Everything else still comes through untouched. */
  it('never hides a non-banking requirement', () => {
    const ein = { field: 'ein', label: 'EIN', section: 'business' as const };
    expect(visibleMissingItems([ein, statements], { bankingSource: 'plaid' })).toEqual([ein]);
  });
});
