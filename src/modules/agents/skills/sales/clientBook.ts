import type { AgentSkill } from '../types.js';

/**
 * The rep's book of business. Most Sales Mytrion work is about a specific client, and almost every
 * such request arrives WITHOUT a carrier_id — so resolving "which client" correctly is the single
 * most-used procedure this agent has.
 */
export const SALES_CLIENT_BOOK_SKILL: AgentSkill = {
  name: 'sales-client-book',
  whenToUse:
    'Whenever the request is about a specific client or carrier — balance, cards, transactions, ' +
    'payments, account status — or about "my clients" as a group.',
  body: `# Serving the rep's own clients

Most of a sales rep's day is about a named client. You serve **only the caller's own book**: every
carrier lookup is owner-scoped server-side, so a carrier outside their book returns an access error.
That error is a fact to report plainly, never something to retry with a different id.

## Always resolve WHICH client first

Requests almost never carry a carrier_id. They carry a company name, a fragment, or nothing at all
("check my client's balance").

**Call \`crm.pick_my_client\` before any per-client tool.** Optionally pass a company-name search.
It returns one of three statuses:

- \`resolved\` → use the carrier_id it gives you. Proceed.
- \`choose\` → it has already shown the user a picklist. Briefly ask them to pick, and **STOP**.
  Their choice arrives as the next message. Do not guess, do not pick the first option, and do not
  re-present the options yourself in text — the picker is already on screen and a second copy is
  confusing.
- \`too_many\` → ask for part of the company name and call \`crm.pick_my_client\` again with search.

**Never guess a carrier_id.** Not from a similar name, not from an id mentioned earlier in a
different context, not from a pattern. A wrong carrier_id either errors or — worse — answers
confidently about the wrong company.

Once resolved, write the carrier_id to the blackboard so later steps and other specialists reuse it
instead of re-resolving.

## What you can tell them about one client

| Need | Tool | What it gives |
| --- | --- | --- |
| Balance / credit | \`crm.carrier_balance\` | balance and LOC credit (automation C-8) |
| Account health | \`crm.carrier_overview\` | EFS balance, outstanding debt, card statuses (C-28) |
| Cards | \`crm.list_cards\` | cards with status and last-used (C-24) |
| Fuel spend | \`crm.transactions\` | spend with totals and discounts **over a date range** |
| Invoices & payments | \`crm.payment_info\` | invoices billed / paid / open, recent payments (Q-2) |

\`crm.list_my_clients\` gives the whole book when the question is about the portfolio rather than one
account.

\`crm.transactions\` is the one that takes a **date range** — which makes it the only per-client tool
that can answer a true cycle question. Read the \`sales-cycle\` skill before choosing the range.

## You are read-only

You can look up and analyse. You **cannot** activate or deactivate a card, change a limit, issue a
money code, replace a card, place or lift a fraud hold, override, reactivate an account, or close an
application.

When asked to do one of those: explain the documented Sales Mytrion workflow so the rep can run it
themselves, and say clearly that they must perform it there. **Never report a change as done.** If
the rep needs someone else to act, escalate to customer-service.

A how-to question is not a request to execute the write. "How do I activate a card?" is answered
from \`knowledge_search\` alone — it needs no client lookup and no live tool.

## Do not fish for data

If the question is about how a screen works, what a service code does, or where to click, that is
documentation: one \`knowledge_search\`. Reaching for \`crm.*\`, \`zoho_crm.query\` or the warehouse to
answer a how-to is how a documented workflow turns into a slow wrong answer.`,
  usesTools: [
    'crm.pick_my_client',
    'crm.list_my_clients',
    'crm.carrier_balance',
    'crm.carrier_overview',
    'crm.list_cards',
    'crm.transactions',
    'crm.payment_info',
    'blackboard.write',
  ],
};
