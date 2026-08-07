/**
 * CMP write orchestration for Billing Mytrion. The payments row-of-record lives in Postgres, but
 * applying/reversing money still happens in CMP (external). These helpers call the servercrm
 * /api/billing/cmp/* endpoints (which hold the CMP credentials) and shape the results the write
 * routes need. Reversal inspects the PG-stored cmp_ref / split_allocations to know exactly what to
 * undo — mirroring the Deluge mytrionUnmapTransaction logic, minus the CRM writes (those are PG now).
 */
import { serverCrm } from '../../integrations/serverCrm.js';

export interface CmpEntry {
  invoiceId: string;
  paymentId: string;
  /** Present on a resolver-found entry (servercrm's mxCmpRefResolver always sets it); absent on a
   *  stored ref built from a bare {invoiceId, paymentId} pair with no amount recorded. */
  amount?: number;
}

/** Apply a payment to a CMP invoice → the created CMP paymentId. */
export async function applyInvoicePayment(p: {
  invoiceId: string;
  amount: number;
  paymentDate: string;
  notes?: string | undefined;
}): Promise<{ paymentId: string | null }> {
  const r = await serverCrm.post<{ paymentId?: string | null }>('/api/billing/cmp/invoice-payment', p);
  return { paymentId: r.paymentId ?? null };
}

/** Delete CMP payment(s) (unmap / return reversal). Throws on upstream failure. */
export async function reverseInvoicePayments(entries: CmpEntry[]): Promise<void> {
  await serverCrm.post('/api/billing/cmp/invoice-payment/reverse', { entries });
}

/** ± a prepay company balance (top-up with +amount, reversal with −amount). */
export async function patchCompanyBalance(companyId: string, amount: number): Promise<void> {
  await serverCrm.call('PATCH', '/api/billing/cmp/company-balance', { body: { companyId, amount } });
}

/** carrierId → CMP companyId (empty string if not found). */
export async function resolveCompanyId(carrierId: string): Promise<string> {
  const r = await serverCrm.get<{ companyId?: string }>(
    `/api/billing/cmp/resolve-company?carrierId=${encodeURIComponent(carrierId)}`,
  );
  return r.companyId ?? '';
}

/** Locate the CMP payment(s) behind an auto-mapped MX charge (unmap fallback). */
export async function resolveRef(p: {
  carrierId: string;
  invoiceNumber?: string | undefined;
  amount: number;
  chargedDay?: string | undefined;
}): Promise<{ status: string; entries?: CmpEntry[]; message?: string }> {
  return serverCrm.post('/api/billing/cmp/resolve-ref', p);
}

/* ── Reversal orchestration (unmap / return) ─────────────────────────────────── */

export interface ReverseInput {
  /** Stored CMP_Ref object (single invoice/prepay mapping), if any. */
  cmpRef?: Record<string, unknown> | null;
  /** Stored Split_Allocations array, if any. */
  splitAllocations?: Record<string, unknown>[] | null;
  /** For the auto-mapped MX fallback when no cmpRef is stored. */
  carrierId?: string | null;
  amount?: number | null;
  chargedDay?: string | null;
  /** MX Merchant's own invoice number (same value CMP uses), if known — scopes the CMP lookup to
   *  one invoice instead of scanning the carrier's recent paid invoices. */
  invoiceNumber?: string | null;
  /**
   * Look the payment up in CMP when the row stores NO ref at all — the money bounced, so a payment
   * the portal created on our behalf still has to come back out. RETURNS ONLY: a manual unmap must
   * not delete a genuine portal payment (unmapping is a CRM correction, the customer still paid).
   */
  resolveMissingRef?: boolean;
  /** mapping_type. A CRM-Sync mapping deliberately never created a CMP payment. */
  mappingType?: string | null;
  /**
   * Permits the CMP lookup-by-(carrierId, amount, chargedDay) path (`resolveThenReverse`) to run at
   * all. That lookup asks CMP "which payment sits behind this carrier+amount+day" and deletes
   * whatever it finds — safe for MX, where the portal auto-applies charges independent of our own
   * mapping (the original rationale this path was built for). NOT safe for any other rail: a
   * same-carrier/amount/day CMP payment could belong to a completely different transaction (e.g. a
   * Zelle transfer), and `isEntryClaimed` only catches that when the OTHER transaction already
   * stores a `cmp_ref` — which is null on the overwhelming majority of mapped rows. Defaults to
   * false; callers must opt in explicitly per rail (`tx.source === 'mx'`).
   */
  allowCmpLookup?: boolean;
  /**
   * Called with each resolved entry before it's reversed (resolveMissingRef path only). Return true
   * if the payment is already attributed elsewhere (e.g. another transaction's own stored cmp_ref) —
   * this DB-agnostic module has no repo access, so the caller supplies the check. Any claimed entry
   * aborts the whole reversal rather than deleting a payment that belongs to something else.
   */
  isEntryClaimed?: (entry: CmpEntry) => Promise<boolean>;
  /**
   * Resolve + verify (amount match, claim check) but stop short of actually deleting anything in
   * CMP — for a dry-run report (resolveMissingRef path only; a stored ref always reverses for real,
   * since dryRun only exists for the not-yet-committed backfill script).
   */
  dryRun?: boolean | undefined;
}

