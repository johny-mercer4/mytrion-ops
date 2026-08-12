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

## FIRST: is this a how-to, or a lookup?

**Before anything else, decide whether the rep is asking how something WORKS or asking for a client's
actual DATA.** Everything below applies only to the second.

- *"How do I check a client's balance?"*, *"where do I see their cards?"*, *"what does C-8 do?"* →
  **documentation.** Answer from \`knowledge_search\` ALONE. Do **not** resolve a client, and do not
  call any \`crm.*\` tool — there is no client to look up, and reaching for one produces an answer with
  no citations to the click path the rep actually needs.
- *"What's ACME's balance?"*, *"pull their transactions"* → **data.** Continue with this skill.

This gate is first because it is the one this skill gets wrong most easily: the resolution procedure
below reads as unconditional, and a how-to question that triggers it comes back uncited and useless.
Measured on the Sales bench: with this skill loaded and no gate, "how do I check a client's balance
and see their card list?" called \`crm.pick_my_client\` instead of \`knowledge_search\` and scored 0/2
on cited documents, where the same question without the skill scored 2/2 every time.

## For a DATA request: always resolve WHICH client first

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
| Cards | \`crm.list_cards\` | LIVE EFS roster: status, unit, driver (no last-used) |
| Fuel spend | \`crm.transactions\` | spend with totals and discounts **over a date range** |
| Invoices & payments | \`crm.payment_info\` | invoices billed / paid / open, recent payments (Q-2) |

\`crm.list_my_clients\` gives the whole book when the question is about the portfolio rather than one
account. Its \`isActive\` / \`isDebtor\` flags come from warehouse columns that lag, so treat them as a
hint for sorting the list — not as an authoritative statement that a client is inactive or in debt.

Two verified limits worth knowing before you promise anything:

- **\`crm.list_cards\` reads LIVE EFS, and has no last-used.** It returns the current roster with
  status, unit and driver — deliberately EFS rather than the lagged warehouse mart, so it is the
  authoritative view of a card's state right now, with a DWH fallback if EFS is unreachable. It does
  NOT carry a last-used date: for that, use \`crm.transactions\` over a date range, or point the rep
  at the C-24 automation. Do not report a last-used date from this tool; it will not be there.
- **\`crm.transactions\` returns only the first page**, capped at 500 rows. For a busy carrier over a
  long range that is a partial picture. Say so when the count hits the cap instead of presenting a
  truncated total as complete.

\`crm.transactions\` is the one that takes a **date range**, which makes it the only per-client tool
that can answer a true cycle question. Read the \`sales-cycle\` skill before choosing the range.

## What you cannot reach per client

These exist in the platform but no tool of yours reads them, so do not imply you checked:
retention case state, support tickets, and call history (calls are linked to a lead, deal or
retention case — never to a carrier). Point the rep at the relevant Sales Mytrion tab instead.

## You are read-only

You can look up and analyse. You **cannot** activate or deactivate a card, change a limit, issue a
money code, replace a card, place or lift a fraud hold, override, reactivate an account, or close an
application.

When asked to do one of those: explain the documented Sales Mytrion workflow so the rep can run it
themselves, and say clearly that they must perform it there. **Never report a change as done.**

The rep running it in Sales Mytrion is the primary answer, not a fallback — those actions exist as
self-service automations on their own carriers. Escalate to customer-service only when the rep is
genuinely blocked (the automation failed, or the account needs something they cannot self-serve).
Do not promise that another team will pick it up: escalation targets are filtered by the caller's
access, and customer-service is frequently not reachable for a sales-only worker.

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
