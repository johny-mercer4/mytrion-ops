import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { TenantContext } from '../types/tenantContext.js';
import type { MytrionUsageWindow } from '../modules/analytics/mytrionUsageDates.js';
import type {
  AiUsageDayFact,
  AuditUsageDayFact,
  AutomationUsageDayFact,
  CallUsageDayFact,
  TaskUsageDayFact,
  UsageBreakdownFact,
  UsageSourceSpan,
} from '../modules/analytics/mytrionUsageData.js';
import { MYTRION_USAGE_CALCULATION_VERSION } from '../modules/kpi/usageMetrics.js';

function count(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value ? new Date(value).toISOString() : null;
}

function actor(value: unknown): string {
  return String(value ?? '').replace(/^zoho:/i, '');
}

export function normalizeTicketBreakdownLabel(label: string): { key: string; label: string } {
  const code = /^\s*([a-z]+-\d+)\s*\|/i.exec(label)?.[1]?.toUpperCase();
  return { key: (code ?? label).toLowerCase(), label: code ?? label };
}

const EDIT_ACTIONS = [
  'sales.datacenter.lead_update',
  'sales.datacenter.deal_update',
  'sales.datacenter.lead_blueprint_transition',
  'sales.datacenter.note_create',
] as const;

const RETENTION_ACTIONS = [
  'retention.case.create',
  'retention.case.update',
  'touchpoint.retention.record_outcome',
  'touchpoint.retention.log_attempt',
  'touchpoint.retention.pool_claim',
] as const;

