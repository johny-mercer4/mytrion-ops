/**
 * Zelle auto-map suggestion flag — ported 1:1 from the Zoho widget
 * (billing-mytrion/js/utils.js `bmComputeZelleAutoMapFlag`). SUGGESTION ONLY: it never maps
 * anything. For an unmapped Zelle payment it tells the agent whether there's an obvious carrier —
 * a `5######` id embedded in the memo, or an exact sender match against carrier memory with exactly
 * one learned carrier — and the modal prefills the carrier-id field accordingly.
 */
import { fetchCarrierMemory } from '@/api/billing';
import type { TxRow } from './transactionModel';

export type AutoMapFlag =
  | { kind: 'memo'; carrierId: string }
  | { kind: 'memory-unique'; carrierId: string }
  | { kind: 'none'; candidates?: string[] };

type AutoMapTx = Pick<
  TxRow,
  'source' | 'isInvoiceMapped' | 'isReturned' | 'carrierId' | 'memo' | 'description' | 'sender' | 'name'
>;

/** Uppercase + collapse whitespace (matches the widget's bmNormalizeCompanyName). */
export function normalizeCompanyName(s: string | null | undefined): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Distinct 7-digit carrier ids (5######) embedded in text, excluding longer digit runs. */
export function extractMemoCarrierIds(text: string | null | undefined): string[] {
  return [...new Set(String(text ?? '').match(/(?<!\d)5\d{6}(?!\d)/g) ?? [])];
}

/**
 * Classify an unmapped Zelle transaction. Returns null for non-Zelle / already-mapped / returned /
 * already-carrier'd rows. A null `memoryIndex` hides sender-based flags (never a false
 * "Not Auto-Mapped" from missing data) — memo-based flags still resolve.
 */
export function computeAutoMapFlag(
  tx: AutoMapTx,
  memoryIndex: Map<string, Set<string>> | null,
): AutoMapFlag | null {
  if (!tx || tx.source !== 'zelle' || tx.isInvoiceMapped || tx.isReturned) return null;
  if ((tx.carrierId ?? '').toString().trim()) return null;

  const memoIds = extractMemoCarrierIds(`${tx.memo ?? ''} ${tx.description ?? ''}`);
  if (memoIds.length === 1) {
    const [cid] = memoIds;
    if (cid) return { kind: 'memo', carrierId: cid };
  }
  if (memoIds.length > 1) return { kind: 'none', candidates: memoIds };

  // Sender fallback — needs the memory index; degrade to hidden without it.
  if (!memoryIndex) return null;
  const sender = normalizeCompanyName(tx.sender || tx.name);
  if (!sender) return { kind: 'none' };
  const set = memoryIndex.get(sender);
  if (!set || set.size === 0) return { kind: 'none' };
  if (set.size === 1) {
    const [cid] = [...set];
    if (cid) return { kind: 'memory-unique', carrierId: cid };
  }
  return { kind: 'none', candidates: [...set] };
}

/**
 * Full carrier-memory index (normalized company → set of carrier ids), fetched + cached once per
 * session. Mirrors the widget's `_bmMemoryIndexPromise`. Returns null on failure (and resets the
 * cache so the next modal open retries) so sender flags degrade to hidden rather than wrong.
 */
let indexPromise: Promise<Map<string, Set<string>> | null> | null = null;
export function getCarrierMemoryIndex(): Promise<Map<string, Set<string>> | null> {
  if (!indexPromise) {
    indexPromise = fetchCarrierMemory()
      .then((res) => {
        const data = Array.isArray(res?.data) ? res.data : [];
        const index = new Map<string, Set<string>>();
        for (const rec of data) {
          const r = rec as { companyName?: unknown; carrierId?: unknown };
          const name = normalizeCompanyName(typeof r.companyName === 'string' ? r.companyName : '');
          const cid = String(r.carrierId ?? '').trim();
          if (!name || !cid) continue;
          const existing = index.get(name) ?? new Set<string>();
          existing.add(cid);
          index.set(name, existing);
        }
        return index;
      })
      .catch(() => {
        indexPromise = null;
        return null;
      });
  }
  return indexPromise;
}
