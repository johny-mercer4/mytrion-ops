/**
 * Automations run dispatch — one handler per AUTO_LIST id. Keeps AutoTab under the file-size
 * cap. Outbound paths match the Zoho self-service widget: Deluge / servercrm touchpoints,
 * browser-automation (BOCA / close-app), and Zapier (replacement / reactivation).
 */
import { getSession } from '@/api/session';
import { callTouchpoint } from '@/api/touchpoints';
import { request, requestBlob } from '@/api/transport';
import { money } from './live';
import { deliverBlob } from './txnExportLibs';
import {
  EFS_LOGIN_URL,
  LIMIT_CHANGE_MAX,
  filterClientInvoices,
  invRangeBounds,
  invoiceMoney,
  mapCmpInvoiceRow,
  mapInvRange,
  mapInvStatus,
  shortCard,
  str,
  type Addr,
  type Automation,
  type Card,
  type CardLookupRow,
  type CmpInvoiceRow,
  type Deal,
  type DonePayload,
  type InvRow,
  type MoneyCodeForm,
  type PaymentsSummary,
  type UnitDriverForm,
} from './autoLive';
import { fetchTxnReport, type TxnReportState } from './txnReport';

export type AutoPriority = '' | 'High' | 'Normal' | 'Low';

export interface RunInput {
  action: Automation;
  deal: Deal | null;
  card: Card | null;
  invRange: string;
  invStatus: string;
  invFrom?: string;
  invTo?: string;
  txnRange: string;
  txnFrom?: string;
  txnTo?: string;
  limitId: string;
  limitValue: string;
  limitDir: 'increase' | 'decrease';
  addr: Addr;
  note: string;
  due: string;
  /** BOCA / Close Application — WEX SF application owner (locked in the UI). */
  assignedTo: string;
  priority: AutoPriority;
  unitDriver: UnitDriverForm;
  moneyCode: MoneyCodeForm;
  setInvRows: (rows: InvRow[]) => void;
  setTxnReport: (report: TxnReportState | null) => void;
}

function requireCarrier(deal: Deal | null): string {
  const c = deal?.carrier?.trim();
  if (!c) throw new Error('This client has no carrier id yet — pick a converted client.');
  return c;
}

function requireCard(card: Card | null): string {
  const n = card?.number?.trim();
  if (!n) throw new Error('Select a card first.');
  return n;
}

function requireApp(deal: Deal | null): string {
  const a = deal?.app?.trim();
  if (!a || a === '—') throw new Error('This deal has no application id.');
  return a;
}

function requireAgentEmail(): string {
  const email = getSession()?.worker.email?.trim() ?? '';
  if (!email) throw new Error('Your session has no email — the request reply needs one.');
  return email;
}

function browserTaskMessage(
  label: string,
  appId: string,
  res: { action?: string; status?: string; reason?: string },
): DonePayload {
  const skipped = res.action === 'skipped';
  const parts = [
    skipped
      ? `${label} skipped — application status does not require it (${res.status || 'unknown'}).`
      : `${label} task sent for Application ${appId}.`,
  ];
  if (res.status) parts.push(`WEX Status: ${res.status}`);
  if (res.reason) parts.push(`Note: ${res.reason}`);
  return { kind: 'message', message: parts.join(' ') };
}

async function submitZapierTicket(
  deal: Deal,
  ticketType: 'replacement' | 'reactivation',
  addr?: Addr,
): Promise<DonePayload> {
  const carrierId = requireCarrier(deal);
  const companyName = deal.name;
  const agentEmail = requireAgentEmail();
  // Widget: replacement uses the confirmed street line; reactivation joins deal address fields.
  const companyAddress = ticketType === 'replacement' && addr
    ? addr.address.trim()
    : '';
  await callTouchpoint('zapier.ticket_email', {
    companyName,
    carrierId,
    agentEmail,
    ticketType,
    companyAddress,
    ...(ticketType === 'replacement' && addr
      ? {
          address: addr.address.trim(),
          city: addr.city.trim(),
          state: addr.state.trim(),
          zip: addr.zip.trim(),
        }
      : {}),
  });
  return { kind: 'message', message: 'Request received. You will receive the answer in the email.' };
}

