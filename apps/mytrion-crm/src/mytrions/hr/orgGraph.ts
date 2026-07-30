/**
 * Turning the org payload into a React Flow graph: nodes, edges and a top-down dagre layout.
 *
 * Kept out of the component so the shape of the chart is testable without mounting a canvas, and so the
 * component is only wiring. Same dagre parameters and normalize-to-(0,0) approach as the Scope blueprint
 * (`admin/scope/Blueprint.tsx`), which is the app's other React Flow surface.
 *
 * WHAT PARENTS WHAT:
 *   department → department   `parentId`
 *   employee   → department   `departmentId`, when the person has no manager to hang from
 *   employee   → employee     `reportingToEmployeeId`
 *
 * A person with BOTH a manager and a department hangs off the manager only. Drawing both would put two
 * incoming edges on every node and turn a hierarchy into a mesh; the department is still visible because
 * the manager sits inside it.
 */
import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { HrOrgDepartmentDto, HrOrgEmployeeDto, HrOrgStructureDto } from '../../api/hr';

export interface DeptNodeData extends Record<string, unknown> {
  kind: 'department';
  label: string;
  code: string | null;
  leadName: string | null;
  description: string | null;
  icon: string | null;
  tone: string | null;
  total: number;
  active: number;
  /** People hanging directly off this department — drives the expand chevron. */
  directReports: number;
  expanded: boolean;
}

export interface EmpNodeData extends Record<string, unknown> {
  kind: 'employee';
  label: string;
  designation: string | null;
  status: string;
  photoUrl: string | null;
  /** Direct reports, so a manager node can show a count and an expand chevron. */
  directReports: number;
  expanded: boolean;
}

export type OrgNodeData = DeptNodeData | EmpNodeData;

/**
 * Node geometry. Fixed sizes keep dagre's output stable — a measured layout jitters as fonts load, and
 * every drop test in the canvas measures against these numbers.
 *
 * They MUST match the heights in hr-workspace.css exactly. The employee node was 76px, which is less
 * than its own content: 20px padding + a 32px avatar row + an 8px gap + a ~20px chevron row is 80px, so
 * on anyone with direct reports the expand control hung out of the bottom of the card.
 */
export const DEPT_W = 248;
export const DEPT_H = 96;
export const EMP_W = 216;
export const EMP_H = 88;

export interface BuildOptions {
  /**
   * Which subtrees are open. A department or manager that is collapsed keeps its own node and its
   * count, and its descendants are left out of the graph entirely — 213 people on one canvas is
   * unreadable, and rendering them hidden would still cost the layout.
   */
  expanded: ReadonlySet<string>;
  /** Hide terminated people. On by default: an org chart is who works here now. */
  includeTerminated: boolean;
}

interface Built {
  nodes: Node<OrgNodeData>[];
  edges: Edge[];
  /** Nodes omitted because an ancestor is collapsed — shown as "N hidden" in the toolbar. */
  hiddenCount: number;
}

/**
 * Every expandable id that belongs to one visible org branch.
 *
 * Collapsing a department must also clear expanded child departments and managers. Leaving those ids
 * open meant their employee nodes could remain visible (or spring back immediately) beneath a folded
 * parent. Departments remain drawn by buildOrgGraph; only their people branches are closed.
 */
export function orgBranchIds(data: HrOrgStructureDto, rootId: string): ReadonlySet<string> {
  const ids = new Set<string>([rootId]);
  const childDepartments = new Map<string, string[]>();
  const reports = new Map<string, string[]>();
  for (const department of data.departments) {
    if (!department.parentId) continue;
    const children = childDepartments.get(department.parentId) ?? [];
    children.push(department.id);
    childDepartments.set(department.parentId, children);
  }
  for (const employee of data.employees) {
    if (!employee.reportingToEmployeeId) continue;
    const children = reports.get(employee.reportingToEmployeeId) ?? [];
    children.push(employee.id);
    reports.set(employee.reportingToEmployeeId, children);
  }

  const addReports = (employeeId: string): void => {
    for (const reportId of reports.get(employeeId) ?? []) {
      if (ids.has(reportId)) continue;
      ids.add(reportId);
      addReports(reportId);
    }
  };

  if (data.departments.some((department) => department.id === rootId)) {
    const departmentIds = new Set<string>();
    const addDepartment = (departmentId: string): void => {
      if (departmentIds.has(departmentId)) return;
      departmentIds.add(departmentId);
      ids.add(departmentId);
      for (const childId of childDepartments.get(departmentId) ?? []) addDepartment(childId);
    };
    addDepartment(rootId);
    for (const employee of data.employees) {
      if (!employee.departmentId || !departmentIds.has(employee.departmentId)) continue;
      ids.add(employee.id);
      addReports(employee.id);
    }
  } else {
    addReports(rootId);
  }
  return ids;
}

