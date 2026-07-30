/**
 * `buildOrgGraph` — the shape of the org chart.
 *
 * Worth testing directly because the failure mode is silent and severe: if a data shape makes the
 * builder skip a node, that person or department simply is not on the canvas, and nothing on screen says
 * so. Every case below is a shape the real table can hold — a manager in another department, a manager
 * who is terminated, a dangling parent id, a reporting loop from a bad import.
 */
import { describe, expect, it } from 'vitest';
import type { HrOrgDepartmentDto, HrOrgEmployeeDto, HrOrgStructureDto } from '../../api/hr';
import { buildOrgGraph, orgBranchIds } from './orgGraph';

function dept(over: Partial<HrOrgDepartmentDto> & { id: string }): HrOrgDepartmentDto {
  return {
    name: over.id,
    code: null,
    leadName: null,
    parentId: null,
    description: null,
    icon: null,
    iconColor: null,
    canvasX: null,
    canvasY: null,
    employeeCount: 0,
    activeEmployeeCount: 0,
    ...over,
  };
}

function emp(over: Partial<HrOrgEmployeeDto> & { id: string }): HrOrgEmployeeDto {
  return {
    firstName: over.id,
    lastName: 'X',
    designation: null,
    status: 'Active',
    departmentId: null,
    reportingToEmployeeId: null,
    photoUrl: null,
    canvasX: null,
    canvasY: null,
    ...over,
  };
}

function payload(
  departments: HrOrgDepartmentDto[],
  employees: HrOrgEmployeeDto[],
): HrOrgStructureDto {
  return {
    departments,
    employees,
    departmentCount: departments.length,
    employeeLinkedCount: employees.filter((e) => e.departmentId).length,
    employeeUnlinkedCount: employees.filter((e) => !e.departmentId).length,
  };
}

const ALL = (ids: string[]): ReadonlySet<string> => new Set(ids);
const NONE: ReadonlySet<string> = new Set();

