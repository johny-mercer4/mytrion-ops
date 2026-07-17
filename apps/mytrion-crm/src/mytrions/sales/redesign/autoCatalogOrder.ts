/**
 * Automations catalog order + department category metadata. Order persists in localStorage
 * keyed per Zoho agent when available; falls back to `sales-auto-catalog-order`.
 */
import { getSession } from '@/api/session';
import { AUTO_LIST, type Automation } from './autoLive';
import type { IconName } from './icons';

const BASE_KEY = 'sales-auto-catalog-order';

export type AutoDeptCode = 'C' | 'Q' | 'V' | 'M' | 'other';

export interface AutoCategory {
  code: AutoDeptCode;
  label: string;
  color: string;
  /** Semantic icon name resolved to a lucide glyph by <Icon> (see ./icons). */
  icon: IconName;
}

/** Section order + labels (C=Customer Service, Q=Billing, V/M when present). */
export const AUTO_CATEGORIES: readonly AutoCategory[] = [
  { code: 'C', label: 'Customer Service', color: 'var(--orange)', icon: 'users' },
  { code: 'Q', label: 'Billing', color: 'var(--accent)', icon: 'money' },
  { code: 'V', label: 'Verification', color: 'var(--ok)', icon: 'verification' },
  { code: 'M', label: 'Management', color: 'var(--violet)', icon: 'gear' },
  { code: 'other', label: 'Other', color: 'var(--muted)', icon: 'list' },
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
