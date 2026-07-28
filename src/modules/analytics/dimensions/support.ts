/**
 * Support dimension — Zoho Desk ticket volume, resolution and backlog (backs the Customer Service
 * dashboard). Previously CS reused the `pipeline` dimension, so it rendered the Sales funnel under
 * a different sidebar label; this reads the actual Desk data instead.
 *
 * NOT agent-scopable. Desk `assignee_id` lives in the Zoho Desk org id space (`1057080…`) while
 * CRM `zoho_users.id` is the CRM org (`6227679…`) — verified zero overlap on both the full id and
 * the last-12-digit suffix, and the DWH carries no Desk-agent roster to bridge them. So there is no
 * per-agent ticket book to leak or filter by: the block is always org-wide and says so in the
 * caption when an agent filter is requested. Do not add an agent predicate here on the assumption
 * that assignee_id is a CRM user — it silently matches nothing.
 *
 * `zoho_desk_tickets` is an SCD2 table (`is_active` / `valid_from` / `valid_to`) and carries
 * duplicate rows per ticket even among active ones (67221 rows / 64948 distinct ids), so every
 * aggregate counts `distinct t.id`.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import { dateScope, normalizeFilters, SqlParams, type AnalyticsFilters } from '../filters.js';
import { captionFor, fmtCount, num, softQuery, toTrend, type DayRow } from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';

const CREATED = 't.created_time';
const CLOSED = 't.closed_time';
/** Live SCD row, and not junk — applied to every ticket aggregate. */
const TICKET_BASE = `t.is_active and not coalesce(t.is_spam, false)`;

const STATUS_TONES: Record<string, BreakdownTone> = {
  Open: 'warn',
  Escalated: 'bad',
  'On Hold': 'amber',
  'Stream Manager Review': 'purple',
  Closed: 'good',
  'RnD Close': 'teal',
  'PowerBI Close': 'teal',
  Resolved: 'good',
  Cancelled: 'neutral',
};

const HOURS_SQL = `extract(epoch from (${CLOSED} - ${CREATED})) / 3600`;

interface KpiRow {
  this_period: unknown;
  prev_period: unknown;
  closed_period: unknown;
  avg_hours: unknown;
}

interface ChannelRow {
  channel: string | null;
  total: unknown;
  closed: unknown;
  avg_hours: unknown;
}