/** Children of each department / manager, resolved once. */
function index(data: HrOrgStructureDto, includeTerminated: boolean) {
  const employees = includeTerminated
    ? data.employees
    : data.employees.filter((e) => e.status.toLowerCase() !== 'terminated');

  const empById = new Map(employees.map((e) => [e.id, e]));
  const deptIds = new Set(data.departments.map((d) => d.id));
  const childDepts = new Map<string | null, HrOrgDepartmentDto[]>();
  const deptStaff = new Map<string, HrOrgEmployeeDto[]>();
  const reports = new Map<string, HrOrgEmployeeDto[]>();
  /**
   * People who attach to nothing the canvas will walk — no manager in the graph and no EXISTING
   * department. They are drawn as roots.
   *
   * The `deptIds` check is the important half. A `department_id` pointing at a deleted department is a
   * real state of the table, and bucketing those people under an id no walk ever visits deleted them
   * from the chart with nothing on screen to say so — they are precisely the rows HR needs to find.
   */
  const floating: HrOrgEmployeeDto[] = [];

  for (const d of data.departments) {
    // A parentId pointing at a department that no longer exists is treated as a root, not dropped.
    const key = d.parentId && data.departments.some((p) => p.id === d.parentId) ? d.parentId : null;
    const list = childDepts.get(key) ?? [];
    list.push(d);
    childDepts.set(key, list);
  }

  for (const e of employees) {
    // A manager who is filtered out (terminated, with terminated hidden) must not swallow their
    // reports — those people fall back to hanging off their department.
    const managerId =
      e.reportingToEmployeeId && empById.has(e.reportingToEmployeeId)
        ? e.reportingToEmployeeId
        : null;
    if (managerId) {
      const list = reports.get(managerId) ?? [];
      list.push(e);
      reports.set(managerId, list);
      continue;
    }
    const deptId = e.departmentId && deptIds.has(e.departmentId) ? e.departmentId : null;
    if (deptId) {
      const list = deptStaff.get(deptId) ?? [];
      list.push(e);
      deptStaff.set(deptId, list);
    } else {
      floating.push(e);
    }
  }

  return { employees, empById, childDepts, deptStaff, reports, floating };
}

