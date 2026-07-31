import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  maintenanceCaseAttachments,
  type MaintenanceCaseAttachment,
  type NewMaintenanceCaseAttachment,
} from '../db/schema/index.js';
import { firstOrUndefined } from './util.js';

/** maintenance_case_attachments — files attached to a maintenance case. Metadata only; bytes live
 *  in R2 via `s3Storage`/`getStorage()` (`src/modules/files/storage`). */
export const maintenanceAttachmentRepo = {
  async insert(row: NewMaintenanceCaseAttachment): Promise<MaintenanceCaseAttachment | undefined> {
    return firstOrUndefined(await db.insert(maintenanceCaseAttachments).values(row).returning());
  },

  async listByCaseId(caseId: string): Promise<MaintenanceCaseAttachment[]> {
    return db
      .select()
      .from(maintenanceCaseAttachments)
      .where(eq(maintenanceCaseAttachments.caseId, caseId))
      .orderBy(asc(maintenanceCaseAttachments.createdAt));
  },

  async getById(id: string): Promise<MaintenanceCaseAttachment | undefined> {
    return firstOrUndefined(
      await db.select().from(maintenanceCaseAttachments).where(eq(maintenanceCaseAttachments.id, id)).limit(1),
    );
  },
};