export async function computeSupport(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);

  const kpiP = new SqlParams();
  const kpiCreated = dateScope(CREATED, f, kpiP);
  const kpiClosed = dateScope(CLOSED, f, kpiP);

  const statusP = new SqlParams();
  const statusScope = dateScope(CREATED, f, statusP);

  const dailyP = new SqlParams();
  const dailyScope = dateScope(CREATED, f, dailyP);

  const chanP = new SqlParams();
  const chanScope = dateScope(CREATED, f, chanP);

  // Parallelism capped at 2 per round — the shared DWH pool is tiny (max ~5).
  const [kpiRows, openRows] = await Promise.all([
    softQuery<KpiRow>('support.kpis', () =>
      dwhQuery<KpiRow>(
        `select
           count(distinct t.id) filter (where ${kpiCreated.current})  as this_period,
           count(distinct t.id) filter (where ${kpiCreated.previous}) as prev_period,
           count(distinct t.id) filter (where ${kpiClosed.current})   as closed_period,
           round(avg(${HOURS_SQL}) filter (where ${kpiClosed.current})::numeric, 1) as avg_hours
         from public.zoho_desk_tickets t
         where ${TICKET_BASE}
           and ((${kpiCreated.current}) or (${kpiCreated.previous}) or (${kpiClosed.current}))`,
        kpiP.values,
      ),
    ),
    softQuery<{ open_now: unknown }>('support.openNow', () =>
      dwhQuery<{ open_now: unknown }>(
        `select count(distinct t.id) as open_now
         from public.zoho_desk_tickets t
         where ${TICKET_BASE} and t.status_type = 'Open'`,
      ),
    ),
  ]);

  const [statuses, channels] = await Promise.all([
    softQuery<{ status: string | null; ticket_count: unknown }>('support.statuses', () =>
      dwhQuery<{ status: string | null; ticket_count: unknown }>(
        `select coalesce(t.status, 'Unknown') as status, count(distinct t.id) as ticket_count
         from public.zoho_desk_tickets t
         where ${TICKET_BASE} and ${statusScope.current}
         group by 1
         order by 2 desc
         limit 8`,
        statusP.values,
      ),
    ),
    softQuery<ChannelRow>('support.channels', () =>
      dwhQuery<ChannelRow>(
        `select coalesce(t.channel, 'Other') as channel,
                count(distinct t.id) as total,
                count(distinct t.id) filter (where t.status_type = 'Closed') as closed,
                round(avg(${HOURS_SQL})::numeric, 1) as avg_hours
         from public.zoho_desk_tickets t
         where ${TICKET_BASE} and ${chanScope.current}
         group by 1
         order by 2 desc
         limit 6`,
        chanP.values,
      ),
    ),
  ]);

  const daily = await softQuery<DayRow>('support.daily', () =>
    dwhQuery<DayRow>(
      `select to_char(d.day, 'Mon DD') as day_label, coalesce(z.tickets, 0) as value
       from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
       left join (
         select ${CREATED}::date as day, count(distinct t.id) as tickets
         from public.zoho_desk_tickets t
         where ${TICKET_BASE}
           and ${CREATED}::date >= (${dailyScope.trendStart})::date
           and ${CREATED}::date <= (${dailyScope.trendEnd})::date
         group by 1
       ) z on z.day = d.day::date
       order by d.day`,
      dailyP.values,
    ),
  );

  const k = kpiRows[0];
  const created = num(k?.this_period);
  const prevCreated = num(k?.prev_period);
  const closed = num(k?.closed_period);
  const avgHours = num(k?.avg_hours);

  const kpis: KpiStat[] = [
    {
      label: 'Tickets Created',
      value: fmtCount(created),
      // More inbound tickets is not "better" — it is volume, not performance.
      delta: { prev: prevCreated, current: created, higherIsBetter: false },
    },
    { label: 'Tickets Closed', value: fmtCount(closed), hint: 'closed in this window' },
    {
      label: 'Avg Resolution',
      value: avgHours > 0 ? `${avgHours.toFixed(1)}h` : '—',
      hint: 'created → closed',
    },
    { label: 'Open Now', value: fmtCount(num(openRows[0]?.open_now)), hint: 'current backlog' },
  ];

  const breakdown: BreakdownItem[] = statuses.map((s) => ({
    label: s.status ?? 'Unknown',
    value: num(s.ticket_count),
    tone: STATUS_TONES[s.status ?? ''] ?? 'neutral',
  }));

  const leaderboard: LeaderboardRow[] = channels.map((c) => ({
    name: c.channel ?? 'Other',
    col1: num(c.total),
    col2: num(c.closed),
    col3: num(c.avg_hours) > 0 ? `${num(c.avg_hours).toFixed(1)}h` : '—',
  }));

  // Never let an org-wide figure read as one agent's book (see the file header).
  const base = 'Ticket volume, resolution time and backlog';
  const caption =
    f.agentId || f.agentName
      ? `${captionFor(base, f)} · org-wide (Desk tickets are not agent-attributable)`
      : captionFor(base, f);

  return {
    label: 'Customer Service',
    caption,
    kpis,
    trendLabel: 'Tickets / day',
    trend: toTrend(daily),
    breakdownLabel: 'Tickets by status',
    breakdown,
    leaderboardLabel: 'Channels by volume',
    leaderboardCols: ['Tickets', 'Closed', 'Avg time'],
    leaderboard,
  };
}