export function buildOrgGraph(data: HrOrgStructureDto, opts: BuildOptions): Built {
  const { employees, childDepts, deptStaff, reports, floating } = index(
    data,
    opts.includeTerminated,
  );
  const nodes: Node<OrgNodeData>[] = [];
  const edges: Edge[] = [];
  /**
   * Nodes whose position came from the DB, so the auto-layout must leave them alone.
   *
   * Tracked as a SET rather than inferred from `position !== (0,0)`: a node someone deliberately dragged
   * to the origin is pinned there, and treating that as "unset" would silently re-layout the one node
   * they placed most precisely.
   */
  const pinned = new Set<string>();
  /**
   * Two sets, because "on the canvas" and "dealt with" are different questions.
   *
   *  `drawn`     — ids actually pushed as nodes. Also the recursion guard: without it a reporting ring
   *                (two people managing each other) recurses until the stack blows.
   *  `accounted` — drawn, PLUS people deliberately omitted behind a collapsed ancestor. Whatever is in
   *                neither is unreachable, and gets drawn as a root by the final sweep.
   */
  const drawn = new Set<string>();
  const accounted = new Set<string>();
  /** Departments already emitted — the re-entry guard for a parent cycle. */
  const drawnDepts = new Set<string>();
  let hiddenCount = 0;

  const pushEdge = (source: string, target: string, kind: 'dept' | 'staff' | 'report'): void => {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: 'smoothstep',
      className: `hr-oedge is-${kind}`,
    });
  };

  /** Walk a person and, if expanded, their reports. */
  const walkEmployee = (e: HrOrgEmployeeDto): void => {
    // Already on the canvas: stop. This is what terminates a reporting ring, and it also guarantees
    // unique node ids (a duplicate is a React key collision).
    if (drawn.has(e.id)) return;
    drawn.add(e.id);
    accounted.add(e.id);
    const directReports = reports.get(e.id)?.length ?? 0;
    const expanded = opts.expanded.has(e.id);
    if (e.canvasX != null && e.canvasY != null) pinned.add(e.id);
    nodes.push({
      id: e.id,
      type: 'orgEmployee',
      position: { x: e.canvasX ?? 0, y: e.canvasY ?? 0 },
      data: {
        kind: 'employee',
        label: `${e.firstName} ${e.lastName}`.trim(),
        designation: e.designation,
        status: e.status,
        photoUrl: e.photoUrl,
        directReports,
        expanded,
      },
      initialWidth: EMP_W,
      initialHeight: EMP_H,
    });
    if (directReports === 0) return;
    if (!expanded) {
      hiddenCount += countSubtreeEmployees(e.id, reports, accounted);
      return;
    }
    for (const r of reports.get(e.id) ?? []) {
      pushEdge(e.id, r.id, 'report');
      walkEmployee(r);
    }
  };

  /** Walk a department, its sub-departments, and its directly-attached staff. */
  const walkDepartment = (d: HrOrgDepartmentDto): void => {
    // Stop on re-entry. Two departments set as each other's parent form a ring, and without this the
    // walk recurses until the stack blows.
    if (drawnDepts.has(d.id)) return;
    drawnDepts.add(d.id);
    const staff = deptStaff.get(d.id) ?? [];
    const expanded = opts.expanded.has(d.id);
    if (d.canvasX != null && d.canvasY != null) pinned.add(d.id);
    nodes.push({
      id: d.id,
      type: 'orgDepartment',
      position: { x: d.canvasX ?? 0, y: d.canvasY ?? 0 },
      data: {
        kind: 'department',
        label: d.name,
        code: d.code,
        leadName: d.leadName,
        description: d.description,
        icon: d.icon,
        tone: d.iconColor,
        total: d.employeeCount,
        active: d.activeEmployeeCount,
        directReports: staff.length,
        expanded,
      },
      initialWidth: DEPT_W,
      initialHeight: DEPT_H,
    });

    // Sub-departments are ALWAYS drawn: collapsing a department hides its people, not the org units
    // beneath it, or the shape of the company would change depending on what someone clicked.
    for (const child of childDepts.get(d.id) ?? []) {
      pushEdge(d.id, child.id, 'dept');
      walkDepartment(child);
    }

    if (staff.length === 0) return;
    if (!expanded) {
      hiddenCount += staff.reduce((n, s) => {
        accounted.add(s.id);
        return n + 1 + countSubtreeEmployees(s.id, reports, accounted);
      }, 0);
      return;
    }
    for (const s of staff) {
      pushEdge(d.id, s.id, 'staff');
      walkEmployee(s);
    }
  };

  for (const root of childDepts.get(null) ?? []) walkDepartment(root);

  /**
   * The department half of the same invariant the people sweep below enforces.
   *
   * A parent cycle (A's parent is B, B's parent is A) belongs to no root, so a roots-only walk drew
   * NEITHER department — and with them went the whole branch beneath. On a 20-department chart losing two
   * of them plus their sub-tree is not subtle, and there was nothing on screen to explain it. They render
   * as roots so the loop is visible and can be dragged apart, which is the only place it can be fixed.
   */
  for (const d of data.departments) {
    if (drawnDepts.has(d.id)) continue;
    walkDepartment(d);
  }

  /**
   * THE INVARIANT: every employee row is either on the canvas, or deliberately omitted by a collapsed
   * ancestor / the terminated filter. Nothing may simply be missing.
   *
   * `floating` covers the ordinary cases (no department, or a department that was deleted). The second
   * pass is what makes the invariant hold for hostile data: two people who manage each other form a ring
   * that no department or floating root reaches, so a `floating`-only pass left BOTH of them off the
   * chart entirely — invisible, and impossible to fix from the UI that is supposed to fix it. They now
   * surface as roots, where HR can see the loop and re-drag one of them.
   */
  for (const e of floating) {
    if (accounted.has(e.id)) continue;
    walkEmployee(e);
  }
  for (const e of employees) {
    if (accounted.has(e.id)) continue;
    walkEmployee(e);
  }
  /**
   * Drop any edge whose endpoints are not both on the canvas.
   *
   * By construction there should be none — an edge is only pushed immediately before its child is walked,
   * and the collapse path pushes nothing. It is here because React Flow silently discards an edge with a
   * missing endpoint, so a future change that broke that pairing would show up as a quietly absent line
   * rather than an error, and this keeps the graph internally consistent instead.
   */
  const present = new Set(nodes.map((n) => n.id));
  const connected = edges.filter((e) => present.has(e.source) && present.has(e.target));

  layout(nodes, connected, pinned);
  return { nodes, edges: connected, hiddenCount };
}

