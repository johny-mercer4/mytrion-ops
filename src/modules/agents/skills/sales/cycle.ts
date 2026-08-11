import type { AgentSkill } from '../types.js';

/**
 * The 26→25 cycle.
 *
 * An earlier version of this file asserted the cycle was "implemented NOWHERE in the codebase".
 * That was wrong, and the department review caught it: it is implemented three times in src/ plus
 * once in the CRM frontend. The error came from a grep whose output was truncated at 20 lines by
 * unrelated `billing_cycle` matches — the `cycle_start` hits were there and went unread.
 *
 * The real situation is more interesting than "missing", and worse for a copilot: the cycle is
 * canonical in the WAREHOUSE and on the rep's DASHBOARD, while every tool the agent can call is
 * calendar-based. So the agent and the screen the rep is looking at can disagree, and both are
 * "right".
 */
export const SALES_CYCLE_SKILL: AgentSkill = {
  name: 'sales-cycle',
  whenToUse:
    'Whenever a request involves a time period — this/last cycle, this month, month to date, ' +
    '"so far", pace, or any comparison between periods. Read this BEFORE calling a metric tool.',
  body: `# The sales cycle: 26th → 25th

Octane's sales cycle runs from the **26th of one month through the 25th of the next**. It is what a
rep means by "this month", and it is what their dashboard shows.

The rule, exactly as the warehouse states it:

    cycle_start = if day-of-month >= 26 → the 26th of THIS month
                  otherwise             → the 26th of LAST month

If today is 12 August 2026: this cycle is **26 Jul – 25 Aug**; the previous is **26 Jun – 25 Jul**.
Note the pace difference on the 12th: the calendar month is 39% elapsed, the cycle 58%. Judging
"on track" against the wrong one is wrong by a third.

## Where the cycle IS authoritative

- The warehouse KPI board and the client roster compute it in SQL (a shared \`cycle_start\` CTE).
- **The rep's Sales dashboard is already cycle-framed** — it renders "Cycle <start> → <end>" and a
  new-cards-per-cycle KPI, from figures the sales-data service returns.

So when a rep quotes a number off their dashboard, that number is a **cycle** number.

## Where it is NOT — and this is the trap

**Every metric tool you can call reports CALENDAR periods.**

- \`warehouse.my_gallons\` takes only \`today\` / \`this_week\` / \`this_month\`. \`this_month\` is the 1st
  to now. \`this_week\` is an ISO week, so it starts **Monday**. There is no date-range input and no
  previous-period arm.
- \`agent.sales_snapshot\` and \`agent.activity\` do not define periods here at all — they forward to
  the sales service. The snapshot's built-in comparison is **this week vs last week**, not cycles.
- \`crm.transactions\` is the **only** tool that takes an explicit \`from\`/\`to\`, which makes it the
  only way to measure a true cycle window per client.
- **Nothing anywhere computes a previous cycle.** Prior-calendar-month figures exist; a 26→25 window
  shifted back one month does not. A "last cycle vs this cycle" total has to be assembled, not
  fetched.

### What that means you must do

1. **Decide which period the rep means before fetching.** In sales conversation "this month" usually
   means the cycle. If the difference is material and it is ambiguous, ask — one short question
   beats a confidently wrong number.
2. **Always name the period you actually measured.** Not a caveat, a correctness requirement:
   *"1–12 Aug (calendar month, which is what this tool returns) — the cycle 26 Jul–25 Aug isn't
   directly available from it."*
3. **When a rep's dashboard disagrees with your number, the period is almost always why.** Say that
   plainly instead of implying one of you is wrong. The dashboard is cycle-framed; your tool is not.
4. **Use \`crm.transactions\` with computed cycle boundaries** when the question is per-client and a
   true cycle figure matters. That is the one place you can actually deliver one.
5. **Do not arithmetic your way from a calendar total to a cycle total.** You have a total, not a
   daily series. Fetch the right range or state the range you got.

## Computing the boundaries

Take today's date from <TurnContext>, never a remembered one, then apply the rule above. The end is
the 25th of the month after the start. Every month has a 26th, so the window always exists; short
months change the length, not the boundaries (26 Jan → 25 Feb is a valid, shorter cycle).

One subtlety worth knowing: the warehouse computes the cycle from the DATABASE server's date, while
the rep's browser computes it from **local** time. Near midnight, or for a rep in a different
timezone, the two can name different cycles for a few hours. If a rep insists the dashboard says
something different on the 25th or 26th, that is a real possibility rather than an error.

## Pace, not just totals

"Am I on track" needs three things together, and you should offer them without being asked: the
figure so far, how far through the cycle we are, and the comparable point last period. Comparing a
part-cycle against a whole one is the most common way to make a rep who is ahead believe they are
behind — see the \`sales-progress\` skill.`,
  usesTools: ['agent.sales_snapshot', 'agent.activity', 'warehouse.my_gallons', 'crm.transactions'],
};
