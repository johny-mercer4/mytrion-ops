/**
 * Fuzzy carrier resolver — replaces the Zoho `mytrionFuzzySearchCarrier` Deluge function's CRM
 * reads (Company_Carrier_Id_Memory + Deals/Contacts/Accounts) with two Zoho-free sources:
 *   1. payment_carrier_memory (learned sender/company → carrier pairs), and
 *   2. the DWH `octane.dim_company` roster (company_name → carrier_id).
 * Given a payer's sender name / bank descriptor, it suggests the carrier(s) a payment likely
 * belongs to. Best-effort: DWH errors degrade to memory-only rather than failing the request.
 */
import { dwh } from '../../integrations/dwh.js';
import { logger } from '../../lib/logger.js';
import { carrierMemoryRepo } from '../../repos/carrierMemoryRepo.js';

export interface FuzzyMatch {
  carrierId: string;
  name: string;
  module: 'memory' | 'dim_company';
}

export interface FuzzyResult {
  matches: FuzzyMatch[];
  /** Set only when there is exactly one unique candidate (widget auto-fills it). */
  carrierId: string | null;
}

interface DimCompanyRow {
  carrier_id: string | number | null;
  company_name: string | null;
}

const MAX_MATCHES = 12;

export async function fuzzyResolveCarrier(input: {
  senderName?: string | undefined;
  description?: string | undefined;
  email?: string | undefined;
}): Promise<FuzzyResult> {
  const raw = (input.senderName || input.description || '').trim();
  if (!raw) return { matches: [], carrierId: null };

  const byCarrier = new Map<string, FuzzyMatch>();

  // 1) Learned memory (strongest signal).
  try {
    for (const m of await carrierMemoryRepo.findByCompany(raw)) {
      byCarrier.set(m.carrierId, { carrierId: m.carrierId, name: m.companyName, module: 'memory' });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'fuzzyCarrier: memory lookup failed');
  }

  // 2) DWH company roster — full-string contains, then a fallback on the longest significant token.
  try {
    const contains = await dwh.query<DimCompanyRow>(
      `select carrier_id, company_name from octane.dim_company where company_name ilike $1 limit ${MAX_MATCHES}`,
      [`%${raw}%`],
    );
    let rows = contains;
    if (rows.length === 0) {
      const token = raw
        .split(/\s+/)
        .filter((w) => w.replace(/[^a-z0-9]/gi, '').length >= 4)
        .sort((a, b) => b.length - a.length)[0];
      if (token) {
        rows = await dwh.query<DimCompanyRow>(
          `select carrier_id, company_name from octane.dim_company where company_name ilike $1 limit ${MAX_MATCHES}`,
          [`%${token}%`],
        );
      }
    }
    for (const r of rows) {
      if (r.carrier_id == null) continue;
      const cid = String(r.carrier_id);
      if (byCarrier.has(cid)) continue; // memory match already wins
      byCarrier.set(cid, { carrierId: cid, name: r.company_name ?? '', module: 'dim_company' });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'fuzzyCarrier: dim_company lookup failed');
  }

  const matches = [...byCarrier.values()].slice(0, MAX_MATCHES);
  return { matches, carrierId: matches.length === 1 ? matches[0]!.carrierId : null };
}
