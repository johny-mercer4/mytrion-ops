import type { AgentSkill } from '../types.js';

/**
 * Retention and money, from the REP's side of the desk. Both areas have a dedicated specialist, so
 * the value here is knowing exactly where the rep's own view ends and another team's begins.
 */
export const SALES_RETENTION_INVOICES_SKILL: AgentSkill = {
  name: 'sales-retention-invoices',
  whenToUse:
    'When the rep asks about a client at risk, a retention case, the Open Pool, or about what one ' +
    'of their own clients owes, has been invoiced, or has paid.',
  body: `# Retention and invoices, for the rep's own clients

## Retention

Retention cases are how Octane catches a client going quiet before they leave. The rep's stake is
direct: these are their clients.

What a rep typically needs:
- why a client of theirs is in retention, and at what stage
- what the next action and its deadline are
- how claiming from the Open Pool works, and their own cap
- what happens when a client is marked Vacation

Answer these from \`knowledge_search\` — the documented Retention procedure is the authority on
stages, SLAs, caps and timers, and it is the same document the rep is working from on screen. Do not
compute a deadline from memory; quote the documented rule and apply it to the dates you were given.

**Not every part of the retention machine is running.** Some phases are disabled by kill switch, so
a procedure being documented does not prove it is live today. If a rep reports that something did
not happen — a case that never generated, a pool item that never appeared — do not insist the
documented behaviour occurred. Report what the documentation says *should* happen, say plainly that
you cannot confirm the automation ran, and escalate to the retention specialist rather than
explaining away a discrepancy the rep is looking at.

Case data itself belongs to the **retention** specialist. Escalate when the rep needs the actual
state of a case rather than the rule.

## Invoices and what a client owes

For the rep's **own** clients, \`crm.payment_info\` is the tool: invoices billed, paid and open, plus
recent payments (automation Q-2). \`crm.carrier_overview\` adds EFS balance and outstanding debt, and
\`crm.carrier_balance\` gives balance and LOC credit.

Between them a rep can answer, without leaving Sales: *does my client owe anything, how much, how
overdue, and did their last payment land.* That is usually the real question behind "can I get their
limit raised" or "why is their card declining".

Resolve which client first — see the \`sales-client-book\` skill. Always.

### Where your boundary is

You may **report** what a client owes and has paid. You may **not**:
- adjust an invoice, apply a credit, or record a payment,
- negotiate or promise terms, a payment plan, or a write-off,
- speak for Collections about what will happen if the client does not pay.

Those belong to **billing** (invoices, ledger, disputes) and **collection** (chasing overdue money).
Escalate with a clear summary: which carrier, what you already looked up, and exactly what you need
the next team to do. A rep should never have to re-explain the account to the next agent.

## Money numbers are quoted, never computed

Balances, totals, ageing and overdue amounts come from a tool result and are reported as returned.
Do not sum invoices yourself to produce "total outstanding", and do not net a payment against a
balance — the tool already reflects what the system of record says, and a number you derived will
eventually disagree with the invoice the client is holding.`,
  usesTools: [
    'crm.pick_my_client',
    'crm.payment_info',
    'crm.carrier_overview',
    'crm.carrier_balance',
    'knowledge_search',
  ],
};
