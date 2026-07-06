/** Octane-Scope risk items (/v1/scope/risks) — Blockers / Red Flags / Manual per lifecycle node. */
import { request } from './transport';

export type RiskCategory = 'blocker' | 'red_flag' | 'manual';

export interface ScopeRiskItem {
  id: string;
  nodeId: string;
  category: RiskCategory;
  label: string;
  icon: string;
  position: number;
}

export async function listRisks(nodeId?: string): Promise<{ items: ScopeRiskItem[] }> {
  return (await request('GET', '/scope/risks', {
    query: nodeId ? { nodeId } : {},
  })) as { items: ScopeRiskItem[] };
}

export async function createRisk(input: {
  nodeId: string;
  category: RiskCategory;
  label: string;
  icon?: string;
}): Promise<{ item: ScopeRiskItem }> {
  return (await request('POST', '/scope/risks', { body: input })) as { item: ScopeRiskItem };
}

export async function updateRisk(
  id: string,
  patch: { label?: string; icon?: string; category?: RiskCategory },
): Promise<{ item: ScopeRiskItem }> {
  return (await request('POST', `/scope/risks/${encodeURIComponent(id)}`, { body: patch })) as {
    item: ScopeRiskItem;
  };
}

export async function deleteRisk(id: string): Promise<void> {
  await request('POST', `/scope/risks/${encodeURIComponent(id)}/delete`, { body: {} });
}
