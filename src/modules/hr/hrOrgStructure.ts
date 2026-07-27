/**
 * Build Mytrion HR org structure from our own tables (hr_departments + hr_employees).
 * Zoho People v3 orgstructure is unavailable without ZOHOPEOPLE.orgstructure.READ — we do not
 * invent nodes; every node is a real hr_departments row.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hrDepartments, hrEmployees } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface HrOrgNode {
  id: string;
  name: string;
  code: string | null;
  leadName: string | null;
  parentId: string | null;
  /** Active + terminated headcount linked via department_id. */
  employeeCount: number;
  /** Active-only headcount. */
  activeEmployeeCount: number;
  children: HrOrgNode[];
}

export interface HrOrgStructureResult {
  roots: HrOrgNode[];
  departmentCount: number;
  employeeLinkedCount: number;
  employeeUnlinkedCount: number;
}

export async function buildHrOrgStructure(ctx: TenantContext): Promise<HrOrgStructureResult> {
  const depts = await db
    .select({
      id: hrDepartments.id,
      name: hrDepartments.name,
      code: hrDepartments.code,
      leadName: hrDepartments.leadName,
      parentId: hrDepartments.parentId,
    })
    .from(hrDepartments)
    .where(eq(hrDepartments.tenantId, ctx.tenantId))
    .orderBy(asc(hrDepartments.name));

  const counts = await db
    .select({
      departmentId: hrEmployees.departmentId,
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${hrEmployees.status} = 'Active')::int`,
    })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, ctx.tenantId), sql`${hrEmployees.departmentId} is not null`))
    .groupBy(hrEmployees.departmentId);

  const countByDept = new Map<string, { total: number; active: number }>();
  for (const row of counts) {
    if (row.departmentId) countByDept.set(row.departmentId, { total: row.total, active: row.active });
  }

  const unlinkedRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, ctx.tenantId), sql`${hrEmployees.departmentId} is null`));
  const employeeUnlinkedCount = unlinkedRows[0]?.n ?? 0;

  const nodeById = new Map<string, HrOrgNode>();
  for (const d of depts) {
    const c = countByDept.get(d.id);
    nodeById.set(d.id, {
      id: d.id,
      name: d.name,
      code: d.code,
      leadName: d.leadName,
      parentId: d.parentId,
      employeeCount: c?.total ?? 0,
      activeEmployeeCount: c?.active ?? 0,
      children: [],
    });
  }

  const roots: HrOrgNode[] = [];
  for (const node of nodeById.values()) {
    if (node.parentId && nodeById.has(node.parentId)) {
      nodeById.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: HrOrgNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  let employeeLinkedCount = 0;
  for (const c of countByDept.values()) employeeLinkedCount += c.total;

  return {
    roots,
    departmentCount: depts.length,
    employeeLinkedCount,
    employeeUnlinkedCount,
  };
}
