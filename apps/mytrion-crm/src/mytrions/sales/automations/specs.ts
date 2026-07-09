/**
 * Automation runners — one spec per Automations-tab card. Each `run` composes 1–3
 * touchpoint calls (the legacy widget's flow for that code) and returns a renderable
 * Outcome. Pure async logic: no React in here, ideal unit-test target.
 */
import { getSession } from '@/api/session';
import { callTouchpoint } from '@/api/touchpoints';
import type { CarrierBalance, CarrierOverview, CmpInvoiceList } from '@/api/touchpointTypes';

export interface AutomationTarget {
  carrierId: string | null;
  applicationId: string | null;
  companyName: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface RunInput {
  from?: string;
  to?: string;
  fields: Record<string, string>;
}

export interface KVRow {
  label: string;
  value: string;
}

export type Outcome =
  | { kind: 'kv'; title: string; rows: KVRow[] }
  | { kind: 'sections'; sections: Array<{ title: string; rows: KVRow[]; error?: string }> }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][] }
  | { kind: 'invoices'; rows: Array<{ id: string; label: string; status: string; amount: string }> }
  | { kind: 'ack'; message: string }
  | { kind: 'link'; label: string; url: string };

export interface AutomationSpec {
  /** The card needs an application id (WEX flows) instead of / besides a carrier id. */
  needsApplicationId?: boolean;
  fields?: FieldSpec[];
  run: (target: AutomationTarget, input: RunInput) => Promise<Outcome>;
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
};
const money = (v: unknown): string => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : fmt(v);
};

function requireCarrier(target: AutomationTarget): string {
  if (!target.carrierId) throw new Error('This client has no carrier id yet — pick a converted client.');
  return target.carrierId;
}

function balanceOutcome(b: CarrierBalance): Outcome {
  const rows: KVRow[] = [
    { label: 'Company', value: fmt(b.company_name) },
    { label: 'Account type', value: fmt(b.account_type ?? b.payment_terms) },
    { label: 'EFS balance', value: money(b.efs_balance ?? b.balance) },
    ...(b.credit_limit != null ? [{ label: 'Credit limit', value: money(b.credit_limit) }] : []),
    ...(b.credit_remaining != null ? [{ label: 'Credit remaining', value: money(b.credit_remaining) }] : []),
    ...(b.credit_used != null ? [{ label: 'Credit used', value: money(b.credit_used) }] : []),
    ...(b.billing_cycle ? [{ label: 'Billing cycle', value: fmt(b.billing_cycle) }] : []),
    ...(b.efs_error ? [{ label: 'EFS status', value: `⚠ ${b.efs_error}` }] : []),
  ];
  return { kind: 'kv', title: 'Balance', rows };
}

function overviewOutcome(o: CarrierOverview): Outcome {
  return {
    kind: 'sections',
    sections: [
      {
        title: 'EFS balance',
        rows: [
          { label: 'Company', value: fmt(o.company_name) },
          { label: 'Account type', value: fmt(o.account_type ?? o.payment_terms) },
          { label: 'Balance', value: money(o.efs_balance) },
          ...(o.credit_limit != null ? [{ label: 'Credit limit', value: money(o.credit_limit) }] : []),
        ],
        ...(o.efs_error ? { error: o.efs_error } : {}),
      },
      {
        title: 'Outstanding debt',
        rows: [
          { label: 'Total debt', value: money(o.cmp_debt?.total_debt ?? 0) },
          { label: 'Open invoices', value: fmt(o.cmp_debt?.invoice_count ?? 0) },
          { label: 'Max debt days', value: fmt(o.cmp_debt?.max_debt_days ?? 0) },
          { label: 'Hard debtor', value: o.cmp_debt?.is_hard_debtor ? 'YES' : 'no' },
        ],
        ...(o.cmp_debt?.error ? { error: o.cmp_debt.error } : {}),
      },
      {
        title: 'Cards',
        rows: [
          { label: 'Total', value: fmt(o.cards?.count ?? 0) },
          { label: 'Active', value: fmt(o.cards?.active_count ?? 0) },
        ],
        ...(o.cards?.error ? { error: o.cards.error } : {}),
      },
    ],
  };
}

function cmpInvoiceRows(list: CmpInvoiceList): Outcome {
  const rows = (list.invoices ?? []).map((inv) => [
    fmt(inv.invoiceNumber),
    fmt(inv.status),
    money(inv.totalAmount),
    money(inv.totalPaid),
    money(inv.remainingAmount),
    fmt(inv.period ?? inv.createdDate),
  ]);
  return {
    kind: 'table',
    title: 'CMP invoices',
    columns: ['Invoice #', 'Status', 'Total', 'Paid', 'Remaining', 'Period'],
    rows,
  };
}

