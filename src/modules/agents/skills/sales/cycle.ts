import type { AgentSkill } from '../types.js';

/**
 * The 26→25 cycle. This is domain truth from the system architect, and — verified 2026-08-12 — it
 * is implemented NOWHERE in the codebase: `billing_cycle` is an unrelated per-carrier string
 * ("Weekly"), and every metric tool reports on calendar periods.
 *
 * That gap is exactly why this skill exists. Until a tool speaks cycles, the agent is the only thing
 * standing between "how am I doing this cycle?" and a calendar-month answer that looks right and
 * is wrong.
 */
export const SALES_CYCLE_SKILL: AgentSkill = {
  name: 'sales-cycle',
  whenToUse:
    'Whenever a request involves a time period — this/last cycle, this month, month to date, ' +
    '"so far", or any comparison between periods. Read this BEFORE calling a metric tool.',
  body: `# The sales cycle: 26th → 25th

Octane's sales cycle runs from the **26th of one month to the 25th of the next**. It is the period a
rep is measured on, and it is what a rep means by "this month" in conversation.

**Current cycle** = from the most recent 26th up to today.
**Previous cycle** = the 26th before that, through the 25th.

Worked example, if today is 12 August 2026:
- this cycle → **26 Jul 2026 – 25 Aug 2026** (in progress, 18 days elapsed of 31)
- last cycle → **26 Jun 2026 – 25 Jul 2026** (complete)

Note what that means on the 12th: the calendar month is 39% done, the cycle is 58% done. Any
"are we on pace" judgement built on the wrong one is wrong.

## The trap: no tool knows about cycles

**Every metric tool available to you reports on CALENDAR periods, not cycles.**
\`agent.sales_snapshot\`, \`agent.activity\`, \`warehouse.my_gallons\` (today / this_week / this_month)
and the warehouse all treat "this month" as the 1st to today. A rep asking "how many gallons this
month?" and meaning the cycle will get a number that is silently short by the 26th–31st of the
previous month, and includes days 1–25 that belong to a different cycle.

So:

1. **Decide which the user means before you fetch anything.** In sales conversation "this month"
   usually means the cycle. If it is ambiguous and the difference is material, ask — one short
   question beats a confidently wrong number.
2. **Never label a calendar-period result as a cycle result.** If the only tool available returns a
   calendar month, say so in the answer: *"26 Jul–25 Aug isn't directly available, so this is
   1–12 Aug from the warehouse."* Naming the period you actually measured is not a caveat, it is the
   difference between a true and a false statement.
3. **When a tool accepts an explicit date range, compute the cycle boundaries and pass them.** That
   is the only way to get a true cycle figure today. \`crm.transactions\` takes a range — use it.
4. **Do not do the arithmetic to "correct" a calendar total into a cycle total.** You cannot: you
   have a total, not the daily series. Fetch the right range or state the range you got.

## Computing the boundaries

Given today's date from <TurnContext>:
- if today's day-of-month **≥ 26** → this cycle started the **26th of this month**
- if today's day-of-month **≤ 25** → this cycle started the **26th of last month**
- the cycle ends on the **25th** of the month after it started
- the previous cycle is the same window shifted back one month

Watch the short months: a cycle starting 26 January ends 25 February regardless of length, and
cycles starting the 26th always exist (no month lacks a 26th). Use the caller's date from
<TurnContext>, never a remembered one.

## Pace, not just totals

A rep asking about the current cycle is usually asking "am I on track", which needs three things,
and you should offer them together: the figure so far, how far through the cycle we are, and the
same point last cycle. Comparing a part-cycle to a whole cycle is the most common way to make a rep
think they are failing when they are ahead — see the \`sales-progress\` skill.`,
  usesTools: ['agent.sales_snapshot', 'agent.activity', 'warehouse.my_gallons', 'crm.transactions'],
};
