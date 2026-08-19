import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { maintenanceCases, type MaintenanceCase } from '../db/schema/index.js';
import { firstOrUndefined } from './util.js';

/**
 * Hard delete — test-case cleanup only, not a correction to a real case (see
 * `csMaintenance.routes.ts`'s own doc comment: a real case's `total_amount` feeds the prepay
 * ledger, so deleting one is an irreversible accounting hole). Attachments/history rows cascade
 * at the DB level (both tables' FK to `maintenance_cases` are `ON DELETE CASCADE`).
 *
 * Lives in its own file, re-exported as `maintenanceCaseRepo.deleteById`, so that repo's file
 * stays under the 600-line cap without changing the method's public shape or call sites.
 */
export async function deleteById(id: string): Promise<MaintenanceCase | undefined> {
  return firstOrUndefined(await db.delete(maintenanceCases).where(eq(maintenanceCases.id, id)).returning());
}
