/**
 * Client/carrier self-service READ tools — the AI equivalent of the self-service widget's
 * automation blocks (C-8 Balance, C-28 Account Status, C-24 Cards, C-15 Transactions, Q-2 Payment
 * Info), keyed by carrier_id. Every carrier-scoped tool enforces owner-scoping (a sales agent may
 * only read their own clients; admins bypass) via assertCarrierOwned — servercrm itself does not.
 *
 * The typical flow the agent runs: crm.list_my_clients → ui.request_choice (pick a client) →
 * carrier-scoped tool with the chosen carrier_id.
 */
import { z } from 'zod';
import { serverCrmGet } from '../../../integrations/serverCrm.js';
import type { ToolManifest } from '../types.js';
import { assertCarrierOwned, fetchAgentRoster } from '../serverCrmScope.js';

const carrierId = z.union([z.string().min(1).max(60), z.number()]).transform((v) => String(v));
const passthrough = z.record(z.unknown());

// ── crm.list_my_clients — the "pick your client" data source (owner-scoped) ──────────────────
// Optional strings have NO min length: models often send "" for omitted params, and LangChain
// validates tool input against the schema BEFORE our handler runs — a min(1) would abort the run.
const listInput = z.object({
  search: z
    .string()
    .max(120)
    .optional()
    .describe('Optional filter to narrow by COMPANY name or carrier id. Leave empty to list all your clients; do NOT pass the agent\'s own name.'),
  agentName: z.string().max(200).optional().describe('Admins only: another agent name'),
  zohoUserId: z.string().max(60).optional().describe('Admins only: another agent zoho user id'),
});
const listOutput = z.object({
  agentName: z.string().nullable(),
  count: z.number(),
  clients: z.array(
    z.object({
      carrierId: z.number(),
      companyName: z.string(),
      paymentTerms: z.string().nullable(),
      isActive: z.boolean().nullable(),
      isDebtor: z.boolean().nullable(),
    }),
  ),
});

// ── crm.pick_my_client — server-built client picker (the robust "which client?" flow) ────────
// The model calls this with just an optional search; the SERVER builds the picklist options from
// the owner-scoped roster and returns an `elicitation` (surfaced to the frontend by the agent tool
// wrapper). Auto-resolves when there's exactly one match; forces a search when there are too many.
const pickInput = z.object({
  search: z.string().max(120).optional().describe('Optional COMPANY-name / carrier-id filter to narrow the picker'),
});
const choiceOption = z.object({ label: z.string(), value: z.string(), hint: z.string().optional() });
const pickOutput = z.object({
  status: z.enum(['resolved', 'choose', 'none', 'too_many']),
  carrierId: z.number().optional(),
  companyName: z.string().optional(),
  count: z.number().optional(),
  message: z.string().optional(),
  elicitation: z
    .object({ prompt: z.string(), field: z.string(), multiSelect: z.boolean(), options: z.array(choiceOption) })
    .optional(),
});

const PICK_MAX_OPTIONS = 25;

export const crmPickMyClientTool: ToolManifest<z.infer<typeof pickInput>, z.infer<typeof pickOutput>> = {
  name: 'crm.pick_my_client',
  description:
    'Resolve WHICH of the agent\'s clients a carrier action is for. Call this (optionally with a company-name search) instead of guessing a carrier_id. status "resolved" → exactly one match, use its carrier_id. status "choose" → a picklist has ALREADY been shown to the user automatically; do NOT list or invent the options yourself, just ask them to pick and STOP (their choice returns as the next message). status "too_many" → ask for part of the company name and call again with search.',
  inputSchema: pickInput,
  outputSchema: pickOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const search = input.search?.trim();
    const roster = await fetchAgentRoster(ctx, search ? { search } : {});
    const clients = roster.carriers;
    if (clients.length === 0) {
      return {
        status: 'none' as const,
        count: 0,
        message: search ? `No clients match "${search}".` : 'You have no clients on file.',
      };
    }
    const [only] = clients;
    if (clients.length === 1 && only) {
      return {
        status: 'resolved' as const,
        carrierId: only.carrierId,
        companyName: only.companyName,
        message: `Resolved to ${only.companyName} (carrier ${only.carrierId}).`,
      };
    }
    if (clients.length > PICK_MAX_OPTIONS) {
      return {
        status: 'too_many' as const,
        count: clients.length,
        message: `You have ${clients.length} clients — ask the user for part of the company name, then call crm.pick_my_client again with that as search.`,
      };
    }
    const options = clients.map((c) => {
      const hint = [c.paymentTerms, c.isDebtor ? 'Debtor' : null].filter(Boolean).join(' · ');
      return { label: c.companyName, value: String(c.carrierId), ...(hint ? { hint } : {}) };
    });
    return {
      status: 'choose' as const,
      count: clients.length,
      elicitation: { prompt: 'Which client?', field: 'carrier_id', multiSelect: false, options },
    };
  },
};

