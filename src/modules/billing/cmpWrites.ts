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
    let entry = toEntry(ref);
    // Auto-mapped MX portal payment with no stored paymentId → resolve it, then reverse.
    if (!entry && input.carrierId && input.amount != null) {
      const res = await resolveRef({
        carrierId: str(input.carrierId),
        invoiceNumber: str(ref.invoiceNumber) || undefined,
        amount: Number(input.amount),
        chargedDay: input.chargedDay ? str(input.chargedDay) : undefined,
      });
      if (res.status !== 'success' || !res.entries?.length) {
        return { ok: false, kind: 'invoice', reversed: [], message: res.message || 'could not resolve CMP payment' };
      }
      try {
        await reverseInvoicePayments(res.entries);
        return { ok: true, kind: 'invoice', reversed: res.entries };
      } catch (e) {
        return { ok: false, kind: 'invoice', reversed: [], message: errText(e) };
      }
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

  // CRM-Sync (no CMP payment was ever made) → nothing to reverse.
  return { ok: true, kind: 'none', reversed: [] };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