export const mytrionUsageFactsRepo = {
  async listAuditUsage(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<AuditUsageDayFact[]> {
    const rows = await db.execute(sql`
      select
        case when lower(user_id) like 'zoho:%' then substring(user_id from 6) else user_id end as actor_id,
        (created_at at time zone 'America/New_York')::date::text as reporting_date,
        count(*) filter (where action in ('auth.login', 'auth.zoho.login', 'mini_app.auth.login'))::int as sign_ins,
        count(*) filter (where action = 'mytrion.access' and resource_type = 'mytrion' and resource_id = 'sales')::int as workspace_sessions,
        count(*) filter (where action in (${sql.join(EDIT_ACTIONS.map((name) => sql`${name}`), sql`, `)}))::int as edits,
        count(*) filter (where action in (${sql.join(RETENTION_ACTIONS.map((name) => sql`${name}`), sql`, `)}))::int as retention_actions,
        count(*) filter (where action = 'desk.ticket.create')::int as ticket_creates,
        count(*) filter (where action = 'desk.escalation.create')::int as escalation_creates,
        max(created_at) filter (
          where action not in ('auth.login', 'auth.zoho.login', 'mini_app.auth.login')
        ) as last_at
      from audit_log
      where tenant_id = ${ctx.tenantId}
        and audience = 'internal'
        and user_id is not null
        and lower(user_id) like 'zoho:%'
        and impersonator_user_id is null
        and status = 'ok'
        and created_at >= ${window.start.toISOString()}::timestamptz
        and created_at < ${window.endExclusive.toISOString()}::timestamptz
        and (
          action in ('auth.login', 'auth.zoho.login', 'mini_app.auth.login', 'mytrion.access',
            'desk.ticket.create', 'desk.escalation.create',
            ${sql.join([...EDIT_ACTIONS, ...RETENTION_ACTIONS].map((name) => sql`${name}`), sql`, `)})
        )
      group by actor_id, reporting_date
    `);
    return rows.map((row) => ({
      actorId: actor(row.actor_id),
      date: String(row.reporting_date),
      signIns: count(row.sign_ins),
      workspaceSessions: count(row.workspace_sessions),
      edits: count(row.edits),
      retentionActions: count(row.retention_actions),
      ticketCreates: count(row.ticket_creates),
      escalationCreates: count(row.escalation_creates),
      lastAt: iso(row.last_at),
    }));
  },

  async listTicketBreakdown(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<UsageBreakdownFact[]> {
    const rows = await db.execute(sql`
      select
        case when lower(user_id) like 'zoho:%' then substring(user_id from 6) else user_id end as actor_id,
        action,
        case
          when action = 'desk.ticket.create' then coalesce(
            upper(substring(detail->>'ticketType' from '^[[:space:]]*([A-Za-z]+-[0-9]+)')),
            case detail->>'department'
              when 'cs' then 'Customer Service ticket'
              when 'billing' then 'Billing ticket'
              when 'verification' then 'Verification ticket'
              when 'maintenance' then 'Maintenance ticket'
              else 'Other ticket'
            end
          )
          else 'Escalation created'
        end as label,
        count(*)::int as event_count
      from audit_log
      where tenant_id = ${ctx.tenantId}
        and audience = 'internal'
        and user_id is not null
        and lower(user_id) like 'zoho:%'
        and impersonator_user_id is null
        and status = 'ok'
        and action in ('desk.ticket.create', 'desk.escalation.create')
        and created_at >= ${window.start.toISOString()}::timestamptz
        and created_at < ${window.endExclusive.toISOString()}::timestamptz
      group by actor_id, action, label
      order by event_count desc, label
    `);
    return rows.map((row) => {
      const kind = row.action === 'desk.ticket.create' ? 'ticket' : 'escalation';
      const rawLabel = String(row.label);
      const normalized = normalizeTicketBreakdownLabel(rawLabel);
      return {
        actorId: actor(row.actor_id),
        key: `${kind}:${normalized.key}`,
        label: normalized.label,
        count: count(row.event_count),
      };
    });
  },

  /** Calls are joined to their audited ended event so View-as calls can be excluded. */
  async listCalls(ctx: TenantContext, window: MytrionUsageWindow): Promise<CallUsageDayFact[]> {
    const rows = await db.execute(sql`
      select
        calls.caller_zoho_user_id as actor_id,
        (calls.created_at at time zone 'America/New_York')::date::text as reporting_date,
        count(distinct calls.id)::int as calls,
        coalesce(sum(calls.duration_seconds), 0)::int as talk_seconds,
        max(calls.created_at) as last_at
      from mytrion_calls calls
      where calls.tenant_id = ${ctx.tenantId}
        and calls.created_at >= ${window.start.toISOString()}::timestamptz
        and calls.created_at < ${window.endExclusive.toISOString()}::timestamptz
        and calls.session_id is not null
        and exists (
          select 1 from audit_log audit
          where audit.tenant_id = calls.tenant_id
            and audit.action = 'ringcentral.call_event'
            and audit.status = 'ok'
            and audit.audience = 'internal'
            and audit.resource_id = calls.session_id
            and lower(audit.user_id) = lower(case
              when calls.caller_zoho_user_id like 'zoho:%' then calls.caller_zoho_user_id
              else 'zoho:' || calls.caller_zoho_user_id
            end)
            and audit.impersonator_user_id is null
            and audit.detail->>'kind' = 'ended'
            and audit.detail->>'direction' = 'Outbound'
            and audit.created_at >= calls.created_at - interval '2 minutes'
            and audit.created_at <= calls.created_at + interval '5 seconds'
        )
      group by actor_id, reporting_date
    `);
    return rows.map((row) => ({
      actorId: actor(row.actor_id),
      date: String(row.reporting_date),
      calls: count(row.calls),
      talkSeconds: count(row.talk_seconds),
      lastAt: iso(row.last_at),
    }));
  },

  /** Completed task events require the matching non-impersonated status audit row. */
  async listCompletedTasks(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<TaskUsageDayFact[]> {
    const rows = await db.execute(sql`
      select
        case when lower(event.actor_user_id) like 'zoho:%' then substring(event.actor_user_id from 6) else event.actor_user_id end as actor_id,
        (event.occurred_at at time zone 'America/New_York')::date::text as reporting_date,
        count(*)::int as completed,
        max(event.occurred_at) as last_at
      from mytrion_worker_task_events event
      join mytrion_worker_tasks task
        on task.tenant_id = event.tenant_id and task.id = event.task_id
      where event.tenant_id = ${ctx.tenantId}
        and task.department = 'sales'
        and event.event_type = 'completed'
        and event.occurred_at >= ${window.start.toISOString()}::timestamptz
        and event.occurred_at < ${window.endExclusive.toISOString()}::timestamptz
        and exists (
          select 1 from audit_log audit
          where audit.tenant_id = event.tenant_id
            and audit.action = 'worker_task.status'
            and audit.status = 'ok'
            and audit.audience = 'internal'
            and audit.resource_id = event.task_id
            and audit.user_id = event.actor_user_id
            and audit.impersonator_user_id is null
            and audit.detail->>'to' = 'completed'
            and audit.created_at >= event.occurred_at
            and audit.created_at <= event.occurred_at + interval '30 seconds'
        )
      group by actor_id, reporting_date
    `);
    return rows.map((row) => ({
      actorId: actor(row.actor_id),
      date: String(row.reporting_date),
      completed: count(row.completed),
      lastAt: iso(row.last_at),
    }));
  },

  async listAutomations(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<{ days: AutomationUsageDayFact[]; breakdown: UsageBreakdownFact[]; unattributed: number }> {
    const [days, breakdown, attribution] = await Promise.all([
      db.execute(sql`
        select
          case when lower(actor_user_id) like 'zoho:%' then substring(actor_user_id from 6) else actor_user_id end as actor_id,
          (created_at at time zone 'America/New_York')::date::text as reporting_date,
          count(*) filter (where phase = 'started')::int as started,
          count(*) filter (where phase = 'succeeded')::int as succeeded,
          count(*) filter (where phase = 'failed')::int as failed,
          max(created_at) as last_at
        from automation_logs
        where tenant_id = ${ctx.tenantId}
          and source_mytrion = 'sales'
          and lower(actor_user_id) like 'zoho:%'
          and impersonator_user_id is null
          and created_at >= ${window.start.toISOString()}::timestamptz
          and created_at < ${window.endExclusive.toISOString()}::timestamptz
        group by actor_id, reporting_date
      `),
      db.execute(sql`
        select
          case when lower(actor_user_id) like 'zoho:%' then substring(actor_user_id from 6) else actor_user_id end as actor_id,
          automation_type, phase, count(*)::int as event_count
        from automation_logs
        where tenant_id = ${ctx.tenantId}
          and source_mytrion = 'sales'
          and lower(actor_user_id) like 'zoho:%'
          and impersonator_user_id is null
          and created_at >= ${window.start.toISOString()}::timestamptz
          and created_at < ${window.endExclusive.toISOString()}::timestamptz
        group by actor_id, automation_type, phase
        order by event_count desc, automation_type, phase
      `),
      db.execute(sql`
        select count(*) filter (
          where actor_user_id is null or lower(actor_user_id) not like 'zoho:%'
        )::int as unattributed
        from automation_logs
        where tenant_id = ${ctx.tenantId}
          and source_mytrion = 'sales'
          and created_at >= ${window.start.toISOString()}::timestamptz
          and created_at < ${window.endExclusive.toISOString()}::timestamptz
      `),
    ]);
    return {
      days: days.map((row) => ({
        actorId: actor(row.actor_id),
        date: String(row.reporting_date),
        started: count(row.started),
        succeeded: count(row.succeeded),
        failed: count(row.failed),
        lastAt: iso(row.last_at),
      })),
      breakdown: breakdown.map((row) => ({
        actorId: actor(row.actor_id),
        key: `${String(row.automation_type).toLowerCase()}:${String(row.phase)}`,
        label: `${String(row.automation_type)} · ${String(row.phase)}`,
        count: count(row.event_count),
      })),
      unattributed: count(attribution[0]?.unattributed),
    };
  },

  async listAiUsage(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<{ days: AiUsageDayFact[]; breakdown: UsageBreakdownFact[] }> {
    const turns = sql`
      select distinct on (audit.agent_run_id)
        audit.agent_run_id,
        case when lower(audit.user_id) like 'zoho:%' then substring(audit.user_id from 6) else audit.user_id end as actor_id,
        audit.created_at,
        run.status
      from audit_log audit
      join agent_runs run
        on run.tenant_id = audit.tenant_id and run.id = audit.agent_run_id
      where audit.tenant_id = ${ctx.tenantId}
        and audit.action = 'agent.turn'
        and audit.audience = 'internal'
        and audit.user_id is not null
        and lower(audit.user_id) like 'zoho:%'
        and audit.impersonator_user_id is null
        and audit.created_at >= ${window.start.toISOString()}::timestamptz
        and audit.created_at < ${window.endExclusive.toISOString()}::timestamptz
        and run.agent_key = 'sales'
      order by audit.agent_run_id, audit.created_at desc, audit.id desc
    `;
    const [days, turnStatus, tools] = await Promise.all([
      db.execute(sql`
        with turns as (${turns}), tool_totals as (
          select call.agent_run_id, count(*)::int as tool_calls, max(call.created_at) as last_tool_at
          from tool_calls call
          join turns on turns.agent_run_id = call.agent_run_id
          where call.tenant_id = ${ctx.tenantId}
          group by call.agent_run_id
        )
        select
          turns.actor_id,
          (turns.created_at at time zone 'America/New_York')::date::text as reporting_date,
          count(*)::int as turns,
          coalesce(sum(tool_totals.tool_calls), 0)::int as tool_calls,
          max(greatest(turns.created_at, coalesce(tool_totals.last_tool_at, turns.created_at))) as last_at
        from turns
        left join tool_totals on tool_totals.agent_run_id = turns.agent_run_id
        group by turns.actor_id, reporting_date
      `),
      db.execute(sql`
        with turns as (${turns})
        select actor_id, status, count(*)::int as event_count
        from turns group by actor_id, status
      `),
      db.execute(sql`
        with turns as (${turns})
        select turns.actor_id, call.tool_name, count(*)::int as event_count
        from tool_calls call
        join turns on turns.agent_run_id = call.agent_run_id
        where call.tenant_id = ${ctx.tenantId}
        group by turns.actor_id, call.tool_name
        order by event_count desc, call.tool_name
      `),
    ]);
    return {
      days: days.map((row) => ({
        actorId: actor(row.actor_id),
        date: String(row.reporting_date),
        turns: count(row.turns),
        toolCalls: count(row.tool_calls),
        lastAt: iso(row.last_at),
      })),
      breakdown: [
        ...turnStatus.map((row) => ({
          actorId: actor(row.actor_id),
          key: `turn:${String(row.status)}`,
          label: `AI turns · ${String(row.status)}`,
          count: count(row.event_count),
        })),
        ...tools.map((row) => ({
          actorId: actor(row.actor_id),
          key: `tool:${String(row.tool_name).toLowerCase()}`,
          label: `Tool · ${String(row.tool_name)}`,
          count: count(row.event_count),
        })),
      ],
    };
  },

  async sourceSpans(ctx: TenantContext): Promise<UsageSourceSpan[]> {
    const rows = await db.execute(sql`
      with source_events(source, start_at, end_at, covered_through) as (
        select 'authentication', created_at, created_at, now() from audit_log
          where tenant_id = ${ctx.tenantId} and audience = 'internal' and status = 'ok'
            and impersonator_user_id is null
            and lower(user_id) like 'zoho:%'
            and action in ('auth.login', 'auth.zoho.login', 'mini_app.auth.login')
        union all select 'workspace', created_at, created_at, now() from audit_log
          where tenant_id = ${ctx.tenantId} and audience = 'internal' and status = 'ok'
            and impersonator_user_id is null
            and lower(user_id) like 'zoho:%'
            and action = 'mytrion.access' and resource_type = 'mytrion' and resource_id = 'sales'
        union all select 'presence', received_at, received_at, received_at from kpi_presence_events where tenant_id = ${ctx.tenantId}
        union all select 'activity', received_at, received_at, received_at from kpi_activity_events where tenant_id = ${ctx.tenantId}
        union all select 'presence',
            rollup.reporting_date::timestamp at time zone 'America/New_York',
            substring(rollup.source_watermarks->>'usage.presence' from '^complete@(.*)$')::timestamptz,
            (rollup.reporting_date + 1)::timestamp at time zone 'America/New_York'
          from kpi_daily_rollups rollup
          where rollup.tenant_id = ${ctx.tenantId}
            and rollup.calculation_version = ${MYTRION_USAGE_CALCULATION_VERSION}
            and rollup.source_watermarks->>'usage.presence' like 'complete@%'
        union all select 'activity',
            rollup.reporting_date::timestamp at time zone 'America/New_York',
            substring(rollup.source_watermarks->>'usage.activity' from '^complete@(.*)$')::timestamptz,
            (rollup.reporting_date + 1)::timestamp at time zone 'America/New_York'
          from kpi_daily_rollups rollup
          where rollup.tenant_id = ${ctx.tenantId}
            and rollup.calculation_version = ${MYTRION_USAGE_CALCULATION_VERSION}
            and rollup.source_watermarks->>'usage.activity' like 'complete@%'
        union all select 'calls', calls.created_at, calls.created_at, now() from mytrion_calls calls
          where calls.tenant_id = ${ctx.tenantId} and calls.session_id is not null
            and exists (select 1 from audit_log audit where audit.tenant_id = calls.tenant_id
              and audit.action = 'ringcentral.call_event' and audit.status = 'ok'
              and audit.audience = 'internal' and audit.resource_id = calls.session_id
              and lower(audit.user_id) = lower(case
                when calls.caller_zoho_user_id like 'zoho:%' then calls.caller_zoho_user_id
                else 'zoho:' || calls.caller_zoho_user_id
              end)
              and audit.impersonator_user_id is null and audit.detail->>'kind' = 'ended'
              and audit.detail->>'direction' = 'Outbound'
              and audit.created_at >= calls.created_at - interval '2 minutes'
              and audit.created_at <= calls.created_at + interval '5 seconds')
        union all select 'tasks', event.occurred_at, event.occurred_at, now()
          from mytrion_worker_task_events event join mytrion_worker_tasks task
            on task.tenant_id = event.tenant_id and task.id = event.task_id
          where event.tenant_id = ${ctx.tenantId} and event.event_type = 'completed'
            and task.department = 'sales'
            and exists (select 1 from audit_log audit where audit.tenant_id = event.tenant_id
              and audit.action = 'worker_task.status' and audit.status = 'ok'
              and audit.audience = 'internal' and audit.resource_id = event.task_id
              and audit.user_id = event.actor_user_id and audit.impersonator_user_id is null
              and audit.detail->>'to' = 'completed'
              and audit.created_at >= event.occurred_at
              and audit.created_at <= event.occurred_at + interval '30 seconds')
        union all select 'edits', created_at, created_at, now() from audit_log
          where tenant_id = ${ctx.tenantId} and audience = 'internal' and status = 'ok'
            and impersonator_user_id is null
            and lower(user_id) like 'zoho:%'
            and action in (${sql.join([...EDIT_ACTIONS, ...RETENTION_ACTIONS].map((name) => sql`${name}`), sql`, `)})
        union all select 'tickets', created_at, created_at, now() from audit_log
          where tenant_id = ${ctx.tenantId} and audience = 'internal' and status = 'ok'
            and impersonator_user_id is null
            and lower(user_id) like 'zoho:%'
            and action in ('desk.ticket.create', 'desk.escalation.create')
        union all select 'automations', created_at, created_at, now() from automation_logs
          where tenant_id = ${ctx.tenantId}
            and source_mytrion = 'sales'
            and lower(actor_user_id) like 'zoho:%'
            and impersonator_user_id is null
        union all select 'ai', audit.created_at, audit.created_at, now() from audit_log audit
          join agent_runs run on run.tenant_id = audit.tenant_id and run.id = audit.agent_run_id
          where audit.tenant_id = ${ctx.tenantId} and audit.audience = 'internal'
            and audit.impersonator_user_id is null
            and lower(audit.user_id) like 'zoho:%'
            and audit.action = 'agent.turn' and run.agent_key = 'sales'
      )
      select source, min(start_at) as available_from, max(end_at) as available_through,
        max(covered_through) as covered_through
      from source_events group by source
    `);
    return rows.map((row) => ({
      source: String(row.source),
      availableFrom: iso(row.available_from),
      availableThrough: iso(row.available_through),
      coveredThrough: iso(row.covered_through),
    }));
  },
};
