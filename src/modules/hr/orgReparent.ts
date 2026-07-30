/**
 * Cycle guards for org-canvas re-parenting.
 *
 * Dragging a node onto one of its own descendants is the one gesture that can corrupt the graph: the
 * result is a ring with no root, and a top-down layout then either recurses forever or drops the entire
 * ring off the canvas — the branch simply vanishes, which reads as data loss even though the rows are
 * fine. Both checks walk UP from the proposed parent and fail if they ever arrive back at the node
 * being moved.
 *
 * Each walk is bounded by a hop limit as well as by a visited set. The visited set alone is enough for
 * a well-formed table, but if a cycle already exists in the data (a bad Zoho import, a hand-written
 * UPDATE) the guard itself must not be the thing that hangs the request.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hrDepartments, hrEmployees } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Deeper than any real org chart; a hierarchy this deep is a data bug, not a hierarchy. */
const MAX_DEPTH = 100;

/**
 * Would making `parentId` the parent of `id` create a cycle?
 *
 * True also when `parentId` is unreachable-but-equal to `id`, and true when the existing data already
 * loops on the way up — in both cases refusing the move is the safe answer.
 */
export async function departmentWouldCycle(
  ctx: TenantContext,
  id: string,
  parentId: string,
): Promise<boolean> {
  if (id === parentId) return true;
  const seen = new Set<string>();
  let cursor: string | null = parentId;
  for (let hops = 0; cursor && hops < MAX_DEPTH; hops += 1) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true; // pre-existing loop above the target
    seen.add(cursor);
    const rows: { parentId: string | null }[] = await db
      .select({ parentId: hrDepartments.parentId })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, cursor)))
      .limit(1);
    cursor = rows[0]?.parentId ?? null;
  }
  // Ran out of hops without reaching a root: treat as a cycle rather than allow a deeper one.
  return cursor !== null;
}

/** The same walk over reporting lines (`reporting_to_employee_id`). */
export async function employeeWouldCycle(
  ctx: TenantContext,
  id: string,
  managerId: string,
): Promise<boolean> {
  if (id === managerId) return true;
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  for (let hops = 0; cursor && hops < MAX_DEPTH; hops += 1) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const rows: { managerId: string | null }[] = await db
      .select({ managerId: hrEmployees.reportingToEmployeeId })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ctx.tenantId), eq(hrEmployees.id, cursor)))
      .limit(1);
    cursor = rows[0]?.managerId ?? null;
  }
  return cursor !== null;
}