export interface ReverseResult {
  ok: boolean;
  /** 'invoice' | 'prepay' | 'split' | 'none' — what was reversed. */
  kind: string;
  reversed: unknown[];
  message?: string;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}
function toEntry(o: Record<string, unknown>): CmpEntry | null {
  const invoiceId = str(o.invoiceId);
  const paymentId = str(o.paymentId);
  return invoiceId && paymentId ? { invoiceId, paymentId } : null;
}

/**
 * Reverse whatever a transaction's stored mapping applied to CMP. Returns ok:false with a message on
 * partial/failed reversal (the caller must NOT clear the PG mapping in that case). A CRM-Sync mapping
 * (no cmpRef, no splits) has nothing to reverse → ok:true, kind:'none'.
 */
export async function reverseMapping(input: ReverseInput): Promise<ReverseResult> {
  const splits = Array.isArray(input.splitAllocations) ? input.splitAllocations : null;

  // Split mapping: reverse each allocation (invoice delete / prepay negative balance).
  if (splits && splits.length) {
    const reversed: unknown[] = [];
    for (const a of splits) {
      const type = str(a.type);
      if (type === 'invoice') {
        const entry = toEntry(a);
        if (!entry) continue; // syncOnly-style / no payment to reverse
        try {
          await reverseInvoicePayments([entry]);
          reversed.push(entry);
        } catch (e) {
          return { ok: false, kind: 'split', reversed, message: `split invoice reverse failed: ${errText(e)}` };
        }
      } else if (type === 'prepay') {
        const companyId = str(a.cmpCompanyId) || str(a.companyId);
        const amount = Number(a.amount) || 0;
        if (!companyId || !amount) continue;
        try {
          await patchCompanyBalance(companyId, -Math.abs(amount));
          reversed.push({ companyId, amount: -Math.abs(amount) });
        } catch (e) {
          return { ok: false, kind: 'split', reversed, message: `split prepay reverse failed: ${errText(e)}` };
        }
      }
    }
    return { ok: true, kind: 'split', reversed };
  }

  const ref = input.cmpRef && typeof input.cmpRef === 'object' ? input.cmpRef : null;
  const kind = ref ? str(ref.kind) : '';

  if (ref && kind === 'invoice') {
    const entry = toEntry(ref);
    // Auto-mapped MX portal payment with no stored paymentId → resolve it, then reverse.
    if (!entry && input.carrierId && input.amount != null && input.allowCmpLookup) {
      return resolveThenReverse(input, str(ref.invoiceNumber) || undefined);
    }
    if (!entry) return { ok: false, kind: 'invoice', reversed: [], message: 'no CMP paymentId to reverse' };
    try {
      await reverseInvoicePayments([entry]);
      return { ok: true, kind: 'invoice', reversed: [entry] };
    } catch (e) {
      return { ok: false, kind: 'invoice', reversed: [], message: errText(e) };
    }
  }

  if (ref && kind === 'prepay') {
    const companyId = str(ref.companyId);
    const amount = Number(ref.amount) || 0;
    if (!companyId || !amount) return { ok: false, kind: 'prepay', reversed: [], message: 'incomplete prepay ref' };
    try {
      await patchCompanyBalance(companyId, -Math.abs(amount));
      return { ok: true, kind: 'prepay', reversed: [{ companyId, amount: -Math.abs(amount) }] };
    } catch (e) {
      return { ok: false, kind: 'prepay', reversed: [], message: errText(e) };
    }
  }

  // ── No stored ref at all ──
  // Historically this was treated as "CRM-Sync, nothing to reverse" and returned ok silently. For a
  // RETURN that is wrong and expensive: MX charges the portal auto-applied to an invoice never stored
  // a CMP_Ref (0 of the 7.6k mapped MX rows in PG have one), so the bounced money would quietly stay
  // credited in CMP. The Deluge twin always resolved the payment live at return time; do the same.
  if (input.resolveMissingRef) {
    if (isCrmSyncMapping(input.mappingType)) {
      // The mapping deliberately never created a CMP payment, but a payment made outside our system
      // may still exist. Deleting a payment we cannot attribute is not ours to guess — flag it.
      return {
        ok: false,
        kind: 'none',
        reversed: [],
        message: `CRM-Sync mapping (${str(input.mappingType)}) — check the CMP payment by hand; reconcile manually`,
      };
    }
    if (!input.carrierId || input.amount == null) {
      return {
        ok: false,
        kind: 'none',
        reversed: [],
        message: 'mapped but no CMP reference and no carrier/amount to look one up — reconcile manually',
      };
    }
    if (!input.allowCmpLookup) {
      return {
        ok: false,
        kind: 'none',
        reversed: [],
        message: 'mapped but no CMP reference stored — reconcile manually',
      };
    }
    return resolveThenReverse(input, input.invoiceNumber ?? undefined);
  }

  // Unmap path: no ref means nothing this system applied to CMP → nothing to undo.
  return { ok: true, kind: 'none', reversed: [] };
}

