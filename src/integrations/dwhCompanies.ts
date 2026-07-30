/**
 * Company typeahead over the DWH's `octane.dim_company` — the authoritative company ↔ carrier-id map.
 *
 * Used by the CS Maintenance create form so picking a company FILLS the carrier id rather than asking
 * an agent to type it. `dim_company` is the right source: 8,075 rows, every one carries a carrier_id,
 * and carrier_ids are unique (verified 2026-07-30). The Zoho Accounts lookup this replaces knew
 * nothing about carrier ids at all.
 *
 * Two shape facts that drive the API:
 *   - `carrier_id` is a BIGINT here while ours is TEXT (Zoho stored it as text), so it is cast on the
 *     way out and never compared un-cast.
 *   - 49 company NAMES map to more than one carrier id, so a name alone is ambiguous. Results are
 *     therefore rows, not names, and the caller must render the carrier id alongside the name so the
 *     agent picks a specific carrier.
 */
import { dwh } from './dwh.js';

export interface CompanyOption {
  carrierId: string;
  companyName: string;
  isActive: boolean;
  paymentTerms: string | null;
}

/** Max rows returned to a typeahead — enough to scan, small enough to render instantly. */
const LOOKUP_LIMIT = 25;

/**
 * Companies whose name or carrier id matches `query`.
 *
 * Ordering puts the most likely pick first: active companies before inactive, then prefix matches
 * before mid-string ones (typing "ACME" should not bury `ACME TRUCKING` under `BEST ACME HAULING`),
 * then alphabetical.
 */
export async function searchCompanies(query: string): Promise<CompanyOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const prefix = `${q}%`;
  // A digits-only query is a carrier id — match it exactly as well as by name.
  const digits = /^\d+$/.test(q) ? q : null;

  const rows = await dwh.query<{
    carrier_id: string | number;
    company_name: string;
    is_active: number;
    payment_terms: string | null;
  }>(
    `SELECT carrier_id, company_name, is_active, payment_terms
       FROM octane.dim_company
      WHERE company_name ILIKE $1
         OR ($2::text IS NOT NULL AND carrier_id::text LIKE $2 || '%')
      ORDER BY (is_active = 1) DESC,
               (company_name ILIKE $3) DESC,
               company_name
      LIMIT ${LOOKUP_LIMIT}`,
    [like, digits, prefix],
  );

  return rows.map((r) => ({
    carrierId: String(r.carrier_id),
    companyName: r.company_name,
    isActive: r.is_active === 1,
    paymentTerms: r.payment_terms,
  }));
}