describe('buildOrgGraph — departments', () => {
  it('draws every department, nesting by parentId', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'a' }), dept({ id: 'b', parentId: 'a' }), dept({ id: 'c', parentId: 'b' })],
        [],
      ),
      { expanded: NONE, includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(g.edges.map((e) => e.id).sort()).toEqual(['a->b', 'b->c']);
  });

  it('treats a DANGLING parentId as a root instead of dropping the department', () => {
    // A parent deleted while a child still pointed at it. The child must still be on the canvas.
    const g = buildOrgGraph(payload([dept({ id: 'orphan', parentId: 'gone' })], []), {
      expanded: NONE,
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id)).toEqual(['orphan']);
    expect(g.edges).toHaveLength(0);
  });

  it('keeps sub-departments visible even when the parent is collapsed', () => {
    // Collapsing hides PEOPLE, never org units — otherwise the company's shape changes on a click.
    const g = buildOrgGraph(payload([dept({ id: 'a' }), dept({ id: 'b', parentId: 'a' })], []), {
      expanded: NONE,
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('buildOrgGraph — people', () => {
  it('closes expanded managers and child departments with their parent department', () => {
    const data = payload(
      [dept({ id: 'root' }), dept({ id: 'child', parentId: 'root' })],
      [
        emp({ id: 'lead', departmentId: 'root' }),
        emp({ id: 'report', departmentId: 'root', reportingToEmployeeId: 'lead' }),
        emp({ id: 'childLead', departmentId: 'child' }),
      ],
    );
    expect([...orgBranchIds(data, 'root')].sort()).toEqual([
      'child',
      'childLead',
      'lead',
      'report',
      'root',
    ]);
  });

  it('hangs staff off their department only when it is expanded, and counts the rest as hidden', () => {
    const data = payload(
      [dept({ id: 'd1', employeeCount: 2, activeEmployeeCount: 2 })],
      [emp({ id: 'e1', departmentId: 'd1' }), emp({ id: 'e2', departmentId: 'd1' })],
    );

    const collapsed = buildOrgGraph(data, { expanded: NONE, includeTerminated: false });
    expect(collapsed.nodes.map((n) => n.id)).toEqual(['d1']);
    expect(collapsed.hiddenCount).toBe(2);

    const open = buildOrgGraph(data, { expanded: ALL(['d1']), includeTerminated: false });
    expect(open.nodes.map((n) => n.id).sort()).toEqual(['d1', 'e1', 'e2']);
    expect(open.edges.map((e) => e.id).sort()).toEqual(['d1->e1', 'd1->e2']);
    expect(open.hiddenCount).toBe(0);
  });

  it('hangs a person off their MANAGER, not their department, when both are set', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'd1' })],
        [
          emp({ id: 'boss', departmentId: 'd1' }),
          emp({ id: 'report', departmentId: 'd1', reportingToEmployeeId: 'boss' }),
        ],
      ),
      { expanded: ALL(['d1', 'boss']), includeTerminated: false },
    );
    expect(g.edges.map((e) => e.id).sort()).toEqual(['boss->report', 'd1->boss']);
    // Exactly one incoming edge per person — a hierarchy, not a mesh.
    expect(g.edges.filter((e) => e.target === 'report')).toHaveLength(1);
  });

  it('draws a person whose MANAGER IS IN ANOTHER DEPARTMENT', () => {
    // A cross-department reporting line is normal (a regional lead reporting to a country head) and
    // must not make either node vanish.
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'sales' }), dept({ id: 'ops' })],
        [
          emp({ id: 'opsBoss', departmentId: 'ops' }),
          emp({ id: 'salesPerson', departmentId: 'sales', reportingToEmployeeId: 'opsBoss' }),
        ],
      ),
      { expanded: ALL(['sales', 'ops', 'opsBoss']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['ops', 'opsBoss', 'sales', 'salesPerson']);
    expect(g.edges.map((e) => e.id)).toContain('opsBoss->salesPerson');
  });

  it('re-homes reports of a HIDDEN terminated manager onto their department', () => {
    // The manager is filtered out; without the fallback their whole reporting line would disappear.
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'd1' })],
        [
          emp({ id: 'exBoss', departmentId: 'd1', status: 'Terminated' }),
          emp({ id: 'report', departmentId: 'd1', reportingToEmployeeId: 'exBoss' }),
        ],
      ),
      { expanded: ALL(['d1']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['d1', 'report']);
    expect(g.edges.map((e) => e.id)).toEqual(['d1->report']);
  });

  it('includes terminated people when asked', () => {
    const data = payload(
      [dept({ id: 'd1' })],
      [emp({ id: 'gone', departmentId: 'd1', status: 'Terminated' })],
    );
    expect(
      buildOrgGraph(data, { expanded: ALL(['d1']), includeTerminated: false }).nodes.map(
        (n) => n.id,
      ),
    ).toEqual(['d1']);
    expect(
      buildOrgGraph(data, { expanded: ALL(['d1']), includeTerminated: true })
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['d1', 'gone']);
  });

  it('draws a person with NO department and NO manager as a root rather than dropping them', () => {
    // These rows are exactly what HR needs to find and fix, so they must be visible.
    const g = buildOrgGraph(payload([dept({ id: 'd1' })], [emp({ id: 'floating' })]), {
      expanded: NONE,
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['d1', 'floating']);
  });

  it('draws a person whose departmentId points at a department that no longer exists', () => {
    const g = buildOrgGraph(payload([], [emp({ id: 'stray', departmentId: 'deleted' })]), {
      expanded: NONE,
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id)).toEqual(['stray']);
  });
});

