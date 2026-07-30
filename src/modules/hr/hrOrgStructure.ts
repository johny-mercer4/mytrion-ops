/**
 * Build the Mytrion HR org structure from our own tables (hr_departments + hr_employees).
 * Zoho People v3 orgstructure is unavailable without ZOHOPEOPLE.orgstructure.READ — we do not
 * invent nodes; every node is a real row.
 *
 * The payload is two FLAT lists, not a nested tree. The org chart is a canvas whose nodes are both
 * departments AND people, and a canvas wants `{id, parentId, position}` records it can lay out and
 * re-parent in place. A nested tree would have to be re-flattened on arrival, and a person who reports
 * to someone in another department has no single place to live in one. Parenthood is expressed by
 * `parentId` / `departmentId` / `reportingToEmployeeId`; the client assembles the edges.
 *
 * ONE round trip on purpose: the canvas needs departments, people and headcounts together, and three
 * separate endpoints would paint the graph in three stages.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hrDepartments, hrEmployees } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface HrOrgDepartmentNode {
  id: string;
  name: string;
  code: string | null;
  leadName: string | null;
  parentId: string | null;
  description: string | null;
  icon: string | null;
  iconColor: string | null;
  canvasX: number | null;
  canvasY: number | null;
  /** Active + terminated headcount linked via department_id. */
  employeeCount: number;
  /** Active-only headcount. */
  activeEmployeeCount: number;
}

/**
 * A person as a canvas node — deliberately NARROWER than the directory DTO.
 *
 * Mobile numbers, joining dates and employee ids are not on this payload: the canvas draws a name, a
 * title and a face, and shipping every column for all 213 people to render a graph would undo the
 * point of the projection. Clicking a node opens the directory record, which is where the full detail
 * already lives.
 */
export interface HrOrgEmployeeNode {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  status: string;
  departmentId: string | null;
  reportingToEmployeeId: string | null;
  photoUrl: string | null;
  canvasX: number | null;
  canvasY: number | null;
}

export interface HrOrgStructureResult {
  departments: HrOrgDepartmentNode[];
  employees: HrOrgEmployeeNode[];
  departmentCount: number;
  employeeLinkedCount: number;
  employeeUnlinkedCount: number;
}

export async function buildHrOrgStructure(ctx: TenantContext): Promise<HrOrgStructureResult> {
  // Three independent reads, so they go out together rather than in series.
  const [depts, counts, employees] = await Promise.all([
    db
      .select({
        id: hrDepartments.id,
        name: hrDepartments.name,
        code: hrDepartments.code,
        leadName: hrDepartments.leadName,
        parentId: hrDepartments.parentId,
        description: hrDepartments.description,
        icon: hrDepartments.icon,
        iconColor: hrDepartments.iconColor,
        canvasX: hrDepartments.canvasX,
        canvasY: hrDepartments.canvasY,
      })
      .from(hrDepartments)
      .where(eq(hrDepartments.tenantId, ctx.tenantId))
      .orderBy(asc(hrDepartments.name)),

    db
      .select({
        departmentId: hrEmployees.departmentId,
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${hrEmployees.status} = 'Active')::int`,
      })
      .from(hrEmployees)
      .where(
        and(eq(hrEmployees.tenantId, ctx.tenantId), sql`${hrEmployees.departmentId} is not null`),
      )
      .groupBy(hrEmployees.departmentId),

    db
      .select({
        id: hrEmployees.id,
        firstName: hrEmployees.firstName,
        lastName: hrEmployees.lastName,
        designation: hrEmployees.designation,
        status: hrEmployees.status,
        departmentId: hrEmployees.departmentId,
        reportingToEmployeeId: hrEmployees.reportingToEmployeeId,
        photoUrl: hrEmployees.photoUrl,
        canvasX: hrEmployees.canvasX,
        canvasY: hrEmployees.canvasY,
      })
      .from(hrEmployees)
      .where(eq(hrEmployees.tenantId, ctx.tenantId))
      .orderBy(asc(hrEmployees.lastName), asc(hrEmployees.firstName)),
  ]);

  const countByDept = new Map<string, { total: number; active: number }>();
  for (const row of counts) {
    if (row.departmentId) countByDept.set(row.departmentId, { total: row.total, active: row.active });
  }

  const departments: HrOrgDepartmentNode[] = depts.map((d) => {
    const c = countByDept.get(d.id);
    return {
      ...d,
      employeeCount: c?.total ?? 0,
      activeEmployeeCount: c?.active ?? 0,
    };
  });

  let employeeLinkedCount = 0;
  for (const c of countByDept.values()) employeeLinkedCount += c.total;

  return {
    departments,
    employees,
    departmentCount: depts.length,
    employeeLinkedCount,
    // Derived from the rows we already have rather than a fourth COUNT query.
    employeeUnlinkedCount: employees.filter((e) => !e.departmentId).length,
  };
}
