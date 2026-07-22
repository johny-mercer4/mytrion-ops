/**
 * Octane tools for the SDK session — thin, paranoid pipes to mytrion /v1/support-bot/*.
 * RBAC lives SERVER-SIDE (role from registration, carrier must match); here we only
 * (a) bind the carrier per chat (closure — never a model argument) and (b) verify the
 * claimed asker actually spoke in this chat recently (the gateway saw every message,
 * so this check is authoritative, not DB-heuristic like v1).
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from './config.js';
import { sendButtons, sendMessage, setReaction } from './telegram.js';
import { logMessage } from './messageLog.js';

/** chatId → (userId → last-seen ms). Filled by the poll loop for every inbound message. */
export const recentSenders = new Map<number, Map<number, number>>();
const RECENT_MS = 5 * 60_000;

export function noteSender(chatId: number, userId: number): void {
  let m = recentSenders.get(chatId);
  if (!m) recentSenders.set(chatId, (m = new Map()));
  m.set(userId, Date.now());
}

function senderOk(chatId: number, userId: number): boolean {
  const ts = recentSenders.get(chatId)?.get(userId);
  return ts != null && Date.now() - ts <= RECENT_MS;
}

async function backend(path: string, payload: Record<string, unknown>, carrierId: string) {
  const res = await fetch(`${config.octaneBase}/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.octaneKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrierId, ...payload }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { error: true, status: res.status, message: String(data.message ?? '') };
  return data;
}

const asker = {
  telegram_user_id: z.number().describe('Telegram id of the MESSAGE SENDER who asked — never anyone else'),
};

/** One server per chat: carrierId is closed over — the model has no carrier parameter at all. */
export function buildOctaneServer(chatId: number, carrierId: string) {
  const guard = (userId: number): string | null =>
    senderOk(chatId, userId) ? null : 'refused: that user has not sent a recent message in this chat';
  const run = async (path: string, userId: number, extra: Record<string, unknown> = {}) => {
    const g = guard(userId);
    if (g) return { content: [{ type: 'text' as const, text: g }], isError: true };
    const data = await backend(path, { telegramUserId: String(userId), ...extra }, carrierId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], isError: Boolean((data as { error?: boolean }).error) };
  };

  return createSdkMcpServer({
    name: 'octane',
    version: '1.0.0',
    tools: [
      tool(
        'telegram_progress',
        "Send ONE short progress line to the group RIGHT NOW, before you continue working. Use when the task will take a while (report build, several lookups, a write chain): write it in the USER'S OWN language and name the task — e.g. \"Hisobotingizni tayyorlayapman — ~1 daqiqa\" / \"Готовлю отчёт — около минуты\". At most ONCE per request; never use it for the final answer.",
        { text: z.string().min(1).max(200) },
        async ({ text }) => {
          await sendMessage(chatId, text).catch(() => undefined);
          logMessage({ ts: new Date().toISOString(), chatId, userId: 0, name: 'bot', dir: 'out', text });
          return { content: [{ type: 'text' as const, text: 'progress line sent — continue the task' }] };
        },
      ),
      tool('octane_whoami', 'Is the sender a registered Octane mini-app user of this company, and their role (owner/driver)? Call FIRST for any service ask.', asker, ({ telegram_user_id }) => run('/support-bot/whoami', telegram_user_id)),
      tool('octane_card_status', "Card status for the asker: driver → their own card WITH live gallon limits (answers 'how many gallons left'); owner → fleet statuses.", asker, ({ telegram_user_id }) => run('/support-bot/card-status', telegram_user_id)),
      tool('octane_funds', 'Does the account have funds? Driver gets yes/no only (never figures); owner gets balance figures.', asker, ({ telegram_user_id }) => run('/support-bot/funds', telegram_user_id)),
      tool(
        'octane_txn_report',
        "LONG (~1-3 min): build the asker's transaction report and send it to THEIR PRIVATE Octane bot chat (never this group). Driver: own card, retail. Owner: fleet. ANNOUNCE FIRST via telegram_progress (ETA + 'DM'ga yuboraman'), and make your final reply the delivery confirmation.",
        { ...asker, range: z.enum(['day', 'week', 'month', 'quarter']).default('week'), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('custom window start YYYY-MM-DD — use when they name exact dates'), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), format: z.enum(['xlsx', 'pdf', 'csv']).default('xlsx') },
        ({ telegram_user_id, range, from, to, format }) => run('/support-bot/txn-report', telegram_user_id, { range, format, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
      ),
      tool(
        'octane_money_code',
        'LONG (~1-2 min): issue an EFS money code (OWNER only, confirm amount+unit+reason first). The code goes to their PRIVATE Octane bot chat — never this group. After confirmation, announce via telegram_progress (ETA + delivery promise); final reply = delivery confirmation.',
        { ...asker, amount: z.number().positive(), unit_number: z.string().min(1).max(60), reason: z.string().min(1).max(120) },
        ({ telegram_user_id, amount, unit_number, reason }) => run('/support-bot/money-code/draw', telegram_user_id, { amount, unitNumber: unit_number, reason }),
      ),
      tool(
        'octane_card_action',
        "Activate or deactivate one of the OWNER's cards by its last digits (confirm first — this changes the card's state).",
        { ...asker, card_last6: z.string().min(4).max(19), action: z.enum(['activate', 'deactivate']) },
        ({ telegram_user_id, card_last6, action }) => run('/support-bot/card-action', telegram_user_id, { cardLast6: card_last6, action }),
      ),
      tool(
        'octane_card_limits',
        'Change a card daily gallon limit (OWNER, confirm first): diesel ULSD or DEF, increase/decrease by N gallons.',
        { ...asker, card_last6: z.string().min(4).max(19), limit_id: z.enum(['ULSD', 'DEFD']), action: z.enum(['increase', 'decrease']), value: z.number().positive() },
        ({ telegram_user_id, card_last6, limit_id, action, value }) => run('/support-bot/card-limits', telegram_user_id, { cardLast6: card_last6, limitId: limit_id, action, value }),
      ),
      tool(
        'octane_card_info',
        "Update a card's unit number / driver ID (drivers: their own card, no card_last6 needed) or driver name (owner only, with card_last6).",
        { ...asker, card_last6: z.string().min(4).max(19).optional(), unit_number: z.string().min(1).max(60).optional(), driver_id: z.string().min(1).max(60).optional(), driver_name: z.string().min(1).max(120).optional() },
        ({ telegram_user_id, card_last6, unit_number, driver_id, driver_name }) =>
          run('/support-bot/card-info', telegram_user_id, {
            ...(card_last6 ? { cardLast6: card_last6 } : {}),
            ...(unit_number ? { unitNumber: unit_number } : {}),
            ...(driver_id ? { driverId: driver_id } : {}),
            ...(driver_name ? { driverName: driver_name } : {}),
          }),
      ),
      tool(
        'octane_transactions',
        "Recent transactions INLINE (MEDIUM ~20-40s): one line per fueling — date, gallons, location, card last6. NO dollar amounts (by design — money never goes to the group); when they ask for amounts/totals, use octane_txn_report (file to their DM) instead. Driver: own card. Owner: fleet, or one card via card_last6.",
        { ...asker, range: z.enum(['day', 'week', 'month']).default('week'), card_last6: z.string().min(4).max(19).optional(), limit: z.number().int().positive().max(20).default(10) },
        ({ telegram_user_id, range, card_last6, limit }) =>
          run('/support-bot/transactions', telegram_user_id, { range, limit, ...(card_last6 ? { card_last6 } : {}) }),
      ),
      tool(
        'octane_invoice',
        "LONG (~1 min): send the OWNER's LATEST invoice PDF to their PRIVATE bot chat (never this group). Announce via telegram_progress first (ETA + 'DM'ga yuboraman'); final reply = delivery confirmation.",
        asker,
        ({ telegram_user_id }) => run('/support-bot/invoice', telegram_user_id),
      ),
      tool('octane_balance_dm', "LONG (~1 min): send the OWNER their balance FIGURES to their private Octane bot chat (figures never go in the group). Announce via telegram_progress first (ETA + 'DM'ga yuboraman'); final reply = delivery confirmation.", asker, ({ telegram_user_id }) => run('/support-bot/balance', telegram_user_id)),
      tool('octane_manual_code', "LONG (~1 min): send the asker's manual entry code (full card number) to their PRIVATE bot chat. Drivers: own card. Owners: give card_last6. Announce via telegram_progress first (ETA + delivery promise); final reply = delivery confirmation.", { ...asker, card_last6: z.string().min(4).max(19).optional() }, ({ telegram_user_id, card_last6 }) => run('/support-bot/manual-code', telegram_user_id, card_last6 ? { cardLast6: card_last6 } : {})),
      tool(
        'octane_service_request',
        "File a support ticket with Octane's team for things you cannot do directly: billing-form (owner), card-replace, card-fraud, account-reactivate (owner), dispute-txn, or request fallbacks (money-code, card-activate, card-limit, override-card). Confirm the details with the user first; include their words as the comment. Tell them the team will follow up.",
        {
          ...asker,
          request: z.enum(['billing-form', 'card-replace', 'card-fraud', 'account-reactivate', 'dispute-txn', 'money-code', 'card-activate', 'card-limit', 'override-card']),
          comment: z.string().max(1500).describe("The user's own description of what they need"),
        },
        ({ telegram_user_id, request, comment }) => run('/support-bot/service-request', telegram_user_id, { request, comment }),
      ),
      tool('octane_tracking', "Where is the owner's card shipment? Owner-only tracking status.", asker, ({ telegram_user_id }) => run('/support-bot/tracking', telegram_user_id)),
      tool(
        'telegram_buttons',
        'Send a message WITH TAPPABLE BUTTONS — the preferred UX for confirmations and choices. Use for: write confirms (✅ Ha / ❌ Yo\'q), offering the service menu, picking a report period, choosing between matched cards. Button data comes back to you as a [button tap ...] message. After calling this, output SILENT (the buttons message IS your reply).',
        {
          text: z.string().min(1).max(500).describe("The message above the buttons, in the user's language"),
          buttons: z
            .array(z.object({ label: z.string().min(1).max(40), data: z.string().min(1).max(64).describe('What you receive back when tapped, e.g. confirm:override:yes') }))
            .min(1)
            .max(8),
          reply_to_message_id: z.number().optional(),
        },
        async ({ text, buttons, reply_to_message_id }) => {
          await sendButtons(chatId, text, buttons, reply_to_message_id);
          return { content: [{ type: 'text' as const, text: 'buttons sent — now output SILENT and wait for the tap' }] };
        },
      ),
      tool(
        'telegram_react',
        "React to a message with an emoji instead of replying — the cheapest ack. Use for pure confirmations (👍 done, ✅ handled) when no words are needed; then output SILENT.",
        { message_id: z.number(), emoji: z.enum(['👍', '✅', '🔥', '🙏', '👌', '⚡']) },
        async ({ message_id, emoji }) => {
          await setReaction(chatId, message_id, emoji).catch(() => {});
          return { content: [{ type: 'text' as const, text: 'reacted' }] };
        },
      ),
      tool('octane_override', "Unlock the asking DRIVER's own held card for ~30 minutes. Only after their explicit yes to a confirm question.", asker, ({ telegram_user_id }) => run('/support-bot/override', telegram_user_id)),
    ],
  });
}
