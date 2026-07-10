/**
 * Octane Scope — scene geometry. The intake "road" (Catmull-Rom spline through the
 * five stage points, cards tethered above/below) and the After hub (Client center
 * + cycle spokes trimmed to node edges).
 */
import type { CycleDef } from './model';
import { OCT_STAGES } from './stages';
import { OCT_AFTER_CENTER, OCT_AFTER_CYCLES } from './after';

export interface RoadPoint { x: number; y: number }
export interface RoadCard { x: number; y: number; above: boolean }
export interface Stem { x1: number; y1: number; x2: number; y2: number; color: string }
export interface Interconnect { path: string; midX: number; midY: number; color: string }

export interface RoadLayout {
  points: RoadPoint[];
  cards: RoadCard[];
  stems: Stem[];
  pathD: string;
  worldW: number;
  worldH: number;
  interconnects: Interconnect[];
}

/** Bounds-checked index access (the geometry arrays are all stage-length). */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`scope layout: index ${i} out of bounds`);
  return v;
}

export function computeRoadLayout(H = 760): RoadLayout {
  const baseX = 540;
  const gap = 660;
  const worldW = baseX + gap * 4 + 560;
  const Doff = Math.max(70, Math.min(180, 0.5 * H - 182));
  const waves = [-0.045, 0.055, -0.065, 0.05, -0.04];
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const points: RoadPoint[] = waves.map((w, i) => ({ x: baseX + gap * i, y: Math.round(0.5 * H + w * H) }));
  const cards: RoadCard[] = points.map((p, i) => {
    const above = i % 2 === 0;
    const raw = above ? p.y - Doff : p.y + Doff;
    return { x: p.x, y: clamp(raw, 182, H - 172), above };
  });

  // Catmull-Rom → cubic bezier through points
  const first = at(points, 0);
  const last = at(points, points.length - 1);
  const pts = [first, ...points, last];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = at(pts, i - 1), p1 = at(pts, i), p2 = at(pts, i + 1), p3 = at(pts, i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }

  // orb (road dot) → stage card tether
  const stems: Stem[] = points.map((p, i) => {
    const card = at(cards, i);
    return {
      x1: p.x, y1: p.y, x2: card.x,
      y2: card.above ? card.y + 58 : card.y - 58,
      color: at(OCT_STAGES, i).color,
    };
  });

  // interconnect arcs (WEX ⇄ Deal) — a bowed dashed link above the road
  const interconnects: Interconnect[] = [{ from: 2, to: 3 }].map((icn) => {
    const a = at(points, icn.from), b = at(points, icn.to);
    const apexY = Math.min(a.y, b.y) - 104;
    return {
      path: `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${apexY} ${b.x} ${b.y}`,
      midX: (a.x + b.x) / 2,
      midY: Math.min(a.y, b.y) - 74,
      color: OCT_STAGES[icn.to]?.color ?? '#14B8A6',
    };
  });

  return { points, cards, stems, pathD: d, worldW, worldH: H, interconnects };
}

/* ── After hub geometry ── */
export interface HubLine {
  path: string;
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  fromColor: string;
}

export interface HubLayout {
  cx: number;
  cy: number;
  posMap: Record<string, RoadPoint>;
  lines: HubLine[];
}

export function computeHubLayout(worldW: number, worldH: number): HubLayout {
  const cx = worldW / 2, cy = worldH / 2;
  const dx = Math.min(380, worldW * 0.23);
  const dy = Math.max(150, Math.min(215, worldH * 0.27));
  const posMap: Record<string, RoadPoint> = {
    verification: { x: cx - dx, y: cy - dy },
    retention: { x: cx + dx, y: cy - dy },
    'customer-service': { x: cx - dx, y: cy + dy },
    billing: { x: cx + dx, y: cy + dy },
    collection: { x: cx + dx + 296, y: cy + dy + 34 },
  };

  /* Route the links like the Intake road: thick, glowing, gradient, flowing — and
     trimmed to each node's EDGE so they never cross the Client orb or the cards. */
  const C = { x: cx, y: cy };
  const CLIENT_R = 84, HW = 110, HH = 52;
  const colorOf = (id: string) => OCT_AFTER_CYCLES.find((x) => x.id === id)?.color;
  const circleEdge = (ctr: RoadPoint, toward: RoadPoint, r: number): RoadPoint => {
    const ddx = toward.x - ctr.x, ddy = toward.y - ctr.y, m = Math.hypot(ddx, ddy) || 1;
    return { x: ctr.x + (ddx / m) * r, y: ctr.y + (ddy / m) * r };
  };
  const cardEdge = (ctr: RoadPoint, toward: RoadPoint, hw: number, hh: number): RoadPoint => {
    const ddx = toward.x - ctr.x, ddy = toward.y - ctr.y;
    const sc = Math.min(hw / (Math.abs(ddx) || 1e-6), hh / (Math.abs(ddy) || 1e-6));
    return { x: ctr.x + ddx * sc, y: ctr.y + ddy * sc };
  };

  const lines: HubLine[] = OCT_AFTER_CYCLES.map((c: CycleDef) => {
    const fromCtr = (c.from !== 'client' && posMap[c.from]) || C;
    const toCtr = posMap[c.id] ?? C;
    const start = c.from === 'client' ? circleEdge(C, toCtr, CLIENT_R) : cardEdge(fromCtr, toCtr, HW, HH);
    const end = cardEdge(toCtr, fromCtr, HW, HH);
    // gentle quadratic bow (perpendicular to the link) to echo the road's flow
    const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
    const ddx = end.x - start.x, ddy = end.y - start.y, len = Math.hypot(ddx, ddy) || 1;
    const bow = Math.min(34, len * 0.07);
    const ctrl = { x: mx - (ddy / len) * bow, y: my + (ddx / len) * bow };
    return {
      path: `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`,
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      color: c.color,
      fromColor: c.from === 'client' ? OCT_AFTER_CENTER.color : (colorOf(c.from) ?? c.color),
    };
  });

  return { cx, cy, posMap, lines };
}
