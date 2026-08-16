import { describe, expect, it } from 'vitest';
import {
  carrierAttachmentStorageKey,
  sanitizeCarrierAttachmentName,
} from '../../src/modules/verification/carrierAttachmentService.js';

describe('carrierAttachmentStorageKey', () => {
  it('nests the file under tenant + carriers + carrier id', () => {
    expect(
      carrierAttachmentStorageKey({
        tenantId: 'octane',
        carrierId: '1001',
        attachmentId: 'cat_abc',
        fileName: 'COI.pdf',
      }),
    ).toBe('octane/carriers/1001/cat_abc-COI.pdf');
  });

  it('cannot climb out of the carrier folder via the filename', () => {
    expect(
      carrierAttachmentStorageKey({
        tenantId: 'octane',
        carrierId: '1001',
        attachmentId: 'cat_abc',
        fileName: '../../etc/passwd',
      }),
    ).toBe('octane/carriers/1001/cat_abc-.._.._etc_passwd');
  });
});

describe('sanitizeCarrierAttachmentName', () => {
  it('strips control characters and path separators', () => {
    expect(sanitizeCarrierAttachmentName('a/b\\c\n.pdf')).toBe('a_b_c.pdf');
  });

  it('falls back when the name is empty after sanitising', () => {
    expect(sanitizeCarrierAttachmentName('   ')).toBe('file');
  });
});
