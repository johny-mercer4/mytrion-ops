/**
 * The org-structure canvas: a real React Flow graph, top-to-bottom, with both node levels.
 *
 * Interactions, and what each one writes:
 *   drag a node               → `PATCH /hr/org/position` (debounced; layout only, no audit row)
 *   drop a node on a node     → `PATCH /hr/org/reparent`
 *   drag handle → handle      → the same reparent, for people who prefer drawing the edge
 *   chevron                   → expand / collapse, client-side only
 *   "+"                       → create a child under this node
 *   double-click              → open the record
 *
 * DROP-TO-REPARENT IS OPT-IN PER GESTURE. React Flow has no built-in "dropped on a node" event, so the
 * target is resolved from the pointer position at drag end via `getIntersectingNodes`. A drag that ends
 * over empty canvas is therefore a MOVE, never an accidental detach — detaching is an explicit action
 * (drop onto the unassigned strip, or clear the field in the record).
 *
 * Positions are optimistic: the node stays where it was dropped and only a failed request moves it back.
 * Re-parents are NOT optimistic — the server rejects cycles, so the graph is rebuilt from the reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildOrgGraph, DEPT_H, DEPT_W, EMP_H, EMP_W, type OrgNodeData } from './orgGraph';

/** A drag can end many times a second; one write per settled position is enough. */
const POSITION_DEBOUNCE_MS = 400;

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
  includeTerminated,
}: {
  data: HrOrgStructureDto;
  admin: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  handlers: OrgCanvasHandlers;
  /** A successful re-parent — the tab refetches, which is what redraws the edges. */
  onGraphChanged: () => void;
  onError: (message: string) => void;
  includeTerminated: boolean;
}) {
  const built = useMemo(
    () => buildOrgGraph(data, { expanded, includeTerminated }),
    [data, expanded, includeTerminated],
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

  /**
   * Positions dragged in THIS session, applied on top of every rebuild.
   *
   * The graph is rebuilt from the server payload whenever a subtree is expanded or collapsed, and that
   * payload only knows the coordinates it was fetched with. Without this map, one click on a chevron
   * threw away every node the user had just arranged — including moves whose debounced write had landed
   * but arrived after the last refetch.
   */
  const localPos = useRef(new Map<string, { x: number; y: number }>());

  const applyLocal = useCallback((list: Node<OrgNodeData>[]): Node<OrgNodeData>[] => {
    if (localPos.current.size === 0) return list;
    return list.map((n) => {
      const at = localPos.current.get(n.id);
      return at ? { ...n, position: at } : n;
    });
  }, []);

  // Adopt a rebuilt graph (data reloaded, or a subtree toggled). Nodes and edges are set TOGETHER —
  // edges taken straight from `built` would be one painted frame ahead of the nodes they connect, and
  // React Flow drops an edge whose endpoint is not yet present.
  useEffect(() => {
    setNodes(applyLocal(built.nodes));
    setEdges(built.edges);
  }, [built.nodes, built.edges, setNodes, applyLocal]);

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
          // A failed flush is not worth interrupting the re-parent for; the reload shows the truth.
        }),
      ),
    );
  }, []);

  /** Debounced position write, per node id. */
  const persistPosition = useCallback(
    (node: Node<OrgNodeData>): void => {
      if (!admin) return;
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
          onError(err instanceof Error ? err.message : 'Could not save the new position.');
        });
      }, POSITION_DEBOUNCE_MS);
      timers.current.set(node.id, t);
    },
    [admin, onError],
  );

  const reparent = useCallback(
    async (childId: string, parentId: string | null, parentKind: 'department' | 'employee') => {
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
        onError(err instanceof Error ? err.message : 'Could not move that node.');
      }
    },
    [nodes, onGraphChanged, onError, flushPositions],
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
    (_ev: unknown, node: Node<OrgNodeData>): void => {
      if (!admin) return;
      const size = (n: Node<OrgNodeData>) =>
        n.data.kind === 'department' ? { w: DEPT_W, h: DEPT_H } : { w: EMP_W, h: EMP_H };
      const self = size(node);
      const cx = node.position.x + self.w / 2;
      const cy = node.position.y + self.h / 2;
      const hit = nodes.find((n) => {
        if (n.id === node.id) return false;
        const { w, h } = size(n);
        return (
          cx >= n.position.x && cx <= n.position.x + w && cy >= n.position.y && cy <= n.position.y + h
        );
      });
      if (!hit) {
        persistPosition(node);
        return;
      }
      const targetKind = hit.data.kind;
      if (node.data.kind === 'department' && targetKind === 'employee') {
        onError('A department cannot sit under a person.');
        return;
      }
      void reparent(node.id, hit.id, targetKind);
    },
    [admin, nodes, persistPosition, reparent, onError],
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
    const moved = nodes.filter((n) => localPos.current.has(n.id) || n.position.x !== 0);
    localPos.current.clear();
    try {
      await Promise.all(moved.map((n) => setHrOrgPosition(n.data.kind, n.id, null)));
      onGraphChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not reset the layout.');
    }
  }, [admin, nodes, flushPositions, onGraphChanged, onError]);

  /** Drawing an edge by hand means the same thing as dropping the node. */
  const onConnect = useCallback(
    (c: Connection): void => {
      if (!admin || !c.source || !c.target) return;
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
      onNodesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onNodesChange],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      nodeTypes={ORG_NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.6}
      nodesDraggable={admin}
      nodesConnectable={admin}
      elementsSelectable
      /* A double-click on a node opens the record; leaving React Flow's default on meant it also zoomed
         the canvas underneath, so every open jumped the viewport. */
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
            return d.kind === 'department' ? departmentTone(d.tone) : 'var(--text-muted)';
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
