import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  maintenanceCaseHistory,
  type MaintenanceCaseHistoryRow,
  type NewMaintenanceCaseHistoryRow,
} from '../db/schema/index.js';
import { firstOrUndefined } from './util.js';

/** maintenance_case_history — one row per create/update, mirroring the CRM's Timeline History. */
export const maintenanceCaseHistoryRepo = {
  async insert(row: NewMaintenanceCaseHistoryRow): Promise<MaintenanceCaseHistoryRow | undefined> {
    return firstOrUndefined(await db.insert(maintenanceCaseHistory).values(row).returning());
  },

  /** Newest first — matches the CRM Timeline's reading order. */
  async listByCaseId(caseId: string): Promise<MaintenanceCaseHistoryRow[]> {
    return db
      .select()
      .from(maintenanceCaseHistory)
      .where(eq(maintenanceCaseHistory.caseId, caseId))
      .orderBy(desc(maintenanceCaseHistory.changedAt));
  },
};
