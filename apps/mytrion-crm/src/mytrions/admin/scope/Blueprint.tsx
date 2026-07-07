/**
 * Octane Scope — blueprint canvas. The widget rendered these dagre layouts as a
 * static HTML+SVG board; here they're interactive React Flow graphs (pan / zoom /
 * drag / fit / minimap) with the same dagre top-to-bottom layout, node styling and
 * kind-colored edges.
 */
import { useMemo, type CSSProperties } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { OCT_DEPT_COLOR, OCT_KIND, hideLogoTile, ic, platVM, type FlowDef } from './model';

interface BpStageData extends Record<string, unknown> {
  label: string;
  color: string;
  tools: string;
  depts: { name: string; color: string }[];
  logo: string | null;
  iconPath: string | null;
  abbr: string | null;
}

interface BpNoteData extends Record<string, unknown> {
  text: string;
}

type BpStageNode = Node<BpStageData, 'bpStage'>;
type BpNoteNode = Node<BpNoteData, 'bpNote'>;

function BpStageNodeView({ data }: NodeProps<BpStageNode>) {
  return (
    <div className="oct-bpnode" style={{ '--c': data.color } as CSSProperties}>
      <Handle type="target" position={Position.Top} className="oct-bphandle" />
      <span className="oct-bpnode__body">
        {data.logo ? (
          <span className="oct-bpnode__logo" data-logo-tile="1">
            <img src={data.logo} alt="" width={15} height={15} onError={hideLogoTile} style={{ display: 'block' }} />
          </span>
        ) : data.iconPath ? (
          <span className="oct-bpnode__icon">
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={data.iconPath} />
            </svg>
          </span>
        ) : data.abbr ? (
          <span className="oct-bpnode__abbr">{data.abbr}</span>
        ) : null}
        <span className="oct-bpnode__label">{data.label}</span>
      </span>
      {data.depts.length > 0 && (
        <span className="oct-bpnode__depts">
          {data.depts.map((dp) => (
            <span key={dp.name} className="oct-bpnode__dept" style={{ '--dc': dp.color } as CSSProperties}>
              {dp.name}
            </span>
          ))}
        </span>
      )}
      {data.tools ? (
        <span className="oct-bpnode__tools">
          <svg className="oct-bpnode__tools-ic" width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          {data.tools}
        </span>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="oct-bphandle" />
      <Handle type="source" position={Position.Right} id="r" className="oct-bphandle" />
    </div>
  );
}

function BpNoteNodeView({ data }: NodeProps<BpNoteNode>) {
  return (
    <div className="oct-bpnote">
      <Handle type="target" position={Position.Left} className="oct-bphandle" />
      {data.text}
    </div>
  );
}

const nodeTypes: NodeTypes = { bpStage: BpStageNodeView, bpNote: BpNoteNodeView };

/* ── dagre layout (same parameters as the widget's static board) ── */
const H = 50, ICON_W = 30, NOTE_W = 240, NOTE_H = 66, NOTE_GAP = 92, PAD = 30;

const widthFor = (label: string) =>
  Math.min(270, Math.max(150, Math.round(24 + ICON_W + label.length * 6.6)));

function heightFor(n: FlowDef['nodes'][number]): number {
  let h = H;
  if (n.depts && n.depts.length) h += 28; // dept-chip row
  if (n.tools) {
    // per-stage tools line (wraps)
    const cpl = Math.max(18, Math.floor((widthFor(n.label) - 26) / 5.4));
    h += Math.max(1, Math.ceil(n.tools.length / cpl)) * 14 + 9;
  }
  return h;
}

function buildBlueprintGraph(flow: FlowDef, accent: string): { nodes: Node[]; edges: Edge[] } {
  if (!flow.nodes.length) return { nodes: [], edges: [] };

  const g = new Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 52, ranksep: 82, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  flow.nodes.forEach((n) => g.setNode(n.id, { width: widthFor(n.label), height: heightFor(n) }));
  flow.edges.forEach((e) => g.setEdge(e.from, e.to));
  dagreLayout(g);

  // geo[] holds center-based geometry; adjust (side hint, note column), then normalize.
  const geo: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
  const meta = flow.nodes.map((n) => {
    const w = widthFor(n.label), h = heightFor(n);
    const p = g.node(n.id) ?? { x: 0, y: 0 };
    geo[n.id] = { cx: p.x, cy: p.y, w, h };
    const data: BpStageData = {
      label: n.label,
      color: OCT_KIND[n.kind] ?? accent,
      tools: n.tools ?? '',
      depts: (n.depts ?? []).map((name) => ({ name, color: OCT_DEPT_COLOR[name] ?? '#8893A8' })),
      logo: null,
      iconPath: null,
      abbr: null,
    };
    if (n.platform) {
      const v = platVM(n.platform);
      data.logo = v.logo;
      data.iconPath = v.iconPath;
      data.abbr = v.abbr;
    } else {
      data.iconPath = ic(n.icon) || null;
    }
    return { id: n.id, side: n.side ?? '', note: n.note ?? '', w, h, data };
  });

  // `side` hint → push a branch node (e.g. Closed/Lost) clear of the note corridor.
  const sided = meta.filter((m) => m.side);
  if (sided.length) {
    const main = meta.filter((m) => !m.side);
    const minL = Math.min(...main.map((m) => geo[m.id]!.cx - m.w / 2));
    const maxR = Math.max(...main.map((m) => geo[m.id]!.cx + m.w / 2));
    sided.forEach((m) => {
      if (m.side === 'left') geo[m.id]!.cx = minL - 80 - m.w / 2;
      else geo[m.id]!.cx = maxR + 80 + m.w / 2;
    });
  }

  // annotation notes → a column to the right of the whole graph.
  const noted = meta.filter((m) => m.note);
  if (noted.length) {
    const rightMost = Math.max(...meta.map((m) => geo[m.id]!.cx + m.w / 2));
    const ncx = rightMost + NOTE_GAP + NOTE_W / 2;
    noted.forEach((m) => {
      geo[`${m.id}__note`] = { cx: ncx, cy: geo[m.id]!.cy, w: NOTE_W, h: NOTE_H };
    });
  }

  // normalize so the whole graph sits in a PAD-margined (0,0) canvas
  let minX = Infinity, minY = Infinity;
  Object.values(geo).forEach(({ cx, cy, w, h }) => {
    minX = Math.min(minX, cx - w / 2);
    minY = Math.min(minY, cy - h / 2);
  });
  const ox = PAD - minX, oy = PAD - minY;

  const nodes: Node[] = meta.map((m) => {
    const c = geo[m.id]!;
    const node: BpStageNode = {
      id: m.id,
      type: 'bpStage',
      position: { x: Math.round(c.cx + ox - m.w / 2), y: Math.round(c.cy + oy - m.h / 2) },
      data: m.data,
      style: { width: m.w },
      initialWidth: m.w,
      initialHeight: m.h,
    };
    return node;
  });
  noted.forEach((m) => {
    const c = geo[`${m.id}__note`]!;
    const node: BpNoteNode = {
      id: `${m.id}__note`,
      type: 'bpNote',
      position: { x: Math.round(c.cx + ox - NOTE_W / 2), y: Math.round(c.cy + oy - NOTE_H / 2) },
      data: { text: m.note },
      style: { width: NOTE_W },
      initialWidth: NOTE_W,
      initialHeight: NOTE_H,
      draggable: false,
    };
    nodes.push(node);
  });

  const kindOf: Record<string, string> = {};
  flow.nodes.forEach((n) => { kindOf[n.id] = n.kind; });
  const edges: Edge[] = flow.edges.map((e, i) => {
    const col = OCT_KIND[kindOf[e.to] as keyof typeof OCT_KIND] ?? accent;
    const edge: Edge = {
      id: `e${i}`,
      source: e.from,
      target: e.to,
      style: { stroke: col, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: col, width: 16, height: 16 },
    };
    if (e.label) {
      edge.label = e.label;
      edge.labelStyle = { fill: col, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700 };
      edge.labelBgStyle = { fill: 'var(--bg1)', stroke: col };
      edge.labelBgPadding = [7, 3];
      edge.labelBgBorderRadius = 5;
    }
    return edge;
  });
  // dashed note connectors (right edge of stage → left edge of note), no arrow
  noted.forEach((m, i) => {
    edges.push({
      id: `n${i}`,
      source: m.id,
      sourceHandle: 'r',
      target: `${m.id}__note`,
      style: { stroke: 'var(--gb)', strokeWidth: 1.5, strokeDasharray: '5 4' },
    });
  });

  return { nodes, edges };
}

/** One blueprint, laid out with dagre and rendered as an interactive React Flow graph. */
export function ScopeBlueprint({ flow, accent }: { flow: FlowDef; accent: string }) {
  const graph = useMemo(() => buildBlueprintGraph(flow, accent), [flow, accent]);

  if (!flow.nodes.length) {
    return <div className="oct-bp-empty">This blueprint isn&apos;t mapped yet.</div>;
  }

  return (
    <div className="oct-bp-flow">
      <ReactFlow
        defaultNodes={graph.nodes}
        defaultEdges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={30} size={1.4} color="var(--gb)" />
        <Controls showInteractive={false} position="bottom-left" />
        {flow.nodes.length > 8 && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => (typeof n.data['color'] === 'string' ? n.data['color'] : '#64748B')}
            nodeStrokeWidth={3}
            maskColor="var(--haze)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