export const crmListMyClientsTool: ToolManifest<z.infer<typeof listInput>, z.infer<typeof listOutput>> = {
  name: 'crm.list_my_clients',
  description:
    "List the calling agent's own clients (carriers) — carrier_id + company name + payment terms + active/debtor flags. Use this to resolve WHICH client the user means before a carrier action; pair with ui.request_choice to let them pick.",
  inputSchema: listInput,
  outputSchema: listOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const search = input.search?.trim();
    const override = input.zohoUserId?.trim();
    const roster = await fetchAgentRoster(ctx, {
      ...(search ? { search } : {}),
      ...(override ? { override } : {}),
    });
    return { agentName: roster.agentName, count: roster.carriers.length, clients: roster.carriers };
  },
};

// ── carrier-scoped reads (all owner-guarded) ─────────────────────────────────────────────────
function carrierReadTool(cfg: {
  name: string;
  description: string;
  extra?: z.ZodRawShape;
  path: (input: { carrierId: string } & Record<string, unknown>) => string;
  query?: (input: Record<string, unknown>) => Record<string, string | number | undefined>;
}): ToolManifest<Record<string, unknown>, Record<string, unknown>> {
  const inputSchema = z.object({ carrierId, ...(cfg.extra ?? {}) });
  return {
    name: cfg.name,
    description: cfg.description,
    inputSchema: inputSchema as unknown as z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>,
    outputSchema: passthrough,
    riskClass: 'read',
    allowedAudiences: ['internal'],
    requiredScopes: ['servercrm:read'],
    rateLimit: { perMinute: 30 },
    async handler(input, ctx) {
      const id = String(input['carrierId']);
      await assertCarrierOwned(ctx, id); // owner-scoping — a sales agent only sees their own clients
      const query = cfg.query?.(input);
      return serverCrmGet<Record<string, unknown>>(cfg.path({ ...input, carrierId: id }), query);
    },
  };
}

export const crmCarrierBalanceTool = carrierReadTool({
  name: 'crm.carrier_balance',
  description:
    "Check a carrier's current balance / credit (LOC: credit limit/used/remaining; Prepay: balance). Requires carrier_id — resolve it via crm.list_my_clients + ui.request_choice if the user didn't give one. (Self-service block C-8.)",
  path: (i) => `/api/agent/dwh/carrier-balance/${encodeURIComponent(i.carrierId)}`,
});

export const crmCarrierOverviewTool = carrierReadTool({
  name: 'crm.carrier_overview',
  description:
    "One-shot account status for a carrier: EFS balance + outstanding CMP debt + card statuses. Requires carrier_id. (Self-service block C-28 Account Status.)",
  path: (i) => `/api/agent/dwh/carrier-overview/${encodeURIComponent(i.carrierId)}`,
});

export const crmListCardsTool = carrierReadTool({
  name: 'crm.list_cards',
  description:
    "List a carrier's fuel cards with status and last-used info. Requires carrier_id. (Self-service block C-24.)",
  path: (i) => `/api/agent/dwh/cards/${encodeURIComponent(i.carrierId)}`,
});

export const crmTransactionsTool = carrierReadTool({
  name: 'crm.transactions',
  description:
    "A carrier's fuel transactions with totals (fuel qty, funded total, discounts). Requires carrier_id; optional range (day|week|month|quarter|half_year|year|all_time) or from/to. (Self-service block C-15.)",
  extra: {
    // Plain string (not a strict enum) so an unexpected value can't abort the run pre-handler;
    // normalized to a known range below.
    range: z.string().max(20).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
  },
  path: (i) => `/api/agent/dwh/transactions/${encodeURIComponent(i.carrierId)}`,
  query: (i) => {
    const known = ['day', 'week', 'month', 'quarter', 'half_year', 'year', 'all_time'];
    const raw = typeof i['range'] === 'string' ? i['range'].trim() : '';
    const from = typeof i['from'] === 'string' && i['from'].trim() ? i['from'].trim() : undefined;
    const to = typeof i['to'] === 'string' && i['to'].trim() ? i['to'].trim() : undefined;
    return {
      range: from || to ? 'custom' : known.includes(raw) ? raw : 'month',
      from,
      to,
      limit: 500,
    };
  },
});

export const crmPaymentInfoTool = carrierReadTool({
  name: 'crm.payment_info',
  description:
    "A carrier's payment picture: invoices (billed/paid/open) + recent payments by source. Requires carrier_id; optional days window (default 90). (Self-service block Q-2 Payment Info.)",
  extra: { days: z.coerce.number().int().min(1).max(365).default(90) },
  path: (i) => `/api/agent/dwh/payment-info/${encodeURIComponent(i.carrierId)}`,
  query: (i) => ({ days: typeof i['days'] === 'number' ? i['days'] : 90 }),
});
