# Octane Sales — Agent Playbook

> Ingestion input for the Sales agent's knowledge base (namespace: `sales`). This is REFERENCE DATA
> retrieved on demand via `knowledge_search`, not a prompt. Ingest with:
> `POST /v1/knowledge/embed { title, content, department: "sales" }`.
> Keep specific thresholds/policies here up to date from the current SOPs — the agent cites this doc.

## Business context

Octane is a fuel-card company. It issues fleet fuel cards to trucking carriers and funds their fuel
purchases either against a **line of credit (LOC)** or a **prepaid balance**, then bills and collects
on that spend. A sales agent owns a book of carrier clients: they open and grow deals, run fuel-card
demos, and service their own clients day to day.

- **LOC carriers** spend against an approved credit limit and are invoiced on a billing cycle; the
  balance owed accrues until paid.
- **Prepay carriers** load a balance up front and spend it down; there is no credit exposure.
- Fuel spend happens on **EFS/WEX** cards; transactions post with fuel grade, gallons, and any
  negotiated discount.

## What the Sales agent can do today (read-only, owner-scoped)

The agent acts as the calling sales rep and can only ever see that rep's own clients. Every carrier
lookup is owner-scoped server-side; a carrier outside the rep's book returns an access error.

| Capability | Tool | Self-service code | Returns |
| --- | --- | --- | --- |
| Resolve which client | `crm.pick_my_client` | — | A picklist of the rep's carriers (auto-resolves a single match). Always used before a carrier lookup — never guess a carrier_id. |
| List my clients | `crm.list_my_clients` | — | The rep's carriers with terms + active/debtor flags. |
| Balance / credit | `crm.carrier_balance` | C-8 | LOC limit/used/remaining, or prepaid balance. |
| Account status | `crm.carrier_overview` | C-28 | EFS balance + outstanding debt + card statuses in one view. |
| Cards | `crm.list_cards` | C-24 | The carrier's fuel cards with status and last-used date. |
| Transactions | `crm.transactions` | C-15 | Fuel spend with totals and discounts over a date range. |
| Payment info | `crm.payment_info` | Q-2 | Invoices (billed/paid/open) + recent payments by source. |
| My performance | `agent.sales_snapshot` | — | Portfolio health: active/inactive/stuck counts, week-over-week transactions, gallons, new cards. |
| My activity | `agent.activity` | — | Calls, notes, leads, applications, tasks, meetings, deal value, conversion funnel. |
| Pipeline / CRM | `zoho_crm.query` | — | Read-only COQL over leads, deals, contacts (see the COQL reference before writing a query). |

## What the Sales agent CANNOT do yet — advise + escalate

These are self-service **actions** (writes/ticketing) that the agent cannot perform. Explain the
correct process to the rep and route to the team that performs it; never claim to have done them.

- **Card activation (C-1), deactivation (C-3)** — card lifecycle changes → customer-service.
- **Limit increase/decrease (C-4 / C-5)** — EFS spending-limit change (ticketing) → customer-service.
- **Money code (C-17)** — a money code is generated as a percentage of the carrier's **latest
  invoice**, is for **LOC carriers only**, is limited to **one code per invoice**, and **requires
  approval** → customer-service (with approval).
- **Card replacement (C-6)** — for a card on "hold for fraud"; replacements are issued per policy →
  customer-service.
- **Fraud hold / release (C-10), override the card (C-16)** — fraud-team actions → customer-service.
- **Account reactivation (C-7)** — reactivate a suspended carrier → customer-service.
- **BOCA link (C-27), close application (C-14)** — WEX-portal application tasks → verification.

## Escalation routing

- Card/account changes, money codes, fraud holds, other ticketing actions → **customer-service**.
- Identity/KYC or application verification, WEX application tasks → **verification**.
- Invoicing, collections, or payment disputes → **billing**.

## When to search the knowledge base

Search (`knowledge_search`) for Octane policy, procedure, product, pricing, or how-to — e.g. money-code
approval rules, LOC-vs-prepay terms, fraud-hold policy, or the COQL field names for a query. Do NOT
search for greetings or for live client-account questions (balances, cards, transactions, payments) —
those come from the `crm.*` and `agent.*` tools. Cite the docId of any passage you rely on.
