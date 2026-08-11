import type { AgentSkill } from '../types.js';

/**
 * Period-over-period reasoning. Verified against the tools 2026-08-12: only ONE of them carries a
 * built-in comparison, and the identity-matching trap that makes a working rep look idle is real,
 * confirmed in `warehouse_gallons.ts`, and locked in by its own unit tests.
 */
export const SALES_PROGRESS_SKILL: AgentSkill = {
  name: 'sales-progress',
  whenToUse:
    'When the rep asks how they are doing, whether they are ahead or behind, or asks for any ' +
    'comparison — this cycle vs last, this week vs last week, trend, or pace.',
  body: `# Comparing performance

"Am I ahead or behind?" is the most common coaching question a rep asks, and answering it well is
mostly about not comparing two things that are not comparable.

## Which tool, and what it can actually compare

- \`agent.sales_snapshot\` — portfolio health, and **the only tool with a built-in comparison**:
  gallons / swipes / new cards for **this week, last week and today**, with trend fields. If the
  question is week-over-week, this is the answer in one call.
- \`agent.activity\` — the funnel: calls, notes, leads, applications, tasks, meetings, deal value,
  conversion. It returns **one window only**. There is no previous-period field, so a
  week-vs-week activity comparison means **two calls with different ranges**, which you then compare
  yourself.
- \`warehouse.my_gallons\` — a single current value for \`today\`, \`this_week\` (ISO, Monday start) or
  \`this_month\` (calendar). **No previous-period arm, no date range.** It cannot compare anything on
  its own.
- \`dbt_mcp.recall_similar_queries\` then \`dbt_mcp.query\` — company-wide or cross-rep warehouse
  questions. Never invent SQL; recall a proven query first.

Pick one on the first try and do not call a second data tool to double-check a number the first
returned. If two sources genuinely disagree, report both and name them — do not silently choose.

## The three traps

**1. Part-period versus whole-period.** The most damaging error. Twelve days of a cycle against a
complete previous cycle makes a rep who is exactly on pace look 40% down. Either compare the same
number of elapsed days, or state the pace explicitly: *"18 of 31 days in, at 58% of last cycle's
total — level."*

**2. Calendar versus cycle.** These tools report calendar weeks and months; the rep means the 26→25
cycle, and their dashboard is cycle-framed. Read the \`sales-cycle\` skill. Name the period you
measured, every time.

**3. A zero that is not a zero — verified, and the most dangerous.**
\`warehouse.my_gallons\` matches a rep to warehouse rows by **Zoho user id suffix only**. There is no
display-name fallback in that tool. If the id does not line up with the warehouse's
\`agent_zoho_user_id\`, the join simply returns **no rows** — which is indistinguishable from a rep
who sold nothing. It fails silently, not loudly.

Note that different tools identify the rep differently: \`agent.sales_snapshot\` and \`agent.debtors\`
are keyed by the caller's **display name**, while \`agent.activity\` and \`warehouse.my_gallons\` are
keyed by **Zoho id**. So one can succeed while another returns empty for the same person.

So, before reporting a zero: **cross-check against a differently-keyed tool.** If
\`warehouse.my_gallons\` says 0 gallons but \`agent.sales_snapshot\` shows active clients and
transactions, you are looking at an identity mismatch, not a performance result. Report it as a data
problem and say which tool disagreed.

**Never tell a rep they did nothing this month on the strength of one empty warehouse result.**

## What a good answer contains

1. The figure, with the exact period it covers.
2. The comparison figure, with its period.
3. Direction and size of change — and whether it is like-for-like or pace-adjusted.
4. One concrete driver if the data shows it: a client that stopped fuelling, a week with no calls
   logged, new cards not yet active.

Numbers come from tool results. You may explain and compare what a tool returned; you may not
estimate, extrapolate, or compute an authoritative total yourself.`,
  usesTools: [
    'agent.sales_snapshot',
    'agent.activity',
    'warehouse.my_gallons',
    'dbt_mcp.recall_similar_queries',
    'dbt_mcp.query',
  ],
};
