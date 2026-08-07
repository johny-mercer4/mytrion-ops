/**
 * `buildOrgGraph` — the shape of the org chart.
 *
 * Worth testing directly because the failure mode is silent and severe: if a data shape makes the
 * builder skip a node, that person or department simply is not on the canvas, and nothing on screen says
 * so. Every case below is a shape the real table can hold — a manager in another department, a manager
 * who is terminated, a dangling parent id, a reporting loop from a bad import.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HrOrgDepartmentDto, HrOrgEmployeeDto, HrOrgStructureDto } from '../../api/hr';
import {
  buildOrgGraph,
  DEPT_H,
  DEPT_W,
  EMP_H,
  EMP_W,
  NO_DEPARTMENT_ID,
  orgBranchIds,
} from './orgGraph';

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
    photoFileId: null,
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

  /**
   * Unassigned people are GROUPED, not scattered. They used to be drawn as bare roots beside the
   * company — a row of person-cards with nothing saying what they had in common. One labelled bucket
   * makes the gap countable and collapsible, which is what turns it into work HR can clear.
   */
  it('collects a person with NO department and NO manager under the No Department bucket', () => {
    const g = buildOrgGraph(payload([dept({ id: 'd1' })], [emp({ id: 'floating' })]), {
      expanded: new Set([NO_DEPARTMENT_ID]),
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([NO_DEPARTMENT_ID, 'd1', 'floating'].sort());
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: NO_DEPARTMENT_ID, target: 'floating' }),
    );
    const bucket = g.nodes.find((n) => n.id === NO_DEPARTMENT_ID)!;
    expect(bucket.data).toMatchObject({ kind: 'department', synthetic: true, total: 1 });
  });

  it('collects a person whose departmentId points at a department that no longer exists', () => {
    const g = buildOrgGraph(payload([], [emp({ id: 'stray', departmentId: 'deleted' })]), {
      expanded: new Set([NO_DEPARTMENT_ID]),
      includeTerminated: false,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([NO_DEPARTMENT_ID, 'stray'].sort());
  });

  it('omits the bucket entirely when everyone has a department', () => {
    const g = buildOrgGraph(
      payload([dept({ id: 'd1' })], [emp({ id: 'e1', departmentId: 'd1' })]),
      { expanded: new Set(['d1']), includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id)).not.toContain(NO_DEPARTMENT_ID);
  });

  it('hides unassigned people behind the bucket when it is collapsed, and counts them', () => {
    const g = buildOrgGraph(
      payload([], [emp({ id: 'a' }), emp({ id: 'b' })]),
      { expanded: NONE, includeTerminated: false },
    );
    expect(g.nodes.map((n) => n.id)).toEqual([NO_DEPARTMENT_ID]);
    expect(g.hiddenCount).toBe(2);
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

    // The unassigned bucket is a collapsible ancestor like any other, so "everything open" has to
    // include it — `loose` and `strayDept` now hang off it rather than floating as roots.
    const open = buildOrgGraph(data, {
      expanded: ALL(['d1', 'lead', 'r1', 'r2', NO_DEPARTMENT_ID]),
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

describe('orgBranchIds — the unassigned bucket', () => {
  /**
   * Collapsing a node must also clear its descendants' expanded ids, or their people spring straight
   * back the next time the graph rebuilds. The bucket is not in `data.departments`, so it needs its own
   * branch — without it, collapsing "No Department" left every unassigned manager still open.
   */
  it('collects the unassigned people and their reports', () => {
    const data = payload(
      [dept({ id: 'd1' })],
      [
        emp({ id: 'assigned', departmentId: 'd1' }),
        emp({ id: 'loose' }),
        emp({ id: 'looseReport', reportingToEmployeeId: 'loose' }),
        emp({ id: 'stray', departmentId: 'deleted' }),
      ],
    );

    const ids = orgBranchIds(data, NO_DEPARTMENT_ID);

    expect([...ids].sort()).toEqual(
      [NO_DEPARTMENT_ID, 'loose', 'looseReport', 'stray'].sort(),
    );
    // Someone with a real department is not part of this branch.
    expect(ids.has('assigned')).toBe(false);
  });
});

/**
 * The geometry constants and the stylesheet are two copies of the same four numbers, and nothing but a
 * comment has been keeping them together. When they drift the failure is silent and awful: dagre lays
 * out against one size while the browser paints another, so nodes overlap, and `onNodeDragStop`
 * hit-tests a box that is not where the card is — drops land on the wrong parent.
 */
describe('node geometry', () => {
  /**
   * Read off disk, not imported: Vitest leaves CSS unprocessed (`css: false`), so both a plain import
   * and `?raw` come back empty and every assertion below would vacuously pass. The path is relative to
   * the Vitest root, which is this app.
   */
  const css = readFileSync('src/mytrions/hr/hr-workspace.css', 'utf8');

  const ruleSize = (selector: string): { width: number; height: number } => {
    const escaped = selector.replace(/\./g, '\\.');
    const block = new RegExp(`\\.hr-root ${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block?.[1]) throw new Error(`No CSS rule found for ${selector}`);
    const width = /width:\s*(\d+)px/.exec(block[1]);
    const height = /height:\s*(\d+)px/.exec(block[1]);
    if (!width?.[1] || !height?.[1]) throw new Error(`${selector} is missing width/height`);
    return { width: Number(width[1]), height: Number(height[1]) };
  };

  it('matches the department node rule in hr-workspace.css', () => {
    expect(ruleSize('.hr-onode.is-dept')).toEqual({ width: DEPT_W, height: DEPT_H });
  });

  it('matches the employee node rule in hr-workspace.css', () => {
    expect(ruleSize('.hr-onode.is-emp')).toEqual({ width: EMP_W, height: EMP_H });
  });

  it('leaves the card taller than the content it has to hold', () => {
    // The portrait card, top to bottom: the face's overhang above the card, then the card's own
    // padding-top (which clears the face's lower half), the name, the gap, the sub line, padding-bottom.
    const FACE_OVERHANG = 17;
    const CONTENT_H = FACE_OVERHANG + 20 + 16 + 2 + 13 + 9;
    expect(DEPT_H).toBeGreaterThanOrEqual(CONTENT_H);
    expect(EMP_H).toBeGreaterThanOrEqual(CONTENT_H);
  });

  it('keeps both node types the same height so ranks line up', () => {
    expect(DEPT_H).toBe(EMP_H);
  });
});

/**
 * Branch colour. A person inherits the department they hang under, and their reports inherit it from
 * them — that shared hue is what lets you see where Sales ends and Finance begins on a 200-node chart
 * without reading a label.
 */
describe('buildOrgGraph — branch colour', () => {
  const toneOf = (g: ReturnType<typeof buildOrgGraph>, id: string) => {
    const node = g.nodes.find((n) => n.id === id);
    return { tone: node?.data.tone ?? null, seed: node?.data.toneSeed ?? null };
  };

  it('hands a department’s colour to its staff and on down the reporting line', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'd1', iconColor: 'tone-sky' })],
        [
          emp({ id: 'lead', departmentId: 'd1' }),
          emp({ id: 'report', departmentId: 'd1', reportingToEmployeeId: 'lead' }),
        ],
      ),
      { expanded: ALL(['d1', 'lead']), includeTerminated: false },
    );

    expect(toneOf(g, 'lead')).toEqual({ tone: 'tone-sky', seed: 'd1' });
    // Inherited, not re-derived from the report's own (absent) department.
    expect(toneOf(g, 'report')).toEqual({ tone: 'tone-sky', seed: 'd1' });
  });

  it('passes the department id as the seed when no colour is stored', () => {
    const g = buildOrgGraph(
      payload([dept({ id: 'd1' })], [emp({ id: 'e1', departmentId: 'd1' })]),
      { expanded: ALL(['d1']), includeTerminated: false },
    );
    // No token, but the seed is what makes the auto-colour match the department's own card.
    expect(toneOf(g, 'e1')).toEqual({ tone: null, seed: 'd1' });
  });

  it('gives unassigned people the bucket’s own slate, so they match the group they sit in', () => {
    const g = buildOrgGraph(payload([], [emp({ id: 'loose' })]), {
      expanded: ALL([NO_DEPARTMENT_ID]),
      includeTerminated: false,
    });
    expect(toneOf(g, 'loose')).toEqual({ tone: 'tone-slate', seed: NO_DEPARTMENT_ID });
  });

  /**
   * The only genuinely branch-less case: a reporting ring belongs to no department and is reached by
   * the final safety-net sweep, not by any department walk. It falls back to the module accent.
   */
  it('leaves a reporting ring on the neutral', () => {
    const g = buildOrgGraph(
      payload(
        [dept({ id: 'd1' })],
        [
          emp({ id: 'a', departmentId: 'd1', reportingToEmployeeId: 'b' }),
          emp({ id: 'b', departmentId: 'd1', reportingToEmployeeId: 'a' }),
        ],
      ),
      { expanded: ALL(['d1', 'a', 'b']), includeTerminated: false },
    );
    expect(toneOf(g, 'a')).toEqual({ tone: null, seed: null });
  });
});