/** Total people beneath a manager, for the "N hidden" count on a collapsed node. */
function countSubtreeEmployees(
  id: string,
  reports: Map<string, HrOrgEmployeeDto[]>,
  accounted: Set<string>,
  seen = new Set<string>(),
): number {
  if (seen.has(id)) return 0; // defensive: a data-level reporting loop must not recurse forever
  seen.add(id);
  const kids = reports.get(id) ?? [];
  let n = kids.length;
  for (const k of kids) {
    accounted.add(k.id);
    n += countSubtreeEmployees(k.id, reports, accounted, seen);
  }
  return n;
}

/**
 * Top-to-bottom dagre layout, writing positions back onto the nodes in place.
 *
 * A node with a SAVED position keeps it: the whole point of persisting a drag is that the auto-layout
 * does not undo it on the next load. Everything else is placed by dagre, so a new hire appears in a
 * sensible spot without disturbing the arrangement someone made by hand.
 */
function layout(nodes: Node<OrgNodeData>[], edges: Edge[], pinned: ReadonlySet<string>): void {
  if (nodes.length === 0) return;

  const g = new Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 78, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const isDept = n.data.kind === 'department';
    g.setNode(n.id, { width: isDept ? DEPT_W : EMP_W, height: isDept ? DEPT_H : EMP_H });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagreLayout(g);

  for (const n of nodes) {
    // Dagre reports CENTRES; React Flow positions by top-left.
    const isDept = n.data.kind === 'department';
    const w = isDept ? DEPT_W : EMP_W;
    const h = isDept ? DEPT_H : EMP_H;
    if (pinned.has(n.id)) continue;
    const p = g.node(n.id) ?? { x: 0, y: 0 };
    n.position = { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) };
  }

  /**
   * dagre has no concept of a fixed node, so it happily assigns an auto-placed node the very spot a user
   * had dragged a pinned one into — and the two then render stacked, which looks like a rendering bug
   * rather than a layout compromise.
   *
   * One pass, auto nodes only, pushed straight down past whatever pinned node they overlap. Deliberately
   * not a full constraint solver: a single non-cascading nudge is predictable, cannot loop, and the user
   * can always drag again. Pinned nodes are never moved — they are the explicit instruction.
   */
  const pinnedBoxes = nodes.filter((n) => pinned.has(n.id)).map((n) => ({ ...box(n), id: n.id }));
  if (pinnedBoxes.length === 0) return;
  for (const n of nodes) {
    if (pinned.has(n.id)) continue;
    let guard = 0;
    let moved = true;
    while (moved && guard < pinnedBoxes.length + 1) {
      moved = false;
      guard += 1;
      const b = box(n);
      for (const p of pinnedBoxes) {
        const overlaps = b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h;
        if (!overlaps) continue;
        n.position = { x: n.position.x, y: Math.round(p.y + p.h + NUDGE_GAP) };
        moved = true;
        break;
      }
    }
  }
}

/** Gap left between a nudged node and the pinned node it was overlapping. */
const NUDGE_GAP = 24;

function box(n: Node<OrgNodeData>): { x: number; y: number; w: number; h: number } {
  const isDept = n.data.kind === 'department';
  return {
    x: n.position.x,
    y: n.position.y,
    w: isDept ? DEPT_W : EMP_W,
    h: isDept ? DEPT_H : EMP_H,
  };
}
