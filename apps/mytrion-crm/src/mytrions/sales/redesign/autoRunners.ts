/**
 * Automations run dispatch — one handler per AUTO_LIST id. Keeps AutoTab under the file-size
 * cap. Outbound paths match the Zoho self-service widget: Deluge / servercrm touchpoints,
 * browser-automation (BOCA / close-app), and Zapier (replacement / reactivation).
 */
import { getSession } from '@/api/session';
import { callTouchpoint } from '@/api/touchpoints';
import { money } from './live';
import {
  EFS_LOGIN_URL,
  fmtDate,
  mapInvRange,
  mapInvStatus,
  shortCard,
  str,
  titleStatus,
  type Addr,
  type Automation,
  type Card,
  type CmpInvoiceRow,
  type Deal,
  type DonePayload,
  type InvRow,
  type MoneyCodeForm,
  type PaymentsSummary,
  type UnitDriverForm,
} from './autoLive';
import { fetchTxnReport, type TxnReportState } from './txnReport';
import { deliverBlob } from './txnExportLibs';

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
      const cid = requireCarrier(deal);
      const status = mapInvStatus(input.invStatus);
      const range = mapInvRange(input.invRange);
      if (range === 'custom' && (!input.invFrom || !input.invTo)) {
        throw new Error('Pick a start and end date for the custom invoice range.');
      }
      const res = await callTouchpoint('sales_mytrion.fetch_invoices', {
        carrierId: cid,
        range,
        ...(range === 'custom' ? { from: input.invFrom, to: input.invTo } : {}),
        ...(status ? { status } : {}),
      });
      const list = (res.data ?? []) as Array<Record<string, unknown>>;
      input.setInvRows(list.map((inv, i) => {
        const r = inv;
        const id = str(r.invoiceId ?? r.invoice_id ?? r.id);
        const number = str(r.invoiceNumber ?? r.invoice_number ?? r.invoice_ref ?? r.number ?? r.name);
        return {
          id,
          inv: number || (id ? `Invoice #${id}` : `INV-${i + 1}`),
          date: fmtDate(
            r.issueDate ?? r.issue_date ?? r.invoice_date ?? r.period ?? r.created_date ?? r.createdDate
              ?? (r.fromDate && r.toDate ? `${String(r.fromDate)} — ${String(r.toDate)}` : null),
          ),
          amount: money(r.total_amount ?? r.totalAmount ?? r.amount ?? r.grandTotal),
          status: titleStatus(r.status ?? r.invoiceStatus ?? r.invoice_status),
        };
      }));
      return { kind: 'invoices' };
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
    case 'payments': {
      // Widget parity: DWH payment-info (summary/totals) + live CMP invoices are fetched in
      // PARALLEL and merged — NOT a fallback chain. Either half may fail independently.
      const cid = requireCarrier(deal);
      const [infoRes, cmpRes] = await Promise.allSettled([
        callTouchpoint('dwh.payment_info', { carrierId: cid, days: 90 }),
        callTouchpoint('carrier.check_payment', { carrierId: cid }),
      ]);
      let summary: PaymentsSummary | null = null;
      if (infoRes.status === 'fulfilled') {
        const p = infoRes.value;
        const totals = p.invoices?.totals ?? {};
        summary = {
          invoiceCount: str(p.invoices?.count ?? 0),
          totalBilled: money(totals.total_billed),
          totalPaid: money(totals.total_paid),
          openBalance: money(totals.open_balance),
          paymentCount: str(p.payments?.count ?? 0),
          paymentsTotal: money(p.payments?.total_amount),
        };
      }
      let cmpInvoices: CmpInvoiceRow[] = [];
      let cmpError: string | undefined;
      if (cmpRes.status === 'fulfilled') {
        cmpInvoices = (cmpRes.value.invoices ?? []).map((inv, i) => ({
          id: str(inv.id) || `cmp-${i}`,
          invoiceNumber: str(inv.invoiceNumber) || `#${i + 1}`,
          status: str(inv.status) || '—',
          total: money(inv.totalAmount),
          paid: money(inv.totalPaid),
          remaining: money(inv.remainingAmount),
        }));
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
      const ov = await callTouchpoint('dwh.carrier_overview', { carrierId: requireCarrier(deal) });
      return {
        kind: 'message',
        message: `${str(ov.company_name) || 'This carrier'}: account ${ov.is_active ? 'active' : 'inactive'}, ${ov.cards?.active_count ?? 0} active cards, open debt ${money(ov.cmp_debt?.total_debt ?? 0)}.`,
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
      const res = await callTouchpoint('dwh.cards_last_used', { carrierId: requireCarrier(deal), range: 'all_time' });
      const rows = (res.data ?? []).map((c) => {
        const r = c as Record<string, unknown>;
        return [
          shortCard(r.card_number ?? r.cardNumber),
          fmtDate(r.last_used ?? r.lastUsed ?? r.last_transaction_date),
          str(r.status) || '—',
        ];
      });
      if (rows.length === 0) return { kind: 'message', message: 'No card last-used rows for this carrier.' };
      return { kind: 'table', title: 'Card last used', columns: ['Card', 'Last used', 'Status'], rows };
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
      await callTouchpoint('dwh.card_activate', { carrierId: cid, cardNumber });
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
      const res = await callTouchpoint('cards.status', {
        carrierId: requireCarrier(deal),
        cardNumber: requireCard(card),
        action: 'DEACTIVATE',
      });
      return { kind: 'message', message: str(res.message) || `Card ${shortCard(card?.number)} set to ${str(res.newStatus) || 'INACTIVE'}.` };
    }
    case 'limits-change': {
      const res = await callTouchpoint('cards.limits', {
        carrierId: requireCarrier(deal),
        cardNumber: requireCard(card),
        limitId: input.limitId,
        limitValue: input.limitValue,
        action: input.limitDir === 'increase' ? 'INCREASE' : 'DECREASE',
      });
      return {
        kind: 'message',
        message: str(res.message) || `${input.limitId} ${input.limitDir}d to ${input.limitValue} on card ${shortCard(card?.number)}.`,
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

/** Signed URL → blob download (same end result as reference pdf/excel?download=1). */
export async function downloadInvoice(
  invoiceId: string,
  type: 'pdf' | 'excel' = 'pdf',
  fileBase?: string,
): Promise<void> {
  if (!invoiceId) throw new Error('This invoice has no downloadable id.');
  const { url } = await callTouchpoint('sales_mytrion.invoice_signed_url', { invoiceId, type });
  if (!url) throw new Error(`No ${type.toUpperCase()} available for this invoice.`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Invoice ${type.toUpperCase()} download failed (${resp.status}).`);
  const blob = await resp.blob();
  const safe = String(fileBase || `invoice-${invoiceId}`).replace(/[^\w.\- ]+/g, '_').trim();
  const ext = type === 'excel' ? 'xlsx' : 'pdf';
  const fileName = new RegExp(`\\.${ext}$`, 'i').test(safe) ? safe : `${safe}.${ext}`;
  deliverBlob(blob, fileName);
}

/** Sequential multi-invoice download (reference: downloadAllSelected / downloadSelectedExcel). */
export async function downloadInvoicesSequential(
  invoices: InvRow[],
  type: 'pdf' | 'excel',
  onProgress?: (msg: string) => void,
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i]!;
    onProgress?.(`Downloading ${inv.inv} (${i + 1}/${invoices.length})…`);
    try {
      await downloadInvoice(inv.id, type, inv.inv);
      ok++;
      if (i < invoices.length - 1) await new Promise((r) => setTimeout(r, 600));
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

