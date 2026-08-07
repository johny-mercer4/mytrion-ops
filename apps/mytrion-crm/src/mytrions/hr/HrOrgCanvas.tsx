/**
 * The org-structure canvas: a real React Flow graph, top-to-bottom, with both node levels.
 *
 * Interactions, and what each one writes:
 *   drag a node               → `PATCH /hr/org/position` (debounced; layout only, no audit row)
 *   arrow keys on a selection → the same write, so a keyboard-only layout edit is not silently lost
 *   drop a node on a node     → `PATCH /hr/org/reparent`
 *   drag handle → handle      → the same reparent, for people who prefer drawing the edge
 *   chevron                   → expand / collapse, client-side only
 *   "+"                       → create a child under this node
 *   click                     → open the record (department or employee modal)
 *
 * DROP-TO-REPARENT IS OPT-IN PER GESTURE. React Flow has no built-in "dropped on a node" event, so the
 * target is resolved from the pointer position at drag end via `getIntersectingNodes`. A drag that ends
 * over empty canvas is therefore a MOVE, never an accidental detach — detaching is an explicit action
 * (drop onto the unassigned strip, or clear the field in the record).
 *
 * Positions are optimistic: the node stays where it was dropped and only a failed request moves it back.
 * Re-parents are NOT optimistic — the server rejects cycles, so the graph is rebuilt from the reload.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { reparentHrOrgNode, setHrOrgPosition, type HrOrgStructureDto } from '../../api/hr';
import { departmentTone } from './departmentAppearance';
import { ORG_NODE_TYPES, setOrgNodeCallbacks } from './OrgNodes';
import {
  buildOrgGraph,
  DEPT_H,
  DEPT_W,
  EMP_H,
  EMP_W,
  NO_DEPARTMENT_ID,
  type OrgNodeData,
} from './orgGraph';

/** A drag can end many times a second; one write per settled position is enough. */
const POSITION_DEBOUNCE_MS = 400;

/**
 * Geometry for the row of brand-new children parked under a parent: the gap between two cards, the gap
 * below the parent, and the step that pushes a row clear of what it lands on. The last one mirrors the
 * auto-layout's own nudge gap (orgGraph keeps that constant private).
 */
