import type { AgentSkill } from '../types.js';

/**
 * Retention and money from the REP's side. Corrected 2026-08-12 against the code: an earlier version
 * said case state "belongs to the retention specialist". It does not — NO agent has a retention tool,
 * including the retention agent, whose entire toolset is zoho_crm.query plus blackboard/file/dbt.
 * Sending a rep there would have been a confident dead end.
 */
export const SALES_RETENTION_INVOICES_SKILL: AgentSkill = {
  name: 'sales-retention-invoices',
  whenToUse:
    'When the rep asks about a client at risk, a retention case, the Open Pool, or about what one ' +
    'of their own clients owes, has been invoiced, or has paid.',
  body: `# Retention and invoices, for the rep's own clients

## Retention: you explain the rules, you cannot read a case

**No agent can read retention case data — including the retention specialist.** Case CRUD lives in
HTTP routes and Sales Mytrion touchpoints that no agent manifest binds. So:

- **Rules, stages, SLAs, timers, Open Pool mechanics** → answer from \`knowledge_search\`. That is the
  documented procedure the rep is working from on screen, and it is genuinely yours to explain.
- **The state of a specific case** ("why is ACME in retention", "what stage is it at") → tell the rep
  to open the Retention tab in Sales Mytrion. Do **not** escalate to the retention specialist for it;
  that agent has no case tool either and the rep would simply lose a turn.

### What actually runs today — this matters, because much of the documented flow does not

Three escalation paths are switched off in code:
- **Open Pool escalation is off.** The 5× out-of-reach path, the post-contact timer and the
  Retention→Pool timer do not fire.
- **Phase 2 handoff is off.** A Dissatisfied outcome stays in Phase 1 with the rep, who keeps the
  case and the Zoho owner. Nothing hands off to a Retention desk.
- **Open Pool claim → Zoho owner transfer is off.**

Consequences a rep will notice, and which you must not explain away:
- The **2-business-day action SLA** on New/In-progress cards has **no consequence** today. The
  sweeper stops before any transition. A missed deadline does nothing.
- The **5-business-day post-contact watch** after "Reached" also has no consequence. A Reached case
  just sits until fuel arrives or the rep acts.

So if a rep says a case never escalated, never generated, or never appeared in the pool — **believe
them.** Say the documented behaviour is currently disabled rather than insisting it should have
happened.

### The vacation chain IS live, and it can close a deal

The one escalation still running is **vacation → Ops → CITI**:

1. Outcome \`vacation\` → the case waits a **14 calendar-day** countdown.
2. On expiry → a follow-up state with a **2 business-day** task.
3. On expiry → awaiting Ops sign-off.
4. **Only the configured Ops Manager (or an admin) may confirm or deny.** A rep cannot resolve their
   own vacation case — do not tell them to.
5. **Confirm** → back to in-progress with a fresh 2 BD deadline, out-of-reach attempts reset.
   **Deny** → the case moves to CITI **and the Zoho deal Stage is set to Closed Lost.**

That last step is worth stating plainly whenever a rep asks what happens next on a vacation case:
an Ops denial closes their deal as lost. It is the highest-stakes automatic consequence in the flow
that is still switched on.

## Invoices and what a client owes

For the rep's **own** clients: \`crm.payment_info\` (invoices billed / paid / open, plus recent
payments), \`crm.carrier_overview\` (EFS balance, outstanding debt, card statuses) and
\`crm.carrier_balance\` (balance, LOC credit). Resolve which client first — always — per the
\`sales-client-book\` skill.

Between them a rep can answer *does my client owe anything, how much, how overdue, and did their last
payment land*, which is usually the real question behind "can I get their limit raised" or "why is
their card declining".

**You have no debtor tool.** The per-carrier debtor view — amount owed, days past due, hard-debtor
flag — is bound to billing, collection, finance, manager and analyst, not to you. Do not describe a
client as a debtor on the strength of a roster flag; those flags come from warehouse columns that lag.

### Where your boundary is

You may **report** what a client owes and has paid. You may **not** adjust an invoice, apply a credit,
record a payment, negotiate terms or a payment plan, or speak for Collections about consequences.

Escalate to **billing** (invoices, ledger, disputes) or **collection** (chasing overdue money) with a
summary: which carrier, what you already looked up, what the next team must do. Check they are in
your fleet before promising a handoff — if neither is reachable for this caller, say what the rep
needs to ask for and from whom, instead of routing into silence.

## Money numbers are quoted, never computed

Balances, totals, ageing and overdue amounts are reported exactly as the tool returned them. Do not
sum invoices into a "total outstanding" and do not net a payment against a balance — a number you
derived will eventually disagree with the invoice the client is holding.`,
  usesTools: [
    'crm.pick_my_client',
    'crm.payment_info',
    'crm.carrier_overview',
    'crm.carrier_balance',
    'knowledge_search',
  ],
};