/** Mappings that record a link WITHOUT moving money in CMP ("CRM-Sync (Invoice)" / "(Prepay)"). */
function isCrmSyncMapping(mappingType: string | null | undefined): boolean {
  return /crm-sync/i.test(mappingType ?? '');
}

const AMOUNT_EPS = 0.005;

/**
 * Ask CMP which payment(s) sit behind this charge (carrier + amount + charged day), then delete them.
 * The resolver only accepts an unambiguous match, so a miss returns ok:false with the reason — which
 * surfaces the return as "Reconcile CMP" instead of a silent success.
 *
 * The resolver's own "single payment on a known invoice" rule (invoiceNumber given) doesn't itself
 * verify the amount matches — it trusts the invoice scoping alone. Re-check here before deleting
 * anything: a resolved entry (or split group) that doesn't sum to the charge is a resolver miss, not
 * a real match, and must not delete a payment that belongs to something else.
 */
async function resolveThenReverse(input: ReverseInput, invoiceNumber: string | undefined): Promise<ReverseResult> {
  const res = await resolveRef({
    carrierId: str(input.carrierId),
    invoiceNumber,
    amount: Number(input.amount),
    chargedDay: input.chargedDay ? str(input.chargedDay) : undefined,
  });
  if (res.status !== 'success' || !res.entries?.length) {
    return {
      ok: false,
      kind: 'invoice',
      reversed: [],
      message: res.message || 'could not resolve the CMP payment — reconcile manually',
    };
  }
  const resolvedSum = res.entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  if (Math.abs(resolvedSum - Number(input.amount)) > AMOUNT_EPS) {
    return {
      ok: false,
      kind: 'invoice',
      reversed: [],
      message: `resolved payment(s) total ${resolvedSum} but the charge was ${input.amount} — reconcile manually`,
    };
  }
  if (input.isEntryClaimed) {
    for (const entry of res.entries) {
      if (await input.isEntryClaimed(entry)) {
        return {
          ok: false,
          kind: 'invoice',
          reversed: [],
          message: 'resolved payment is already attributed to another transaction — reconcile manually',
        };
      }
    }
  }
  if (input.dryRun) {
    return { ok: true, kind: 'invoice', reversed: res.entries, message: 'dry run — resolved, not reversed' };
  }
  try {
    await reverseInvoicePayments(res.entries);
    return { ok: true, kind: 'invoice', reversed: res.entries };
  } catch (e) {
    return { ok: false, kind: 'invoice', reversed: [], message: errText(e) };
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
