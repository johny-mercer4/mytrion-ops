import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { TenantContext } from '../types/tenantContext.js';

type TaskMetrics = Record<string, number>;

function mapMetrics(row: Record<string, unknown>): TaskMetrics {
  return {
    tasks_assigned: Number(row.tasks_assigned ?? 0),
    tasks_due: Number(row.tasks_due ?? 0),
    tasks_completed: Number(row.tasks_completed ?? 0),
    tasks_completed_on_time: Number(row.tasks_completed_on_time ?? 0),
    tasks_open_end: Number(row.tasks_open_end ?? 0),
    tasks_overdue_end: Number(row.tasks_overdue_end ?? 0),
  };
}

/**
 * Reconstruct task ownership, deadline and status from append-only events. Historical rollups
 * therefore remain stable after a manager reassigns, reschedules, cancels or reopens a task.
 */
export const kpiTaskMetricsRepo = {
  async forWorkerDay(
    ctx: TenantContext,
    assigneeZohoUserId: string,
    reportingDate: string,
    timezone: string,
  ): Promise<TaskMetrics> {
    const rows = await this.forWorkersDay(
      ctx,
      [assigneeZohoUserId],
      reportingDate,
      timezone,
    );
    return rows.get(assigneeZohoUserId) ?? mapMetrics({});
  },

  async forWorkersDay(
    ctx: TenantContext,
    assigneeZohoUserIds: string[],
    reportingDate: string,
    timezone: string,
  ): Promise<Map<string, TaskMetrics>> {
    if (assigneeZohoUserIds.length === 0) return new Map();
    const rows = await db.execute(sql`
      with workers as (
        select jsonb_array_elements_text(
          ${JSON.stringify(assigneeZohoUserIds)}::jsonb
        ) as assignee_id
      ),
      bounds as (
        select
          (${reportingDate}::date::timestamp at time zone ${timezone}) as day_start,
          ((${reportingDate}::date + 1)::timestamp at time zone ${timezone}) as day_end
      ),
      task_state as (
        select
          t."id",
          coalesce(
            (
              select e."detail"->>'to'
              from "mytrion_worker_task_events" e, bounds b
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'reassigned'
                and e."occurred_at" < b.day_end
              order by e."occurred_at" desc, e."id" desc
              limit 1
            ),
            (
              select e."detail"->>'assigneeZohoUserId'
              from "mytrion_worker_task_events" e
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'created'
              order by e."occurred_at", e."id"
              limit 1
            ),
            t."assignee_zoho_user_id"
          ) as assignee_at_end,
          case
            when exists (
              select 1
              from "mytrion_worker_task_events" e, bounds b
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'deadline_changed'
                and e."occurred_at" < b.day_end
            ) then (
              select nullif(e."detail"->>'to', '')::timestamptz
              from "mytrion_worker_task_events" e, bounds b
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'deadline_changed'
                and e."occurred_at" < b.day_end
              order by e."occurred_at" desc, e."id" desc
              limit 1
            )
            when exists (
              select 1
              from "mytrion_worker_task_events" e
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'created'
                and e."detail" ? 'deadlineAt'
            ) then (
              select nullif(e."detail"->>'deadlineAt', '')::timestamptz
              from "mytrion_worker_task_events" e
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."event_type" = 'created'
              order by e."occurred_at", e."id"
              limit 1
            )
            else t."deadline_at"
          end as deadline_at_end,
          coalesce(
            (
              select e."to_status"
              from "mytrion_worker_task_events" e, bounds b
              where e."tenant_id" = t."tenant_id"
                and e."task_id" = t."id"
                and e."to_status" is not null
                and e."occurred_at" < b.day_end
              order by e."occurred_at" desc, e."id" desc
              limit 1
            ),
            'open'
          ) as status_at_end
        from "mytrion_worker_tasks" t, bounds b
        where t."tenant_id" = ${ctx.tenantId}
          and t."created_at" < b.day_end
      ),
      assignment_counts as (
        select assignment.assignee_id, count(*)::int as tasks_assigned
        from (
          select
            case
              when e."event_type" = 'created'
                then e."detail"->>'assigneeZohoUserId'
              else e."detail"->>'to'
            end as assignee_id
          from "mytrion_worker_task_events" e, bounds b
          where e."tenant_id" = ${ctx.tenantId}
            and e."event_type" in ('created', 'reassigned')
            and e."occurred_at" >= b.day_start
            and e."occurred_at" < b.day_end
        ) assignment
        group by assignment.assignee_id
      ),
      completions as (
        select
          e."occurred_at",
          coalesce(
            (
              select r."detail"->>'to'
              from "mytrion_worker_task_events" r
              where r."tenant_id" = e."tenant_id"
                and r."task_id" = e."task_id"
                and r."event_type" = 'reassigned'
                and r."occurred_at" <= e."occurred_at"
              order by r."occurred_at" desc, r."id" desc
              limit 1
            ),
            c."detail"->>'assigneeZohoUserId',
            t."assignee_zoho_user_id"
          ) as assignee_id,
          case
            when exists (
              select 1
              from "mytrion_worker_task_events" d
              where d."tenant_id" = e."tenant_id"
                and d."task_id" = e."task_id"
                and d."event_type" = 'deadline_changed'
                and d."occurred_at" <= e."occurred_at"
            ) then (
              select nullif(d."detail"->>'to', '')::timestamptz
              from "mytrion_worker_task_events" d
              where d."tenant_id" = e."tenant_id"
                and d."task_id" = e."task_id"
                and d."event_type" = 'deadline_changed'
                and d."occurred_at" <= e."occurred_at"
              order by d."occurred_at" desc, d."id" desc
              limit 1
            )
            when c."detail" ? 'deadlineAt'
              then nullif(c."detail"->>'deadlineAt', '')::timestamptz
            else t."deadline_at"
          end as deadline_at_completion
        from "mytrion_worker_task_events" e
        join "mytrion_worker_tasks" t
          on t."tenant_id" = e."tenant_id" and t."id" = e."task_id"
        left join "mytrion_worker_task_events" c
          on c."tenant_id" = e."tenant_id"
          and c."task_id" = e."task_id"
          and c."event_type" = 'created'
        cross join bounds b
        where e."tenant_id" = ${ctx.tenantId}
          and e."event_type" = 'completed'
          and e."occurred_at" >= b.day_start
          and e."occurred_at" < b.day_end
      ),
      completion_counts as (
        select
          assignee_id,
          count(*)::int as tasks_completed,
          count(*) filter (
            where deadline_at_completion is not null
              and occurred_at <= deadline_at_completion
          )::int as tasks_completed_on_time
        from completions
        group by assignee_id
      ),
      state_counts as (
        select
          w.assignee_id,
          count(s.id) filter (
            where s.deadline_at_end is not null
              and timezone(${timezone}, s.deadline_at_end)::date = ${reportingDate}::date
          )::int as tasks_due,
          count(s.id) filter (
            where s.status_at_end in ('open', 'in_progress')
          )::int as tasks_open_end,
          count(s.id) filter (
            where s.status_at_end in ('open', 'in_progress')
              and s.deadline_at_end is not null
              and s.deadline_at_end < (select day_end from bounds)
          )::int as tasks_overdue_end
        from workers w
        left join task_state s on s.assignee_at_end = w.assignee_id
        group by w.assignee_id
      )
      select
        w.assignee_id,
        coalesce(a.tasks_assigned, 0)::int as tasks_assigned,
        coalesce(s.tasks_due, 0)::int as tasks_due,
        coalesce(c.tasks_completed, 0)::int as tasks_completed,
        coalesce(c.tasks_completed_on_time, 0)::int as tasks_completed_on_time,
        coalesce(s.tasks_open_end, 0)::int as tasks_open_end,
        coalesce(s.tasks_overdue_end, 0)::int as tasks_overdue_end
      from workers w
      left join assignment_counts a on a.assignee_id = w.assignee_id
      left join completion_counts c on c.assignee_id = w.assignee_id
      left join state_counts s on s.assignee_id = w.assignee_id
    `);
    return new Map(rows.map((row) => [
      String(row.assignee_id),
      mapMetrics(row),
    ]));
  },
};
