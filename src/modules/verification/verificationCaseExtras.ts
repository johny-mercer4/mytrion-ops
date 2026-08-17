import { verificationDb } from '../../integrations/verificationDb.js';
import {
  getStageReadiness,
  isCreditPlatformConfigured,
  type StageReadiness,
} from '../../integrations/creditPlatformClient.js';
import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';

export interface CaseAttachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  scope: string;
  createdAt: string | null;
}

interface AttachmentRow {
  id: number | string;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | string | null;
  scope: string | null;
  created_at: Date | string | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function listRequestAttachments(requestId: string): Promise<CaseAttachment[]> {
  if (!verificationDb.isConfigured()) return [];
  try {
    const rows = await verificationDb.query<AttachmentRow>(
      `select id, file_name, content_type, byte_size, scope, created_at
         from file_attachments
        where request_id = $1 or linked_entity_id = $1
        order by id desc
        limit 50`,
      [requestId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      fileName: row.file_name || `attachment-${row.id}`,
      contentType: row.content_type || 'application/octet-stream',
      byteSize: Number(row.byte_size) || 0,
      scope: row.scope || 'file',
      createdAt: iso(row.created_at),
    }));
  } catch (err) {
    logger.warn({ err: errorMessage(err), requestId }, 'verification attachments list skipped');
    return [];
  }
}

export async function loadCaseReadiness(requestId: string): Promise<StageReadiness | null> {
  if (!isCreditPlatformConfigured()) return null;
  try {
    return await Promise.race([
      getStageReadiness(requestId),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 2_000);
      }),
    ]);
  } catch (err) {
    logger.warn({ err: errorMessage(err), requestId }, 'verification stage-readiness skipped');
    return null;
  }
}