export async function runAutomation(input: RunInput): Promise<DonePayload> {
  const { action: bm, deal, card } = input;
  switch (bm.id) {
    case 'invoices': {
      // Live CMP via existing servercrm GET /api/clients/:id/invoices (DWH fallback
      // upstream). Range/status are applied client-side — CMP success path ignores them.
      const cid = requireCarrier(deal);
      const status = mapInvStatus(input.invStatus);
      const range = mapInvRange(input.invRange);
      if (range === 'custom' && (!input.invFrom || !input.invTo)) {
        throw new Error('Pick a start and end date for the custom invoice range.');
      }
      const bounds = invRangeBounds(range, input.invFrom, input.invTo);
      const res = await callTouchpoint('clients.invoices', { carrierId: cid, limit: 500 });
      const raw = (res.data ?? []) as Array<Record<string, unknown>>;
      const list = filterClientInvoices(raw, {
        ...(status ? { status } : {}),
        ...(bounds ?? {}),
      });
      input.setInvRows(list.map((inv, i) => {
        const row = mapCmpInvoiceRow(inv, i);
        return {
          id: row.id,
          inv: row.invoiceNumber,
          date: row.date,
          amount: row.total,
          status: row.status,
        };
      }));
      // Endpoint is CMP-first; upstream does not emit meta.source on this route.
      return { kind: 'invoices', source: 'cmp' };
    }
    case 'transactions': {
      const cid = requireCarrier(deal);
      const custom =
        input.txnRange === 'custom' && input.txnFrom && input.txnTo
          ? { from: input.txnFrom, to: input.txnTo }
          : undefined;
      const report = await fetchTxnReport(cid, input.txnRange, custom);
      input.setTxnReport(report);
      return { kind: 'transactions' };
    }
    case 'view-manage-cards': {
      const carrierId = requireCarrier(deal);
      const response = await request('GET', '/sales/cards', {
        query: { carrierId },
        timeoutMs: 45_000,
      }) as { rows?: CardLookupRow[] };
      return {
        kind: 'card-lookup',
        carrierId,
        companyName: deal?.name ?? `Carrier ${carrierId}`,
        rows: response.rows ?? [],
      };
    }
    case 'payments': {
      // DWH summary + the same CMP-first invoice source as Request Invoices are fetched in
      // parallel. Either half may fail independently.
      const cid = requireCarrier(deal);
      const [infoRes, cmpRes] = await Promise.allSettled([
        callTouchpoint('dwh.payment_info', { carrierId: cid, days: 90 }),
        callTouchpoint('clients.invoices', { carrierId: cid, limit: 500 }),
      ]);
      let summary: PaymentsSummary | null = null;
      if (infoRes.status === 'fulfilled') {
        const p = infoRes.value;
        const totals = p.invoices?.totals ?? {};
        summary = {
          invoiceCount: str(p.invoices?.count ?? 0),
          totalBilled: invoiceMoney(totals.total_billed),
          totalPaid: invoiceMoney(totals.total_paid),
          openBalance: invoiceMoney(totals.open_balance),
          paymentCount: str(p.payments?.count ?? 0),
        };
      }
      let cmpInvoices: CmpInvoiceRow[] = [];
      let cmpError: string | undefined;
      if (cmpRes.status === 'fulfilled') {
        cmpInvoices = (cmpRes.value.data ?? []).map(mapCmpInvoiceRow);
      } else {
        cmpError = cmpRes.reason instanceof Error ? cmpRes.reason.message : 'CMP invoice check failed.';
      }
      if (!summary && cmpInvoices.length === 0) {
        // Both sources genuinely failed — surface the primary's error, not a silent empty.
        if (infoRes.status === 'rejected') throw infoRes.reason;
      }
      return { kind: 'payments', carrierId: cid, summary, cmpInvoices, cmpError };
    }
    case 'billing-form': {
      const cid = requireCarrier(deal);
      const res = await callTouchpoint('carrier.billing_form_info', { carrierId: cid });
      if (!res || typeof res === 'string' || !res.billingForm) {
        return { kind: 'message', message: 'No billing form on file for this carrier.' };
      }
      const rows = Object.entries(res.billingForm)
        .filter(([, v]) => v !== null && typeof v !== 'object')
        .slice(0, 14)
        .map(([k, v]) => [k, str(v)]);
      return { kind: 'table', title: 'Billing form', columns: ['Field', 'Value'], rows };
    }
    case 'balance': {
      const bal = await callTouchpoint('dwh.carrier_balance', { carrierId: requireCarrier(deal) });
      const parts = [`available balance ${money(bal.efs_balance ?? bal.balance)}`];
      if (bal.credit_limit != null) parts.push(`on a ${money(bal.credit_limit)} line`);
      if (bal.credit_remaining != null) parts.push(`${money(bal.credit_remaining)} remaining`);
      if (bal.efs_error) parts.push(`(EFS: ${bal.efs_error})`);
      return { kind: 'message', message: `${str(bal.company_name) || 'This carrier'} — ${parts.join(', ')}.` };
    }
    case 'account-status':
    case 'verification': {
      const carrierId = requireCarrier(deal);
      // Overview still owns balance/debt; card *counts* prefer live EFS so a C-1 activate
      // is visible on the next C-28 check (DWH dim_card / overview lag by hours).
      const [ovResult, efsResult] = await Promise.allSettled([
        callTouchpoint('dwh.carrier_overview', { carrierId }),
        callTouchpoint('efs.cards', { carrierId }),
      ]);
      if (ovResult.status === 'rejected') throw ovResult.reason;
      const ov = ovResult.value;
      let activeCards = ov.cards?.active_count ?? 0;
      if (efsResult.status === 'fulfilled') {
        const rows = (efsResult.value.data ?? []) as Array<Record<string, unknown>>;
        activeCards = rows.filter((r) => {
          const x = str(r.status).toLowerCase();
          if (/fraud|hold/.test(x)) return false;
          if (/inactive|deactiv|suspend|closed|cancel/.test(x)) return false;
          return /active|ok|good/.test(x);
        }).length;
      }
      return {
        kind: 'message',
        message: `${str(ov.company_name) || 'This carrier'}: account ${ov.is_active ? 'active' : 'inactive'}, ${activeCards} active cards, open debt ${money(ov.cmp_debt?.total_debt ?? 0)}.`,
      };
    }
    case 'tracking': {
      const carrierId = requireCarrier(deal);
      const t = await callTouchpoint('carrier.trucking_number_request', { carrierId });
      const fedexTracking = str(t.fedexTracking);
      const entries = (t.trackingInfo ?? []).map((r, i) => ({
        id: `${str(r.trackingNumber) || 'tracking'}-${i}`,
        trackingNumber: str(r.trackingNumber) || '—',
        startDate: str(r.startDate),
        cardsOrdered: r.cardsOrdered == null || r.cardsOrdered === '' ? '—' : str(r.cardsOrdered),
      }));
      if (entries.length === 0 && !fedexTracking) {
        return { kind: 'message', message: 'No card shipments / tracking numbers found for this carrier.' };
      }
      return { kind: 'tracking', carrierId, fedexTracking, entries };
    }
    case 'card-last-used': {
      const carrierId = requireCarrier(deal);
      // Status and any header-level last-used value come from live EFS. The historical DWH lookup
      // fills dates/counts when EFS omits them and also covers cards missing from the live summary.
      const [efsResult, dwhResult] = await Promise.allSettled([
        callTouchpoint('efs.cards', { carrierId }),
        callTouchpoint('dwh.cards_last_used', { carrierId, range: 'all_time' }),
      ]);
      if (efsResult.status === 'rejected' && dwhResult.status === 'rejected') {
        throw efsResult.reason;
      }
      const efsRows = efsResult.status === 'fulfilled'
        ? ((efsResult.value.data ?? []) as Array<Record<string, unknown>>)
        : [];
      const dwhRows = dwhResult.status === 'fulfilled'
        ? ((dwhResult.value.data ?? []) as Array<Record<string, unknown>>)
        : [];
      const cardKey = (r: Record<string, unknown>): string =>
        str(r.card_number ?? r.cardNumber).replace(/\D/g, '');
      const dwhByCard = new Map(dwhRows.map((r) => [cardKey(r), r]));
      const keys = new Set([...efsRows.map(cardKey), ...dwhRows.map(cardKey)].filter(Boolean));
      const rows = Array.from(keys).map((key) => {
        const efs = efsRows.find((r) => cardKey(r) === key);
        const dwh = dwhByCard.get(key);
        const efsLastUsed = str(
          efs?.lastUsedDate ?? efs?.last_used_date ?? efs?.lastUsed ?? efs?.last_used,
        ).trim();
        const dwhLastUsed = str(
          dwh?.last_used_date ?? dwh?.last_used ?? dwh?.lastUsed ?? dwh?.last_transaction_date,
        ).trim();
        const days = Number(dwh?.days_since_last_use ?? dwh?.daysSinceLastUse);
        const txCount = Number(dwh?.transactions ?? dwh?.transaction_count);
        return {
          cardNumber: key,
          status: str(efs?.status ?? dwh?.status) || 'Unknown',
          lastUsed: efsLastUsed || dwhLastUsed || null,
          daysSinceLastUse: Number.isFinite(days) ? days : null,
          transactions: Number.isFinite(txCount) ? txCount : null,
          source: efsLastUsed ? 'efs' as const : dwhLastUsed ? 'dwh' as const : 'none' as const,
        };
      });
      if (rows.length === 0) return { kind: 'message', message: 'No cards found for this carrier.' };
      return { kind: 'card-last-used', rows };
    }
    case 'money-code': {
      const cid = requireCarrier(deal);
      const amount = Number(input.moneyCode.amount);
      const reason = input.moneyCode.reason.trim();
      const unitNumber = input.moneyCode.unitNumber.trim();
      if (!reason) throw new Error('Pick a reason before drawing the money code.');
      if (!unitNumber) throw new Error('Enter the unit number this money code is for.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than $0.');
      const res = await callTouchpoint('dwh.money_code_draw', {
        carrierId: cid,
        amount,
        moneycode_reason: reason,
        unit_number: unitNumber,
      });
      const drawn = money(res.money_code_amount ?? amount);
      return {
        kind: 'message',
        message: `${drawn} drawn for ${str(res.company_name) || 'this carrier'} (unit ${unitNumber}). The code was sent to the carrier's mobile app — it is never shown here.${res.request_id != null ? ` Request #${res.request_id}.` : ''}`,
      };
    }
    case 'card-activation': {
      const cid = requireCarrier(deal);
      const cardNumber = requireCard(card);
      await callTouchpoint('efs.card_status', {
        carrierId: cid,
        cardNumber,
        action: 'ACTIVATE',
      });
      const { unitNumber, driverId, driverName } = input.unitDriver;
      const extras = [unitNumber.trim(), driverId.trim(), driverName.trim()].some(Boolean);
      if (extras) {
        await callTouchpoint('efs.card_info', {
          carrierId: cid,
          cardNumber,
          ...(unitNumber.trim() ? { unitNumber: unitNumber.trim() } : {}),
          ...(driverId.trim() ? { driverId: driverId.trim() } : {}),
          ...(driverName.trim() ? { driverName: driverName.trim() } : {}),
        });
      }
      return { kind: 'message', message: `Card ${shortCard(cardNumber)} activated${extras ? ' with unit/driver prompts updated' : ''}.` };
    }
    case 'card-deactivation': {
      const res = await callTouchpoint('efs.card_status', {
        carrierId: requireCarrier(deal),
        cardNumber: requireCard(card),
        action: 'DEACTIVATE',
      });
      return { kind: 'message', message: str(res.message) || `Card ${shortCard(card?.number)} set to ${str(res.newStatus) || 'INACTIVE'}.` };
    }
    case 'limits-change': {
      const delta = Number(input.limitValue);
      if (!Number.isFinite(delta) || delta <= 0) {
        throw new Error('Enter a limit change greater than 0 gallons.');
      }
      if (delta > LIMIT_CHANGE_MAX) {
        throw new Error(`A single limit change cannot exceed ${LIMIT_CHANGE_MAX} gallons.`);
      }
      const res = await callTouchpoint('efs.card_limits', {
        carrierId: requireCarrier(deal),
        cardNumber: requireCard(card),
        limitId: input.limitId,
        value: delta,
        action: input.limitDir === 'increase' ? 'INCREASE' : 'DECREASE',
      });
      const previousLimit = Number(res.previousLimit);
      const newLimit = Number(res.newLimit);
      if (!Number.isFinite(newLimit)) {
        throw new Error('EFS accepted the update but did not return the resulting gallon limit.');
      }
      return {
        kind: 'limit-update',
        result: {
          cardNumber: requireCard(card),
          limitId: input.limitId,
          previousLimit: Number.isFinite(previousLimit) ? previousLimit : Math.max(
            0,
            input.limitDir === 'increase' ? newLimit - delta : newLimit + delta,
          ),
          newLimit,
          delta,
          direction: input.limitDir,
        },
      };
    }
    case 'unit-driver': {
      const cid = requireCarrier(deal);
      const cardNumber = requireCard(card);
      const { unitNumber, driverId, driverName } = input.unitDriver;
      if (![unitNumber, driverId, driverName].some((v) => v.trim())) {
        throw new Error('Enter at least one of unit number, driver ID, or driver name.');
      }
      await callTouchpoint('efs.card_info', {
        carrierId: cid,
        cardNumber,
        ...(unitNumber.trim() ? { unitNumber: unitNumber.trim() } : {}),
        ...(driverId.trim() ? { driverId: driverId.trim() } : {}),
        ...(driverName.trim() ? { driverName: driverName.trim() } : {}),
      });
      return { kind: 'message', message: `Prompts updated on card ${shortCard(cardNumber)}.` };
    }
    case 'fraud-hold-release': {
      const email = getSession()?.worker.email ?? '';
      if (!email) throw new Error('Your session has no email — the fraud team reply needs one.');
      await callTouchpoint('fraud.hold_release', {
        companyName: deal?.name ?? '',
        carrierId: requireCarrier(deal),
        agentEmail: email,
        cardNumber: requireCard(card),
        ticketType: 'fraud_release',
      });
      return { kind: 'message', message: `Release request sent to the fraud team — they'll reply to ${email}.` };
    }
    case 'override-card': {
      const res = await callTouchpoint('efs.card_override', {
        carrierId: requireCarrier(deal),
        cardNumber: requireCard(card),
      });
      return { kind: 'message', message: str(res.message) || `Card ${shortCard(card?.number)} granted a temporary active window.` };
    }
    case 'card-replacement': {
      if (!deal) throw new Error('Select a deal first.');
      const a = input.addr;
      if (!a.address.trim() || !a.city.trim() || !a.state.trim() || !a.zip.trim()) {
        throw new Error('Confirm the full shipping address before submitting.');
      }
      return submitZapierTicket(deal, 'replacement', a);
    }
    case 'reactivation': {
      if (!deal) throw new Error('Select a deal first.');
      return submitZapierTicket(deal, 'reactivation');
    }
    case 'boca-boe-link': {
      if (!deal) throw new Error('Select a deal first.');
      const appId = requireApp(deal);
      const res = await callTouchpoint('browser.boca', {
        appId,
        assignedTo: input.assignedTo.trim(),
        priority: input.priority,
        dueDate: input.due.trim(),
        status: 'Not Started',
      });
      if (res.action === 'queued') {
        return {
          kind: 'message',
          message: `BOCA request queued for Application ${appId}. You can close this window; Mytrion Inbox will notify you when it finishes.`,
        };
      }
      return browserTaskMessage('BOCA', appId, res);
    }
    case 'close-app': {
      if (!deal) throw new Error('Select a deal first.');
      const appId = requireApp(deal);
      const res = await callTouchpoint('browser.close_application', {
        appId,
        assignedTo: input.assignedTo.trim(),
        priority: input.priority,
        dueDate: input.due.trim(),
        status: 'Not Started',
      });
      return browserTaskMessage('Close Application', appId, res);
    }
    case 'wex-tasks': {
      // Deluge `mytrionapplicationupdate` only (zoho-octane fetchWexTasks) — not the WEX SF app snapshot.
      const appId = requireApp(deal);
      const payload = await callTouchpoint('application.update', { appId });
      const tasks = (payload.wexTasks ?? []).map((task, index) => ({
        id: `${str(task.createdDate) || 'task'}-${index}`,
        subject: str(task.sbj) || 'New WEX Task Received',
        description: str(task.description) || 'No description provided.',
        createdDate: str(task.createdDate),
      }));
      return {
        kind: 'wex-tasks',
        appId,
        summary: str(payload.wexTaskField),
        tasks,
      };
    }
    case 'efs-login':
      return { kind: 'link', label: 'Open the WEX EFS eManager credentials guide (PDF)', url: EFS_LOGIN_URL };
    default:
      throw new Error('This action is not available for self-service.');
  }
}