export const AUTOMATION_SPECS: Record<string, AutomationSpec> = {
  balance: {
    run: async (target) =>
      balanceOutcome(await callTouchpoint('dwh.carrier_balance', { carrierId: requireCarrier(target) })),
  },

  'account-status': {
    run: async (target) =>
      overviewOutcome(await callTouchpoint('dwh.carrier_overview', { carrierId: requireCarrier(target) })),
  },

  tracking: {
    run: async (target) => {
      const t = await callTouchpoint('carrier.trucking_number_request', {
        carrierId: requireCarrier(target),
      });
      const info = t.trackingInfo ?? [];
      if (info.length === 0 && !t.fedexTracking) {
        return { kind: 'ack', message: 'No card shipments / tracking numbers found for this carrier.' };
      }
      return {
        kind: 'table',
        title: `Card shipments${t.fedexTracking ? ` — FedEx ${t.fedexTracking}` : ''}`,
        columns: ['Tracking #', 'Ship date', 'Cards ordered'],
        rows: info.map((r) => [fmt(r.trackingNumber), fmt(r.startDate), fmt(r.cardsOrdered)]),
      };
    },
  },

  payments: {
    // Primary: servercrm payment-info window. Fallback: the legacy Deluge CMP check.
    run: async (target) => {
      const carrierId = requireCarrier(target);
      try {
        const p = await callTouchpoint('dwh.payment_info', { carrierId, days: 90 });
        const totals = p.invoices?.totals ?? {};
        return {
          kind: 'sections',
          sections: [
            {
              title: 'Invoices (90 days)',
              rows: [
                { label: 'Count', value: fmt(p.invoices?.count ?? 0) },
                { label: 'Total billed', value: money(totals.total_billed) },
                { label: 'Total paid', value: money(totals.total_paid) },
                { label: 'Open balance', value: money(totals.open_balance) },
              ],
            },
            {
              title: 'Payments (90 days)',
              rows: [
                { label: 'Count', value: fmt(p.payments?.count ?? 0) },
                { label: 'Total amount', value: money(p.payments?.total_amount) },
              ],
            },
          ],
        };
      } catch {
        return cmpInvoiceRows(await callTouchpoint('carrier.check_payment', { carrierId }));
      }
    },
  },

  'billing-form': {
    run: async (target) => {
      const res = await callTouchpoint('carrier.billing_form_info', {
        carrierId: requireCarrier(target),
      });
      if (typeof res === 'string' || !res.billingForm) {
        return { kind: 'ack', message: 'No billing form on file for this carrier.' };
      }
      return {
        kind: 'sections',
        sections: [
          {
            title: 'Billing form',
            rows: Object.entries(res.billingForm)
              .filter(([, v]) => v !== null && typeof v !== 'object')
              .slice(0, 14)
              .map(([k, v]) => ({ label: k, value: fmt(v) })),
          },
          {
            title: `Verification notes (${res.notes?.length ?? 0})`,
            rows: (res.notes ?? []).slice(0, 6).map((n) => ({
              label: fmt(n.createdTime),
              value: `${fmt(n.title)} — ${fmt(n.content)}`.slice(0, 200),
            })),
          },
        ],
      };
    },
  },

  invoices: {
    run: async (target, input) => {
      const res = await callTouchpoint('sales_mytrion.fetch_invoices', {
        carrierId: requireCarrier(target),
        ...(input.from && input.to
          ? { range: 'custom', from: input.from, to: input.to }
          : { range: 'last_30' }),
      });
      const rows = (res.data ?? []).map((inv) => {
        const r = inv as Record<string, unknown>;
        const id = String(r.invoice_id ?? r.id ?? '');
        return {
          id,
          label: String(r.invoice_ref ?? r.invoice_number ?? id),
          status: fmt(r.status),
          amount: money(r.total_amount ?? r.amount),
        };
      });
      return { kind: 'invoices', rows };
    },
  },

  transactions: {
    run: async (target, input) => {
      const res = await callTouchpoint('dwh.transactions', {
        carrierId: requireCarrier(target),
        ...(input.from && input.to
          ? { range: 'custom', from: input.from, to: input.to }
          : { range: 'last_30' }),
        limit: 200,
      });
      const rows = (res.data ?? []).slice(0, 100).map((tx) => {
        const r = tx as Record<string, unknown>;
        return [
          fmt(r.transaction_date).slice(0, 10),
          fmt(r.card_number),
          fmt(r.location_name),
          fmt(r.transaction_fuel_quantity ?? r.line_item_fuel_quantity),
          money(r.net_total ?? r.line_item_amount),
        ];
      });
      return {
        kind: 'table',
        title: `Transactions (showing ${rows.length})`,
        columns: ['Date', 'Card', 'Location', 'Gallons', 'Amount'],
        rows,
      };
    },
  },

  'wex-tasks': {
    needsApplicationId: true,
    run: async (target) => {
      const appId = target.applicationId;
      if (!appId) throw new Error('This client has no application id — WEX tasks need one.');
      const [tasks, app] = await Promise.allSettled([
        callTouchpoint('application.update', { appId }),
        callTouchpoint('wex.application', { appId }),
      ]);
      const sections: Array<{ title: string; rows: KVRow[]; error?: string }> = [];
      if (app.status === 'fulfilled') {
        sections.push({
          title: 'WEX application',
          rows: [
            { label: 'Status', value: fmt(app.value.status) },
            { label: 'Group', value: fmt(app.value.statusGroup) },
            { label: 'Last modified', value: fmt(app.value.lastModified) },
          ],
        });
      } else {
        sections.push({ title: 'WEX application', rows: [], error: String(app.reason) });
      }
      if (tasks.status === 'fulfilled') {
        sections.push({
          title: `WEX tasks (${tasks.value.wexTasks?.length ?? 0})`,
          rows: (tasks.value.wexTasks ?? []).slice(0, 8).map((t) => ({
            label: fmt(t.createdDate),
            value: `${fmt(t.sbj)} — ${fmt(t.description)}`.slice(0, 220),
          })),
        });
      } else {
        sections.push({ title: 'WEX tasks', rows: [], error: String(tasks.reason) });
      }
      if (sections.every((s) => s.error)) throw new Error('Both WEX lookups failed.');
      return { kind: 'sections', sections };
    },
  },

  'card-activation': {
    fields: [
      { key: 'cardNumber', label: 'Card number', required: true, placeholder: '7083…' },
      { key: 'unitNumber', label: 'Unit number', required: false },
      { key: 'driverId', label: 'Driver ID', required: false },
    ],
    run: async (target, input) => {
      const carrierId = requireCarrier(target);
      const cardNumber = input.fields.cardNumber ?? '';
      await callTouchpoint('dwh.card_activate', { carrierId, cardNumber });
      const rows: KVRow[] = [{ label: 'Card', value: cardNumber }, { label: 'Status', value: 'ACTIVATED' }];
      if (input.fields.unitNumber || input.fields.driverId) {
        await callTouchpoint('efs.card_info', {
          carrierId,
          cardNumber,
          ...(input.fields.unitNumber ? { unitNumber: input.fields.unitNumber } : {}),
          ...(input.fields.driverId ? { driverId: input.fields.driverId } : {}),
        });
        if (input.fields.unitNumber) rows.push({ label: 'Unit number', value: input.fields.unitNumber });
        if (input.fields.driverId) rows.push({ label: 'Driver ID', value: input.fields.driverId });
      }
      return { kind: 'kv', title: 'Card activated', rows };
    },
  },

  'card-replacement': {
    // Eligibility view: live EFS statuses — replacement itself still routes via the fraud team.
    run: async (target) => {
      const res = await callTouchpoint('efs.cards', { carrierId: requireCarrier(target) });
      const rows = (res.data ?? []).map((c) => [fmt(c.card_number), fmt(c.status)]);
      return { kind: 'table', title: 'Live card statuses (hold-for-fraud = replacement eligible)', columns: ['Card', 'Status'], rows };
    },
  },

  'fraud-hold': {
    fields: [{ key: 'cardNumber', label: 'Card number (full)', required: true, placeholder: '7083…' }],
    run: async (target, input) => {
      const email = getSession()?.worker.email ?? '';
      if (!email) throw new Error('Your session has no email — the fraud team reply needs one.');
      await callTouchpoint('fraud.hold_release', {
        companyName: target.companyName,
        carrierId: requireCarrier(target),
        agentEmail: email,
        cardNumber: input.fields.cardNumber ?? '',
        ticketType: 'fraud_release',
      });
      return { kind: 'ack', message: `Release request sent to the fraud team — they'll reply to ${email}.` };
    },
  },

  'efs-login': {
    run: async () => ({
      kind: 'link',
      label: 'Open the WEX EFS eManager credentials guide (PDF)',
      url: 'https://www.wexdrive.com/otr/pdf/EFS_eMgr-CredGuide.pdf',
    }),
  },
};
