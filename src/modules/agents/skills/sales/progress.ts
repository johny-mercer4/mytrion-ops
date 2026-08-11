import type { AgentSkill } from '../types.js';

/**
 * Period-over-period reasoning. The arithmetic here is trivial; the traps are not, and every one of
 * them produces a number that looks plausible and is wrong.
 */
export const SALES_PROGRESS_SKILL: AgentSkill = {
  name: 'sales-progress',
  whenToUse:
    'When the rep asks how they are doing, whether they are ahead or behind, or asks for any ' +
    'comparison — this cycle vs last, this week vs last week, trend, or pace.',
  body: `# Comparing performance

"Am I ahead or behind?" is the most common coaching question a rep asks. Answering it well is mostly
about not comparing two things that are not comparable.

## Pick ONE tool on the first try

- **The rep's own portfolio health** — active / inactive / stuck client counts, this-week-vs-last-week
  transactions, gallons, new cards → \`agent.sales_snapshot\`.
- **The rep's own activity funnel** — calls, notes, leads, applications, tasks, meetings, deal value,
  conversion → \`agent.activity\`.
- **The rep's own gallons / swipes** — today / this_week / this_month → \`warehouse.my_gallons\`,
  resolved from the caller's Zoho session. Never ask the rep for their name or id, and never report
  another rep's totals.
- **Company-wide or org-level warehouse questions** → \`dbt_mcp.recall_similar_queries\` first, then
  adapt and run \`dbt_mcp.query\`. The warehouse is reached only through dbt MCP — never invent SQL.

Do not call a second data tool to double-check a number the first already returned. If two tools
disagree, say so and name both sources rather than silently picking one.

## The three traps

**1. Part-period versus whole-period.** The single most damaging error. Comparing 12 days of the
current cycle against a complete previous cycle makes a rep on pace look 40% down. Either compare
like for like — the same number of elapsed days in each period — or state the pace explicitly:
*"18 of 31 days in, at 58% of last cycle's total, which is level."*

**2. Calendar period versus cycle.** These tools report calendar weeks and months. The rep means the
26→25 cycle. Read the \`sales-cycle\` skill; name the period you actually measured in your answer.

**3. A zero that is not a zero.** If a by-agent warehouse figure comes back as 0 for everything,
treat it as a lookup failure, not a performance result. Warehouse rows are matched to a rep by
identity, and an identity mismatch returns an empty set rather than an error — which reads exactly
like a rep who sold nothing. Before reporting a zero: sanity-check it against a second signal (does
\`agent.sales_snapshot\` also show no activity? do they have active clients at all?). If the signals
disagree, report a data problem, not a zero. **Never tell a rep they did nothing this month on the
strength of one empty warehouse result.**

## What a good answer contains

1. The figure, with the exact period it covers.
2. The comparison figure, with its period.
3. The direction and size of the change — and whether it is like-for-like or pace-adjusted.
4. One concrete thing driving it if the data shows it — a client that stopped fuelling, a week with
   no calls logged, new cards not yet active.

Numbers must come from a tool result. You may explain and compare returned numbers; you may not
estimate, extrapolate, or compute an authoritative total yourself.`,
  usesTools: [
    'agent.sales_snapshot',
    'agent.activity',
    'warehouse.my_gallons',
    'dbt_mcp.recall_similar_queries',
    'dbt_mcp.query',
  ],
};