const ROW_GAP_X = 14;
const ROW_GAP_Y = 26;
const ROW_PUSH_GAP = 18;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** React Flow positions by top-left; every hit test here measures against the fixed node sizes. */
function nodeBox(n: Node<OrgNodeData>): Box {
  const isDept = n.data.kind === 'department';
  const w = isDept ? DEPT_W : EMP_W;
  const h = isDept ? DEPT_H : EMP_H;
  return { x: n.position.x, y: n.position.y, w, h };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface OrgCanvasHandlers {
  onOpenDepartment: (id: string) => void;
  onOpenEmployee: (id: string) => void;
  onAddUnderDepartment: (id: string) => void;
  onAddUnderEmployee: (id: string) => void;
  /** How many people the current collapse state is hiding — reported up so the toolbar can say so. */
  onHiddenCount: (n: number) => void;
}

function CanvasInner({
  data,
  admin,
  expanded,
  onToggle,
  handlers,
  onGraphChanged,
  onError,
}: {
  data: HrOrgStructureDto;
  admin: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  handlers: OrgCanvasHandlers;
  /** A successful re-parent — the tab refetches, which is what redraws the edges. */
  onGraphChanged: () => void;
  onError: (message: string) => void;
}) {
  /**
   * Terminated people are never drawn. The canvas used to carry a "Show terminated" chip; the product
   * decision is that an org chart is who works here NOW, so the answer is always the same and a toggle
   * that is never flipped is just a control to mis-read. `buildOrgGraph` still accepts the other value —
   * it is what the "re-home a terminated manager's reports" behaviour is defined against — but nothing
   * in the app passes it.
   */
  const built = useMemo(
    () => buildOrgGraph(data, { expanded, includeTerminated: false }),
    [data, expanded],
  );

  // Surfaced rather than silently dropped: a canvas that hides 180 people without saying so reads as an
  // org chart with 33 employees in it.
  const reportHidden = handlers.onHiddenCount;
  useEffect(() => {
    reportHidden(built.hiddenCount);
  }, [built.hiddenCount, reportHidden]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<OrgNodeData>>(built.nodes);
  const [edges, setEdges] = useState<Edge[]>(built.edges);
  const { fitView } = useReactFlow<Node<OrgNodeData>, Edge>();
  const didFit = useRef(false);

  /**
   * Positions dragged in THIS session, applied on top of every rebuild.
   *
   * The graph is rebuilt from the server payload whenever a subtree is expanded or collapsed, and that
   * payload only knows the coordinates it was fetched with. Without this map, one click on a chevron
   * threw away every node the user had just arranged — including moves whose debounced write had landed
   * but arrived after the last refetch.
   */
  const localPos = useRef(new Map<string, { x: number; y: number }>());

  /**
   * Where each node sat when the current gesture started — the only honest rollback source, since by the
   * time a write fails React Flow has long committed the drop and `node.position` IS the new coordinate.
   */
  const preDrag = useRef(new Map<string, { x: number; y: number }>());

  /** Ids React Flow is dragging now. A settled position change for anything else is a keyboard nudge. */
  const dragActive = useRef(new Set<string>());

  /**
   * Set while "Reset layout" waits for its refetch: the rebuild that follows must be adopted verbatim, or
   * the merge below hands every node its pre-reset coordinate straight back.
   */
  const pendingReset = useRef(false);

  /**
   * Merge a rebuilt graph onto the live canvas without reshuffling what the user is looking at.
   *
   * Expand/collapse used to re-run dagre for every unpinned node and `fitView` on every change, so
   * collapsing a department jumped siblings around and expanding sprayed children across the far side
   * of the chart. Keep every already-visible node where it is; park brand-new children in a row under
   * their parent.
   */
  const mergeGraph = useCallback(
    (
      next: Node<OrgNodeData>[],
      nextEdges: Edge[],
      prev: Node<OrgNodeData>[],
      adoptNext: boolean,
    ): Node<OrgNodeData>[] => {
      // "Reset layout" has just cleared every saved position, so the fresh dagre pass IS the answer.
      // Preferring any on-screen coordinate here is what made the button look like it did nothing.
      if (adoptNext) return next.map((n) => ({ ...n }));
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      const parentOf = new Map(nextEdges.map((e) => [e.target, e.source]));
      const merged = next.map((n) => {
        const at = localPos.current.get(n.id) ?? prevPos.get(n.id);
        return at ? { ...n, position: { ...at } } : { ...n };
      });
      const byId = new Map(merged.map((n) => [n.id, n]));
      const newcomers = merged.filter(
        (n) => !prevPos.has(n.id) && !localPos.current.has(n.id),
      );
      const groups = new Map<string, Node<OrgNodeData>[]>();
      for (const n of newcomers) {
        const parentId = parentOf.get(n.id);
        if (!parentId) continue;
        const list = groups.get(parentId) ?? [];
        list.push(n);
        groups.set(parentId, list);
      }
      /**
       * Everything that already holds a coordinate is an obstacle — not just the DB-pinned nodes the
       * auto-layout knows about. Expanding two sibling managers in turn is the ordinary case, and a row
       * placed blindly under each parent put the second manager's reports on top of the first's.
       */
      const toPlace = new Set<string>();
      for (const kids of groups.values()) for (const kid of kids) toPlace.add(kid.id);
      const obstacles = merged.filter((n) => !toPlace.has(n.id)).map(nodeBox);
      for (const [parentId, kids] of groups) {
        const parent = byId.get(parentId);
        if (!parent) continue;
        const pb = nodeBox(parent);
        // Accumulate real widths rather than striding by one kid's own width: a single row can mix
        // department and employee cards, and a fixed stride mis-steps the moment the two differ.
        const row = kids.map((kid) => ({
          kid,
          ...(kid.data.kind === 'department' ? { w: DEPT_W, h: DEPT_H } : { w: EMP_W, h: EMP_H }),
        }));
        const rowW = row.reduce((total, r, i) => total + r.w + (i > 0 ? ROW_GAP_X : 0), 0);
        const rowH = row.reduce((tallest, r) => Math.max(tallest, r.h), 0);
        const left = pb.x + pb.w / 2 - rowW / 2;
        let y = pb.y + pb.h + ROW_GAP_Y;
        // Push the whole row past whatever it lands on. Each step clears the box that was hit, so one
        // pass per obstacle is the bound — and a bound is what keeps a dense canvas from looping.
        for (let guard = 0; guard <= obstacles.length; guard += 1) {
          const hit = obstacles.find((o) => boxesOverlap({ x: left, y, w: rowW, h: rowH }, o));
          if (!hit) break;
          y = hit.y + hit.h + ROW_PUSH_GAP;
        }
        let x = left;
        for (const r of row) {
          const at = { x: Math.round(x), y: Math.round(y) };
          r.kid.position = at;
          localPos.current.set(r.kid.id, at);
          // A row just placed is an obstacle for the next parent's row.
          obstacles.push({ x: at.x, y: at.y, w: r.w, h: r.h });
          x += r.w + ROW_GAP_X;
        }
      }
      return merged;
    },
    [],
  );

  // Adopt a rebuilt graph (data reloaded, or a subtree toggled). Nodes and edges are set TOGETHER —
  // edges taken straight from `built` would be one painted frame ahead of the nodes they connect, and
  // React Flow drops an edge whose endpoint is not yet present.
  useEffect(() => {
    const adoptNext = pendingReset.current;
    setNodes((prev) => mergeGraph(built.nodes, built.edges, prev, adoptNext));
    setEdges(built.edges);
    // Consumed here and not inside mergeGraph: a state updater may run more than once, and a flag
    // cleared on the first run would let the second restore the layout that was just discarded.
    if (adoptNext) pendingReset.current = false;
  }, [built.nodes, built.edges, setNodes, mergeGraph]);

  // Fit once when the first non-empty graph lands — never on expand/collapse.
  useEffect(() => {
    if (didFit.current || built.nodes.length === 0) return;
    const id = window.requestAnimationFrame(() => {
      // Latched inside the frame, not before scheduling it: StrictMode's mount/unmount rehearsal cancels
      // the frame and re-runs the effect, and a ref set up front made that re-run bail on a fit that had
      // never actually happened — so in development the chart never fitted at all.
      didFit.current = true;
      void fitView({ padding: 0.2, maxZoom: 0.95, duration: 220 });
    });
    return () => window.cancelAnimationFrame(id);
  }, [built.nodes.length, fitView]);

  // Node views call back into the tab. Re-registered when a handler identity changes.
  useEffect(() => {
    setOrgNodeCallbacks({
      onToggle,
      canEdit: admin,
      onOpen: (id, kind) =>
        kind === 'department' ? handlers.onOpenDepartment(id) : handlers.onOpenEmployee(id),
      onAddChild: (id, kind) =>
        kind === 'department' ? handlers.onAddUnderDepartment(id) : handlers.onAddUnderEmployee(id),
    });
    return () => {
      // The registry is module-level (see OrgNodes.tsx), so without this the unmounted tab's closures
      // stay reachable — and a stray click during a remount would run against the old tab's state.
      setOrgNodeCallbacks({
        onToggle: () => {},
        onOpen: () => {},
        onAddChild: () => {},
        canEdit: false,
      });
    };
  }, [onToggle, admin, handlers]);

  const timers = useRef(new Map<string, number>());
  /** Position writes waiting out their debounce, so a flush can still send them. */
  const pending = useRef(new Map<string, { kind: 'department' | 'employee'; x: number; y: number }>());
  useEffect(
    () => () => {
      for (const t of timers.current.values()) window.clearTimeout(t);
      timers.current.clear();
      /**
       * Flush on the way out, fire-and-forget.
       *
       * Dropping these instead meant that dragging a node and immediately switching tabs — well inside
       * the 400ms debounce — silently discarded the move. From the user's side the node was where they
       * put it right up to the moment they left, so losing it is indistinguishable from the feature not
       * working.
       */
      for (const [id, p] of pending.current) {
        void setHrOrgPosition(p.kind, id, { x: p.x, y: p.y }).catch(() => {});
      }
      pending.current.clear();
    },
    [],
  );

  /**
   * Send every debounced position now.
   *
   * Called before a re-parent, because a re-parent refetches the graph — and a refetch that lands
   * before a pending write would rebuild the canvas from the OLD coordinates and snap the node the user
   * just moved back to where it was.
   */
  const flushPositions = useCallback(async (): Promise<void> => {
    const queued = [...pending.current.entries()];
    pending.current.clear();
    for (const t of timers.current.values()) window.clearTimeout(t);
    timers.current.clear();
    await Promise.all(
      queued.map(([id, p]) =>
        setHrOrgPosition(p.kind, id, { x: p.x, y: p.y }).catch(() => {
          // Not worth interrupting the re-parent for, but the override has to go: kept, it re-pins a
          // coordinate the server rejected on every later rebuild, so not even a reload shows the truth.
          // Nodes are left alone — the re-parent refetch is about to redraw them anyway.
          localPos.current.delete(id);
        }),
      ),
    );
  }, []);

  /**
   * Put a node back where its gesture started, and forget the override. What makes "optimistic" honest:
   * a coordinate the server never accepted otherwise stays on screen all session, then teleports back.
   */
  const rollbackPosition = useCallback(
    (id: string): void => {
      localPos.current.delete(id);
      const at = preDrag.current.get(id);
      if (!at) return;
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position: { ...at } } : n)));
    },
    [setNodes],
  );

  /** Debounced position write, per node id. */
  const persistPosition = useCallback(
    (node: Node<OrgNodeData>): void => {
      if (!admin) return;
      // The "No Department" bucket has no `hr_departments` row, so a position write for it is a
      // guaranteed 404. It is laid out fresh every render; the drag stands for this session only.
      if (node.id === NO_DEPARTMENT_ID) return;
      const existing = timers.current.get(node.id);
      if (existing) window.clearTimeout(existing);
      const kind = node.data.kind;
      const at = { x: node.position.x, y: node.position.y };
      localPos.current.set(node.id, at);
      pending.current.set(node.id, { kind, ...at });
      const t = window.setTimeout(() => {
        timers.current.delete(node.id);
        pending.current.delete(node.id);
        void setHrOrgPosition(kind, node.id, at).catch((err: unknown) => {
          rollbackPosition(node.id);
          onError(err instanceof Error ? err.message : 'Could not save the new position.');
        });
      }, POSITION_DEBOUNCE_MS);
      timers.current.set(node.id, t);
    },
    [admin, onError, rollbackPosition],
  );

  const reparent = useCallback(
    async (
      childId: string,
      parentId: string | null,
      parentKind: 'department' | 'employee',
      /** Only a DROP moved the node; an edge drawn by hand has no snapshot worth restoring. */
      restoreOnRefusal = false,
    ) => {
      const child = nodes.find((n) => n.id === childId);
      if (!child) return;
      await flushPositions();
      try {
        await reparentHrOrgNode({
          kind: child.data.kind,
          id: childId,
          parentId,
          parentKind,
        });
        onGraphChanged();
      } catch (err) {
        // Nothing rebuilds on a refusal — no refetch, and a later rebuild would preserve the on-screen
        // position anyway — so the card would sit on top of the target it was refused, hiding it.
        if (restoreOnRefusal) rollbackPosition(childId);
        onError(err instanceof Error ? err.message : 'Could not move that node.');
      }
    },
    [nodes, onGraphChanged, onError, flushPositions, rollbackPosition],
  );

  /**
   * Drag end: if the node was dropped ON another node, that is a re-parent; otherwise it is a move.
   *
   * "On" means the dragged node's CENTRE is inside the target's box — deliberately not React Flow's
   * `getIntersectingNodes`, which counts a single pixel of overlap. Nodes are ~220-250px wide and the
   * layout leaves 34px between siblings, so with overlap semantics almost any nudge would clip a
   * neighbour and silently re-parent the node. A centre test is what the user is actually aiming with,
   * and it makes "move" the default that a small drag can never escape.
   */
  const onNodeDragStop = useCallback(
    (_ev: unknown, node: Node<OrgNodeData>, dragged: Node<OrgNodeData>[]): void => {
      // The whole selection moves, not just the node under the cursor — Cmd/Ctrl-click multi-select is on
      // by default, and React Flow hands the full set as the third argument.
      const group = new Map(dragged.map((n) => [n.id, n]));
      if (!group.has(node.id)) group.set(node.id, node);
      // The gesture is over; from here a settled position change can only be a keyboard nudge.
      dragActive.current.clear();
      if (!admin) return;
      const saveGroup = (): void => {
        for (const n of group.values()) persistPosition(n);
      };
      const size = (n: Node<OrgNodeData>) =>
        n.data.kind === 'department' ? { w: DEPT_W, h: DEPT_H } : { w: EMP_W, h: EMP_H };
      const self = size(node);
      const cx = node.position.x + self.w / 2;
      const cy = node.position.y + self.h / 2;
      const hit = nodes.find((n) => {
        // Every node that moved with this gesture is excluded, not just the one under the pointer: a
        // sibling in the same selection landing under the cursor would turn a tidy-up into a re-parent.
        if (group.has(n.id)) return false;
        const { w, h } = size(n);
        return (
          cx >= n.position.x && cx <= n.position.x + w && cy >= n.position.y && cy <= n.position.y + h
        );
      });
      if (!hit) {
        saveGroup();
        return;
      }
      if (group.size > 1) {
        // One drop target cannot mean four re-parents, and guessing would leave the other three moved but
        // unsaved. Refuse the re-parent and keep the move the user can see.
        onError('Move one node at a time to re-parent.');
        saveGroup();
        return;
      }
      const targetKind = hit.data.kind;
      /**
       * Dropping a person onto "No Department" DETACHES them — the affordance the header of this file
       * has always described as "drop onto the unassigned strip" and which never actually existed. It is
       * a null parent, not a re-parent onto the bucket: there is no row behind it to point at.
       */
      if (hit.id === NO_DEPARTMENT_ID) {
        if (node.data.kind !== 'employee') {
          rollbackPosition(node.id);
          onError('“No Department” holds people, not departments.');
          return;
        }
        void reparent(node.id, null, 'department', true);
        return;
      }
      if (node.data.kind === 'department' && targetKind === 'employee') {
        rollbackPosition(node.id);
        onError('A department cannot sit under a person.');
        return;
      }
      void reparent(node.id, hit.id, targetKind, true);
    },
    [admin, nodes, persistPosition, reparent, onError, rollbackPosition],
  );

  /** Snapshot the pre-drag positions (the rollback source) and mark the gesture as a mouse drag. */
  const onNodeDragStart = useCallback(
    (_ev: unknown, node: Node<OrgNodeData>, dragged: Node<OrgNodeData>[]): void => {
      const group = dragged.length > 0 ? dragged : [node];
      dragActive.current = new Set(group.map((n) => n.id));
      for (const n of group) preDrag.current.set(n.id, { ...n.position });
    },
    [],
  );

  /**
   * Hand every node back to the auto-layout.
   *
   * The API has always supported `position: null` and nothing could reach it, so a chart someone had
   * dragged into a mess had no way back short of editing rows. Positions are cleared locally too, or the
   * override map would immediately re-pin what the server just forgot.
   */
  const resetLayout = useCallback(async (): Promise<void> => {
    if (!admin) return;
    await flushPositions();
    // Which rows are pinned comes from the payload and the override map, never from the rendered x:
    // guessing with `position.x !== 0` skipped the one node someone had dragged to the origin — the
    // only position it could never clear — and sent a pointless PATCH for every auto-laid-out node.
    const pinned: { kind: 'department' | 'employee'; id: string }[] = [
      ...data.departments
        .filter((d) => d.canvasX != null || d.canvasY != null)
        .map((d) => ({ kind: 'department' as const, id: d.id })),
      ...data.employees
        .filter((e) => e.canvasX != null || e.canvasY != null)
        .map((e) => ({ kind: 'employee' as const, id: e.id })),
    ];
    /**
     * ...unioned with everything moved in THIS session. A position write never invalidates the org
     * query, so a coordinate that landed on the server seconds ago is still `null` in `data`. Omitted
     * from the batch below, those rows survive the reset: the refetch hands their saved coordinates
     * back and `pendingReset` makes the rebuild adopt them verbatim — i.e. the only nodes that got
     * reset were the ones already pinned at page load. A null for a node that was never pinned is a
     * harmless no-op; a missing one is the bug.
     */
    const kindOf = new Map<string, 'department' | 'employee'>([
      ...data.departments.map((d) => [d.id, 'department'] as const),
      ...data.employees.map((e) => [e.id, 'employee'] as const),
    ]);
    const batched = new Set(pinned.map((n) => n.id));
    for (const id of localPos.current.keys()) {
      if (batched.has(id)) continue;
      // Absent from the payload means the row was deleted elsewhere — nothing left to clear, and a
      // PATCH would only 404 into the error toast below.
      const kind = kindOf.get(id);
      if (!kind) continue;
      batched.add(id);
      pinned.push({ kind, id });
    }
    localPos.current.clear();
    pendingReset.current = true;
    try {
      // allSettled: one 404 for a row deleted elsewhere must not skip the refetch and leave the reset
      // half-applied on screen.
      const results = await Promise.allSettled(
        pinned.map((n) => setHrOrgPosition(n.kind, n.id, null)),
      );
      onGraphChanged();
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        onError(
          failed.reason instanceof Error
            ? failed.reason.message
            : 'Some positions could not be cleared.',
        );
      }
    } catch (err) {
      // No refetch is coming, so the adopt-verbatim flag would reshuffle the next unrelated rebuild.
      pendingReset.current = false;
      onError(err instanceof Error ? err.message : 'Could not reset the layout.');
    }
  }, [admin, data, flushPositions, onGraphChanged, onError]);

  /** Drawing an edge by hand means the same thing as dropping the node. */
  const onConnect = useCallback(
    (c: Connection): void => {
      if (!admin || !c.source || !c.target) return;
      // Same meaning as dropping onto it: an edge drawn out of the bucket unassigns the target.
      if (c.source === NO_DEPARTMENT_ID) {
        void reparent(c.target, null, 'department');
        return;
      }
      const parent = nodes.find((n) => n.id === c.source);
      if (!parent) return;
      void reparent(c.target, c.source, parent.data.kind);
    },
    [admin, nodes, reparent],
  );

  /**
   * Keep React Flow's own change stream but drop selection churn from re-render storms: only position
   * and selection changes matter here, and `remove` must never be honoured — Backspace on a selected
   * node would otherwise silently delete an employee from the chart with no confirmation.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<OrgNodeData>>[]): void => {
      const kept = changes.filter((c) => c.type !== 'remove');
      onNodesChange(kept);
      if (!admin) return;
      for (const c of kept) {
        /**
         * Arrow-key moves arrive here and nowhere else, so without this a keyboard-only layout edit was
         * visible all session and never written. Mouse drags are excluded by the dragActive ref, not by
         * `dragging === false` alone: @xyflow/system emits one settled change immediately BEFORE
         * onNodeDragStop, so the flag alone double-writes every drag — including gestures that turn out
         * to be a re-parent.
         */
        if (c.type !== 'position' || c.dragging !== false || !c.position) continue;
        if (dragActive.current.has(c.id)) continue;
        const target = nodes.find((n) => n.id === c.id);
        if (!target) continue;
        // The rollback target is where the node stood before this burst of nudges, so snapshot only when
        // no write for it is queued yet — every later arrow in the same burst must not overwrite it.
        if (!pending.current.has(c.id)) preDrag.current.set(c.id, { ...target.position });
        persistPosition({ ...target, position: c.position });
      }
    },
    [onNodesChange, admin, nodes, persistPosition],
  );

  /** Single click opens the department / employee modal (chevron and "+" stopPropagation). */
  const onNodeClick = useCallback(
    (_ev: ReactMouseEvent, node: Node<OrgNodeData>): void => {
      // The bucket is a label with no record behind it — a click must not look like a failed open.
      if (node.id === NO_DEPARTMENT_ID) return;
      if (node.data.kind === 'department') handlers.onOpenDepartment(node.id);
      else handlers.onOpenEmployee(node.id);
    },
    [handlers],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onNodeClick={onNodeClick}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      nodeTypes={ORG_NODE_TYPES}
      minZoom={0.15}
      maxZoom={1.6}
      defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
      nodesDraggable={admin}
      nodesConnectable={admin}
      elementsSelectable
      zoomOnDoubleClick={false}
      /* Deleting an org node is a real HR action with consequences; it belongs in the record, not on a
         keystroke over a canvas. */
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
      className="hr-ocanvas-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.3} color="var(--hz-pane-bd)" />
      <Controls showInteractive={false} position="bottom-left" />
      {built.nodes.length > 10 ? (
        <MiniMap
          pannable
          zoomable
          maskColor="color-mix(in srgb, var(--bg-primary) 62%, transparent)"
          nodeColor={(n) => {
            const d = n.data as OrgNodeData;
            return d.kind === 'department' ? departmentTone(d.tone, n.id) : 'var(--text-muted)';
          }}
          nodeStrokeWidth={2}
        />
      ) : null}
      <Panel position="top-right" className="hr-ocanvas-panel">
        <button type="button" className="hr-btn" onClick={() => void fitView({ padding: 0.18 })}>
          Fit
        </button>
        {admin ? (
          <button
            type="button"
            className="hr-btn"
            title="Clear every saved node position and lay the chart out automatically"
            onClick={() => void resetLayout()}
          >
            Reset layout
          </button>
        ) : null}
      </Panel>
    </ReactFlow>
  );
}

/**
 * `ReactFlowProvider` is required because the inner canvas uses `useReactFlow` (for
 * `getIntersectingNodes`, which is what makes drop-to-reparent possible).
 */
export function HrOrgCanvas(props: Parameters<typeof CanvasInner>[0]) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // React Flow measures its container on mount; rendering it before the pane has a size gives a
  // zero-height canvas that never recovers until a resize.
  return (
    <div className="hr-ocanvas">
      {mounted ? (
        <ReactFlowProvider>
          <CanvasInner {...props} />
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
