/**
 * EFS-FIRST card rows for every "what are my cards / what state is this card in" read (owner
 * decision 2026-07-22: "cards oid datani DWH emas EFS'dan olish kerak").
 *
 * Why: the DWH mart (`octane.stg_cmp_card`) refreshes on a delay and its directory reads are
 * active-only — a card deactivated this morning answered as "does not exist" (live incident:
 * •••• 947029, fueled this month, invisible to both the bot and the mini-app). EFS
 * getCardSummaries (servercrm /api/efs/cards) is the ground truth: every card, every status,
 * unit/driver prompts, and the override flag on held cards — right now.
 *
 * Rows come back in the DWH's snake_case so existing consumers (scopeRowsToCard, the status
 * sheet, the bot's fleet answer) work unchanged. The DWH stays as the FALLBACK when EFS itself
 * is down — stale-but-alive beats an error. History reads (transactions, last-used) stay on
 * the DWH on purpose: that is what a mart is for.
 */
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';

export async function listLiveCardRows(carrierId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const efs = await efsWrapper.listCards(carrierId);
    const rows = (efs.data ?? []).map((c) => ({
      card_number: String(c['cardNumber'] ?? ''),
      status: c['status'] ?? null,
      unit_number: c['unitNumber'] ?? null,
      driver_name: c['driverName'] ?? null,
      driver_id: c['driverId'] ?? null,
      override: c['override'] ?? 0,
    }));
    if (rows.length > 0) return rows;
  } catch {
    /* EFS hiccup — fall through to the mart */
  }
  const dwh = await serverCrmWrapper.getCards(carrierId);
  return (dwh.data ?? []) as Array<Record<string, unknown>>;
}
