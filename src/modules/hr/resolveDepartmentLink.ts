/**
 * Resolve hr_employees.department_id / hr_departments.parent_id from Zoho ids or names.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hrDepartments } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { firstOrUndefined } from '../../repos/util.js';

export async function resolveDepartmentId(
  ctx: TenantContext,
  opts: { departmentZohoId?: string | null; departmentName?: string | null },
): Promise<{ departmentId: string | null; departmentName: string | null }> {
  const zohoId = opts.departmentZohoId?.trim() || null;
  const name = opts.departmentName?.trim() || null;

  if (zohoId) {
    const rows = await db
      .select({ id: hrDepartments.id, name: hrDepartments.name })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.zohoRecordId, zohoId)))
      .limit(1);
    const hit = firstOrUndefined(rows);
    if (hit) return { departmentId: hit.id, departmentName: hit.name };
  }

  if (name) {
    const rows = await db
      .select({ id: hrDepartments.id, name: hrDepartments.name })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.name, name)))
      .limit(1);
    const hit = firstOrUndefined(rows);
    if (hit) return { departmentId: hit.id, departmentName: hit.name };
  }

  return { departmentId: null, departmentName: name };
}

export async function resolveParentDepartmentId(
  ctx: TenantContext,
  opts: { parentZohoId?: string | null; parentName?: string | null },
): Promise<string | null> {
  const zohoId = opts.parentZohoId?.trim() || null;
  const name = opts.parentName?.trim() || null;

  if (zohoId) {
    const rows = await db
      .select({ id: hrDepartments.id })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.zohoRecordId, zohoId)))
      .limit(1);
    const hit = firstOrUndefined(rows);
    if (hit) return hit.id;
  }

  if (name) {
    const rows = await db
      .select({ id: hrDepartments.id })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.name, name)))
      .limit(1);
    const hit = firstOrUndefined(rows);
    if (hit) return hit.id;
  }

  return null;
}