describe('buildOrgGraph — hostile data', () => {
  it('DRAWS both people in a reporting CYCLE rather than losing them', () => {
    // Two people managing each other — reachable via a bad import or two form saves. A ring is reached by
    // no department and no floating root, so a naive builder omits BOTH of them: invisible on the very
    // canvas that is supposed to fix the loop. (An earlier version of this test only asserted id
    // uniqueness, which an EMPTY node list satisfies — it passed while the bug was live.)
    const g = buildOrgGraph(
      payload(
        [],
        [
          emp({ id: 'x', reportingToEmployeeId: 'y' }),
          emp({ id: 'y', reportingToEmployeeId: 'x' }),
        ],
      ),
      { expanded: ALL(['x', 'y']), includeTerminated: false },
    );
    const ids = g.nodes.map((n) => n.id);
    expect(ids.sort()).toEqual(['x', 'y']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws a person whose manager is in a cycle elsewhere', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'd1' })],
        [
          emp({ id: 'a', departmentId: 'd1', reportingToEmployeeId: 'b' }),
          emp({ id: 'b', departmentId: 'd1', reportingToEmployeeId: 'a' }),
          emp({ id: 'c', departmentId: 'd1' }),
        ],
      ),
      { expanded: ALL(['d1', 'a', 'b', 'c']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd1']);
  });

  it('accounts for EVERY employee: drawn, or hidden behind a collapsed ancestor', () => {
    // The invariant the builder must hold. Nothing may be silently absent.
    const employees = [
      emp({ id: 'lead', departmentId: 'd1' }),
      emp({ id: 'r1', departmentId: 'd1', reportingToEmployeeId: 'lead' }),
      emp({ id: 'r2', departmentId: 'd1', reportingToEmployeeId: 'r1' }),
      emp({ id: 'loose' }),
      emp({ id: 'strayDept', departmentId: 'deleted' }),
    ];
    const data = payload([dept({ id: 'd1' })], employees);

    const collapsed = buildOrgGraph(data, { expanded: NONE, includeTerminated: false });
    const drawn = new Set(collapsed.nodes.map((n) => n.id));
    const shown = employees.filter((e) => drawn.has(e.id)).length;
    expect(shown + collapsed.hiddenCount).toBe(employees.length);

    const open = buildOrgGraph(data, {
      expanded: ALL(['d1', 'lead', 'r1', 'r2']),
      includeTerminated: false,
    });
    expect(open.hiddenCount).toBe(0);
    for (const e of employees) {
      expect(open.nodes.map((n) => n.id)).toContain(e.id);
    }
  });

  it('DRAWS both departments in a parent cycle, and their staff', () => {
    // A's parent is B and B's parent is A — reachable from a bad Zoho import or two form saves. Neither
    // belongs to a root, so a roots-only walk drew neither department and the whole branch below them
    // disappeared: two org units and their people, gone, with nothing on screen to explain it.
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'root' }), dept({ id: 'a', parentId: 'b' }), dept({ id: 'b', parentId: 'a' })],
        [emp({ id: 'p', departmentId: 'a' })],
      ),
      { expanded: ALL(['root', 'a', 'b', 'p']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'p', 'root']);
  });

  it('draws a department that is its own parent', () => {
    const g = buildOrgGraph(
      payload([dept({ id: 'self', parentId: 'self' })], [emp({ id: 'p', departmentId: 'self' })]),
      { expanded: ALL(['self']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['p', 'self']);
  });

  it('emits unique node ids and unique edge ids for a deep tree', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'root' }), dept({ id: 'mid', parentId: 'root' })],
        [
          emp({ id: 'm1', departmentId: 'root' }),
          emp({ id: 'm2', departmentId: 'root', reportingToEmployeeId: 'm1' }),
          emp({ id: 'm3', departmentId: 'mid', reportingToEmployeeId: 'm2' }),
        ],
      ),
      { expanded: ALL(['root', 'mid', 'm1', 'm2', 'm3']), includeTerminated: false },
    );
    const nodeIds = g.nodes.map((n) => n.id);
    const edgeIds = g.edges.map((e) => e.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });
});

describe('buildOrgGraph — layout', () => {
  it('lays out unpinned nodes and leaves SAVED positions alone', () => {
    const g = buildOrgGraph(
      payload([dept({ id: 'auto' }), dept({ id: 'pinned', canvasX: 900, canvasY: 40 })], []),
      { expanded: NONE, includeTerminated: false },
    );
    const pinned = g.nodes.find((n) => n.id === 'pinned')!;
    expect(pinned.position).toEqual({ x: 900, y: 40 });
    const auto = g.nodes.find((n) => n.id === 'auto')!;
    expect(auto.position).not.toEqual({ x: 0, y: 0 });
  });

  it('treats a node SAVED AT (0,0) as pinned, not as unset', () => {
    // The regression this guards: inferring "pinned" from a non-zero position would silently re-layout
    // the one node someone dragged to the origin.
    const g = buildOrgGraph(payload([dept({ id: 'origin', canvasX: 0, canvasY: 0 })], []), {
      expanded: NONE,
      includeTerminated: false,
    });
    expect(g.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('places a top-down tree with children BELOW their parent', () => {
    const g = buildOrgGraph(
      payload([dept({ id: 'top' }), dept({ id: 'below', parentId: 'top' })], []),
      { expanded: NONE, includeTerminated: false },
    );
    const top = g.nodes.find((n) => n.id === 'top')!;
    const below = g.nodes.find((n) => n.id === 'below')!;
    expect(below.position.y).toBeGreaterThan(top.position.y);
  });

  it('survives an empty payload', () => {
    const g = buildOrgGraph(payload([], []), { expanded: NONE, includeTerminated: false });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.hiddenCount).toBe(0);
  });
});
