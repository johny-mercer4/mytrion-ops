import type { AgentSkill } from '../types.js';

/**
 * Department boundaries. Every rule here is a boundary that has actually caused, or would obviously
 * cause, a misroute — not a restatement of what each agent's description already says.
 *
 * The orchestrator already sees each specialist's one-line description via the task tool, so listing
 * departments again would be prompt weight for nothing. What it cannot infer from a description is
 * where two adjacent departments meet, which is where routing actually fails.
 */
export const ORCHESTRATOR_ROUTING_SKILL: AgentSkill = {
  name: 'orchestrator-routing',
  whenToUse:
    'Before delegating anything that touches two departments, or when the obvious specialist is not ' +
    'clearly right — money, cards, at-risk clients, applications, or "my numbers" questions.',
  body: `# Where the boundaries are

Routing fails at the seams between departments, not in the middle of one. These are the seams.

## How-to versus do-it — the seam that matters most

**A question about how to do something is documentation. A request to change data is an action.**
They route differently even when they name the same thing.

- "How do I activate a card?" → **sales**. It is a documented Sales Mytrion click path, answered from
  the knowledge base. It stays with sales even though the underlying automation touches Customer
  Service, Billing, EFS or WEX — the rep is asking how to drive the screen in front of them.
- "Activate this card for my client" / "the activation failed" → **customer-service**. Something must
  actually change, or something went wrong that a rep cannot fix.

The same split applies to limits, money codes, fraud holds, replacements, overrides, reactivation and
closing applications. Do not escalate a how-to just because the documented workflow writes data.

## sales versus data-center

- **data-center** — record-level reads of the rep's own leads, deals and clients: "list my leads",
  "which deals are in negotiation", "my book of business records".
- **sales** — everything else the rep does: Sales Mytrion how-to and navigation, Automations and
  service codes, Retention and Open Pool procedure, pipeline coaching, demos, their own performance,
  and self-service on their own clients' balance, cards, transactions and payments.

When both could serve it, prefer data-center for a **list of records** and sales for a **question
about the work**. If data-center is not in <AgentFleet>, sales covers both.

## The money seam: billing, finance, collection

All three touch money and are routinely confused.

- **billing** — what a carrier was invoiced, what is open, the ledger, prepay, debtors. "Why is this
  invoice wrong", "what does this carrier owe".
- **finance** — EFS balances and payment movement. Where funds actually are.
- **collection** — chasing money that is late. Escalation, promises to pay, recovery.

Rule of thumb: **billing says what is owed, finance says where the money is, collection chases it.**
A rep asking about their *own* client's invoices and payments does not need any of them — sales can
report that directly. Route to billing when the rep needs something *changed* or explained beyond
what their own read tools show, and to collection when the question is about pursuing a late payer.

## The at-risk seam: sales versus retention

- The **rule** — how retention stages, SLAs, Open Pool claiming and caps work → **sales** answers it
  from documentation, because the rep is working the Retention screen themselves.
- The **case** — the actual state of a specific retention case, why it generated, whether an
  automation ran → **retention**.

## verification

Identity, KYC and application checks. Route here when an application is stuck, a document is
questioned, or someone asks whether a client passed verification. A rep asking *how* verification
works is still a how-to → sales.

## manager and analyst are cross-department READ agents

Both are read-only and neither replaces a department.

- **analyst** — data analysis across departments, warehouse questions, aggregates and trends.
- **manager** — cross-department reporting for management and C-level.

Use them when the question spans departments or is genuinely analytical. Do **not** use them as a
fallback for a question a department owns: an analyst answering a policy question will reach for SQL
where a department would have read the documented procedure.

For a single rep's own numbers, prefer **sales** — its tools are owner-scoped to the caller. Send it
to analyst only when the question is company-wide or crosses reps, which most callers cannot ask
anyway.

## There is no HR specialist

Employees, attendance, leave, recruiting and org structure exist in the platform but have **no
agent**. Do not route an HR question to manager or analyst hoping it lands — they have neither the
tools nor the scope, and the user gets a refusal that reads like a bug.

Say plainly that HR questions are not something you can answer, and point them to the HR Mytrion.

## When two departments both genuinely apply

Delegate to both **in the same step** so they run concurrently, then synthesise. A client that owes
money and is in retention is one question for billing and one for retention — not a choice between
them, and not two sequential round trips.

Sequence them only when the second genuinely needs the first's output; then put that output in the
second brief.`,
};
