import type { AgentSkill } from '../types.js';

/**
 * Department boundaries — rewritten 2026-08-12 after a department review verified each proposed rule
 * adversarially. Of 24 candidate boundaries, **6 survived and 18 were refuted**, and nearly every
 * refutation had the same cause: the rule reasoned from HTTP route RBAC while the orchestrator
 * delegates to AGENTS, whose capability is `AgentManifest.tools`. Those are different planes, and a
 * rule that confuses them sends work to a specialist with no tool to do it.
 *
 * So this file leads with that principle and with what NO agent can do, because a confident dead end
 * costs a user more than an honest "we can't".
 */
export const ORCHESTRATOR_ROUTING_SKILL: AgentSkill = {
  name: 'orchestrator-routing',
  whenToUse:
    'Before delegating anything that touches two departments, or when the obvious specialist is not ' +
    'clearly right — money, cards, tickets, retention, applications, or "my numbers" questions.',
  body: `# Where the boundaries are

## The rule that governs all the others

**A department owning a job in the product does not mean its specialist can do that job here.**

The Sales Mytrion UI can do far more than any agent can. Much of the platform's real work runs
through HTTP routes and UI touchpoints that **no agent binds as a tool**. A specialist's capability
is exactly its tool list — nothing else.

So before routing, ask: *does the destination actually have a tool for this?* If it does not, routing
there produces a confident refusal that reads like a bug. Say plainly that it is not something the
assistant can do, and name where in the product it happens instead.

## What NO agent can do (check here first)

No specialist in the fleet has a tool for any of these. Do not route them — answer the how-to from
the owning department if one is documented, and otherwise say it must be done in the product:

- **Retention case data** — creating, reassigning, updating, or listing cases. Not even the retention
  specialist; its whole toolset is a CRM query plus blackboard/file/warehouse access.
- **Money codes** — listing or voiding them. They exist only as Sales Mytrion touchpoints.
- **Rejection reports** — no manifest carries a rejections tool at all.
- **Prospect search by MC/DOT** — no agent reaches the broker/prospect source.
- **Marketing spend** — cost-per-lead, campaign performance, channel ROI. There is no cost source in
  the platform, for anyone.
- **KPI targets and task assignment** — setting targets or assigning work to a rep.

For all of these, the honest answer names the screen. "That's done in the Retention tab of Sales
Mytrion — I can walk you through it" beats a routed refusal.

## The seam that matters most: how-to versus do-it

**A question about how to do something is documentation. A request to change data is an action.**
They route differently even when they name the same thing.

- "How do I activate a card?" / "where is Automations?" / "what does C-8 do?" → **sales**. Documented
  Sales Mytrion click paths, answered from the knowledge base. This stays with sales even when the
  underlying automation reaches Customer Service, Billing, EFS or WEX — the rep is asking how to
  drive the screen in front of them.
- Something must actually change → the rep runs it themselves in Sales Mytrion (these are
  self-service automations on their own carriers), or, if they are genuinely blocked, it escalates.

Do not escalate a how-to just because the documented workflow writes data.

## Verified boundaries

These six survived adversarial checking. Each names a destination that genuinely has the capability.

1. **Money owed → billing, then collection.** A rep may *report* what their client owes and has paid.
   Chasing it, applying a payment, crediting or writing off an invoice is billing's; pursuing a late
   payer is collection's.
2. **Applicant documents, KYC decisions, the verification roster → verification.** A rep's own
   verification *requests* on their own deals stay in Sales; approving or reviewing does not.
3. **Working the support queue / replying to a ticket → customer-service.** Sales has no Desk reply
   tool at all. But see the caveat below — this one is half-true.
4. **Sales Mytrion how-to → sales**, never data-center, even when asked from a records screen.
5. **Money-code actions → the Sales Mytrion UI**, not a specialist (see "no agent can do" above).
6. **Creating a ticket or escalation → sales.** This one inverts the obvious guess: ticket *creation*
   is gated on sales access and sales owns the documented Create-tab path. Customer-service works the
   queue; sales opens the item.

### The caveat on tickets

Of "reply to this ticket", "what did CS answer", and "work the support queue", only the last has a
working destination. The first two have **no owner in the agent fleet** — the sales Tickets tab is
not shipped, and no agent has a Desk reply tool. Say so rather than implying customer-service can
retrieve a reply for the rep.

## sales versus data-center is a preference, not a boundary

They hold the **same tools** and the same department grant. Neither can do anything the other cannot,
so this is never a capability question.

- If **data-center is in <AgentFleet>**, prefer it for record-level lists — "list my leads", "which
  deals are in negotiation", "my client roster".
- Prefer **sales** for how-to, Automations, Retention procedure, pipeline coaching, demos,
  performance, and per-client service.
- If data-center is **not** in the fleet — which is common, including in the Sales copilot path —
  send all of it to sales. Nothing is lost.

## Warehouse and cross-rep questions are caller-dependent

A rep's own gallons and swipes are owner-scoped to them by the tool itself. Company-wide or cross-rep
figures need **analyst** or **manager** — but only administrators and management typically have them
in their fleet.

- If analyst or manager **is** in <AgentFleet> → prefer it for company-wide or cross-rep warehouse
  questions.
- If it is **not** → the caller almost certainly cannot ask that question at all. Say the data is
  scoped to their own book rather than routing to a specialist they cannot reach.

Do not use analyst or manager as a fallback for a question a department owns: an analyst answering a
policy question reaches for SQL where a department would have read the documented procedure.

## Escalation targets must be in the fleet

Before telling a user another team will handle it, check <AgentFleet>. **customer-service is
frequently absent for a sales-only worker**, so "I'll pass this to Customer Service" can be a promise
nothing keeps. If the destination is not there, say what the user needs to ask for and who from.

Note also that a specialist's department grant is not always what its name suggests — marketing, for
instance, is reachable by sales workers. Pick by topic and by <AgentFleet>, never by assuming which
departments a caller "should" have.

## HR is about EMPLOYEES, never carriers

**hr** owns Octane's own people: the directory, roles, departments, reporting lines, leave balances
and company holidays. Route "who works here", "who does X report to", "how many leave days do I have
left", "when is the next holiday" there.

Two boundaries on it:

- **Anything about a carrier is never HR**, however people-shaped it sounds. "Which rep owns this
  carrier" is sales; "who approved this application" is verification.
- **Recruiting is NOT hr.** Candidates and job openings live in a separate Recruit area under its own
  access grant, with no agent. Do not send hiring questions to hr — say they are handled in the
  Recruit Mytrion.

hr is read-only and has no attendance tool. It cannot approve leave, edit a record or assign a
shift; those are HR Mytrion actions needing HR admin rights.

## When two departments both genuinely apply

Delegate to both **in the same step** so they run concurrently, then synthesise. A client that owes
money and is in retention is one question for billing and one about retention procedure — not a
choice, and not two sequential round trips. Sequence only when the second genuinely needs the first's
output; then put that output in the second brief.`,
};
