/**
 * Automations catalog order + department category metadata. Order persists in localStorage
 * keyed per Zoho agent when available; falls back to `sales-auto-catalog-order`.
 */
import { getSession } from '@/api/session';
import { AUTO_LIST, type Automation } from './autoLive';

const BASE_KEY = 'sales-auto-catalog-order';

export type AutoDeptCode = 'C' | 'Q' | 'V' | 'M' | 'other';

export interface AutoCategory {
  code: AutoDeptCode;
  label: string;
  color: string;
  /** Stroked SVG path `d` for the category header icon. */
  icon: string;
}

/** Section order + labels (C=Customer Service, Q=Billing, V/M when present). */
export const AUTO_CATEGORIES: readonly AutoCategory[] = [
  {
    code: 'C',
    label: 'Customer Service',
    color: 'var(--orange)',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4 0M17 8a3 3 0 11-2 0',
  },
  {
    code: 'Q',
    label: 'Billing',
    color: 'var(--accent)',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    code: 'V',
    label: 'Verification',
    color: 'var(--ok)',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    code: 'M',
    label: 'Management',
    color: 'var(--violet)',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    code: 'other',
    label: 'Other',
    color: 'var(--muted)',
    icon: 'M4 6h16M4 12h16M4 18h16',
  },
];

export function catalogOrderKey(): string {
  const id = getSession()?.worker.zohoUserId?.trim();
  return id ? `${BASE_KEY}:${id}` : BASE_KEY;
}

function defaultOrder(): string[] {
  return AUTO_LIST.map((a) => a.id);
}

export function loadCatalogOrder(): string[] {
  try {
    const raw = localStorage.getItem(catalogOrderKey());
    if (!raw) return defaultOrder();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return defaultOrder();
    const known = new Set(AUTO_LIST.map((a) => a.id));
    const kept = parsed.filter((id): id is string => known.has(id));
    for (const id of defaultOrder()) {
      if (!kept.includes(id)) kept.push(id);
    }
    return kept;
  } catch {
    return defaultOrder();
  }
}

export function saveCatalogOrder(ids: string[]): void {
  try {
    localStorage.setItem(catalogOrderKey(), JSON.stringify(ids));
  } catch {
    /* storage full / disabled */
  }
}

export function deptOf(a: Automation): AutoDeptCode {
  const d = a.dept;
  if (d === 'C' || d === 'Q' || d === 'V' || d === 'M') return d;
  return 'other';
}

/** Reorder `order` so `dragId` lands where `dropId` currently sits. */
export function moveIdBefore(order: string[], dragId: string, dropId: string): string[] {
  if (dragId === dropId) return order;
  const next = order.filter((id) => id !== dragId);
  const at = next.indexOf(dropId);
  if (at < 0) return order;
  next.splice(at, 0, dragId);
  return next;
}

/** Sort filtered actions by saved order, then group into category sections (empty sections omitted). */
export function groupCatalog(
  actions: readonly Automation[],
  order: readonly string[],
): Array<{ category: AutoCategory; items: Automation[] }> {
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...actions].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  const byDept = new Map<AutoDeptCode, Automation[]>();
  for (const a of sorted) {
    const d = deptOf(a);
    const list = byDept.get(d) ?? [];
    list.push(a);
    byDept.set(d, list);
  }
  return AUTO_CATEGORIES
    .map((category) => ({ category, items: byDept.get(category.code) ?? [] }))
    .filter((g) => g.items.length > 0);
}