/**
 * Download one invoice export, mirroring the self-service widget's `_downloadInvoicePdf`:
 * fetch the bytes, then hand a BLOB to the anchor.
 *
 * The previous implementation navigated an anchor straight at the servercrm signed URL. That is
 * the widget's MOBILE-only branch — on desktop it silently produced nothing, because (a) the click
 * happens after an await, outside the user-activation window, and (b) `download` is ignored on a
 * cross-origin href, so the filename and the download intent are both dropped. The promise still
 * resolved, so the UI reported success for a file that never arrived (QA round 3).
 *
 * `/sales/invoices/:id/:type` is our own same-origin proxy (see salesInvoices.routes.ts), which
 * keeps the servercrm API key server-side and sidesteps the cross-origin fetch that made the
 * earlier direct-fetch attempt fail CORS.
 */
export async function downloadInvoice(
  invoiceId: string,
  type: 'pdf' | 'excel' = 'pdf',
  fileBase?: string,
  carrierId?: string,
): Promise<void> {
  if (!invoiceId) throw new Error('This invoice has no downloadable id.');
  // Required by the backend: servercrm keys invoices by id alone, so the route proves the caller
  // owns this carrier AND that the invoice is part of it before releasing any bytes.
  const carrier = String(carrierId ?? '').trim();
  if (!carrier) throw new Error('Pick a client before downloading invoices.');
  const safe = String(fileBase || `invoice-${invoiceId}`).replace(/[^\w.\- ]+/g, '_').trim();
  const ext = type === 'excel' ? 'xlsx' : 'pdf';
  const fileName = new RegExp(`\\.${ext}$`, 'i').test(safe) ? safe : `${safe}.${ext}`;
  const base = `/sales/invoices/${encodeURIComponent(invoiceId)}/${type}`;
  const scope = `?carrierId=${encodeURIComponent(carrier)}`;

  // Zoho app WebView: blob URLs don't survive the tab hop, so open the short-lived signed URL and
  // let the OS download it natively. Same carve-out (and reason) as the widget — but routed through
  // our own gate rather than the unscoped servercrm endpoint.
  if (window.MytrionDownload?.isMobileWebView?.()) {
    const { url } = (await request('GET', `${base}/signed-url${scope}`)) as { url?: string };
    if (!url) throw new Error(`No ${type.toUpperCase()} available for this invoice.`);
    window.open(url, '_blank', 'noopener');
    return;
  }

  const blob = await requestBlob(`${base}${scope}`);
  if (blob.size === 0) throw new Error(`No ${type.toUpperCase()} available for this invoice.`);
  deliverBlob(blob, fileName);
}

/** Sequential multi-invoice download (reference: downloadAllSelected / downloadSelectedExcel). */
export async function downloadInvoicesSequential(
  invoices: InvRow[],
  type: 'pdf' | 'excel',
  onProgress?: (msg: string) => void,
  carrierId?: string,
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i]!;
    onProgress?.(`Downloading ${inv.inv} (${i + 1}/${invoices.length})…`);
    try {
      await downloadInvoice(inv.id, type, inv.inv, carrierId);
      ok++;
      if (i < invoices.length - 1) await new Promise((r) => setTimeout(r, 600));
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}
