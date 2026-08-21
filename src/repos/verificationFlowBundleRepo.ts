/**
 * One-round-trip reads for the verification desk.
 *
 * WHY THIS EXISTS. The app database is Render Postgres in Oregon: a warm round trip is ~300ms and
 * a cold one pays a ~1.8s TLS handshake, and `idle_timeout` is 20s — so a desk opened after any
 * pause finds every connection cold. The case detail was assembled from nine queries and the queue
 * from four; `Promise.all` does not help when each parallel query opens its own socket, it hurts,
 * because the handshakes contend. Measured: nine parallel `select 1` took LONGER than nine
 * sequential ones.
 *
 * So the fix is not pool tuning, it is arithmetic — send one statement instead of nine. Both reads
 * below are a single CTE that returns one JSON row, which is why the desk went from ~4s to ~0.4s.
 *
 * Tenant scoping is unchanged: every CTE carries its own `tenant_id = $1`, so a case id guessed
 * from another tenant returns nothing from every branch, not just the first.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { TenantContext } from '../types/tenantContext.js';
import { VERIFICATION_FLOW_LIST_COLUMN_SQL } from './verificationFlowRepo.js';

export interface DeskBundle {
  case: Record<string, unknown> | null;
  phases: Record<string, unknown>[];
  principals: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  events: Record<string, unknown>[];
  hits: Record<string, unknown>[];
  credit: Record<string, unknown> | null;
  banking: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
}

export interface QueueBundle {
  items: Record<string, unknown>[];
  total: number;
  aggregates: {
    total: number;
    awaitingSales: number;
    workable: number;
    pendingDocs: number;
    managerReview: number;
    closed: number;
  };
}

/** `to_jsonb(t)` keeps snake_case; the service maps once rather than naming 80 columns twice. */
function camel<T extends Record<string, unknown>>(row: Record<string, unknown> | null): T | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

function camelAll<T extends Record<string, unknown>>(rows: unknown): T[] {
  return Array.isArray(rows) ? rows.map((r) => camel<T>(r as Record<string, unknown>) as T) : [];
}

export const verificationFlowBundleRepo = {
  /**
   * The entire case workspace in ONE statement: the case, its ten phase rows, principals,
   * documents, timeline, screening hits, all three reviews and the tenant policy.
   */
  async deskDetail(ctx: TenantContext, caseId: string): Promise<DeskBundle | null> {
    const rows = await db.execute<{ bundle: Record<string, unknown> }>(sql`
      with c as (
        select * from verification_cases
        where tenant_id = ${ctx.tenantId} and id = ${caseId}
      )
      select jsonb_build_object(
        'case',       (select to_jsonb(c) from c),
        'phases',     coalesce((select jsonb_agg(to_jsonb(p) order by p.phase_code)
                                from verification_case_phases p
                                where p.tenant_id = ${ctx.tenantId} and p.case_id = ${caseId}), '[]'::jsonb),
        'principals', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.created_at)
                                from verification_case_principals pr
                                where pr.tenant_id = ${ctx.tenantId} and pr.case_id = ${caseId}), '[]'::jsonb),
        'documents',  coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
                                from verification_case_documents d
                                where d.tenant_id = ${ctx.tenantId} and d.case_id = ${caseId}), '[]'::jsonb),
        'events',     coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc)
                                from (select * from verification_case_events
                                      where tenant_id = ${ctx.tenantId} and case_id = ${caseId}
                                      order by occurred_at desc limit 100) e), '[]'::jsonb),
        'hits',       coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at)
                                from verification_screening_hits h
                                where h.tenant_id = ${ctx.tenantId} and h.case_id = ${caseId}), '[]'::jsonb),
        'credit',     (select to_jsonb(cr) from verification_credit_reviews cr
                       where cr.tenant_id = ${ctx.tenantId} and cr.case_id = ${caseId}),
        'banking',    (select to_jsonb(b) from verification_banking_reviews b
                       where b.tenant_id = ${ctx.tenantId} and b.case_id = ${caseId}),
        'risk',       (select to_jsonb(r) from verification_risk_assessments r
                       where r.tenant_id = ${ctx.tenantId} and r.case_id = ${caseId}),
        'policy',     (select to_jsonb(pol) from verification_policy pol
                       where pol.tenant_id = ${ctx.tenantId})
      ) as bundle
    `);

    const bundle = (rows as unknown as Array<{ bundle: Record<string, unknown> }>)[0]?.bundle;
    if (!bundle || bundle.case === null) return null;

    return {
      case: camel(bundle.case as Record<string, unknown>),
      phases: camelAll(bundle.phases),
      principals: camelAll(bundle.principals),
      documents: camelAll(bundle.documents),
      events: camelAll(bundle.events),
      hits: camelAll(bundle.hits),
      credit: camel(bundle.credit as Record<string, unknown> | null),
      banking: camel(bundle.banking as Record<string, unknown> | null),
      risk: camel(bundle.risk as Record<string, unknown> | null),
      policy: camel(bundle.policy as Record<string, unknown> | null),
    };
  },

  /**
   * The queue page in ONE statement: the rows, the filtered total, and the six desk counters.
   *
   * The counters are deliberately UNFILTERED — they describe the whole desk, so the chips can show
   * "3 waiting on Sales" while the current filter shows none.
   */
  async queue(
    ctx: TenantContext,
    where: ReturnType<typeof sql>,
    limit: number,
    offset: number,
  ): Promise<QueueBundle> {
    const rows = await db.execute<{ bundle: Record<string, unknown> }>(sql`
      with filtered as (
        select ${VERIFICATION_FLOW_LIST_COLUMN_SQL}
        from verification_cases
        where ${where}
        -- Opened newest first. jsonb_agg below repeats the order — a CTE ORDER BY alone
        -- only picks the page; aggregation would otherwise scramble it.
        order by created_at desc
        limit ${limit} offset ${offset}
      ),
      counted as (
        select count(*)::int n from verification_cases where ${where}
      ),
      agg as (
        select
          count(*)::int total,
          count(*) filter (where verification_process = false)::int awaiting_sales,
          count(*) filter (where verification_process = true and closed_at is null)::int workable,
          count(*) filter (where status_code = 'pending_docs')::int pending_docs,
          count(*) filter (where status_code = 'manager_review')::int manager_review,
          count(*) filter (where closed_at is not null)::int closed
        from verification_cases where tenant_id = ${ctx.tenantId}
      )
      select jsonb_build_object(
        'items',      coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from filtered f), '[]'::jsonb),
        'total',      (select n from counted),
        'aggregates', (select to_jsonb(a) from agg a)
      ) as bundle
    `);

    const bundle = (rows as unknown as Array<{ bundle: Record<string, unknown> }>)[0]?.bundle;
    const agg = camel<QueueBundle['aggregates']>(
      (bundle?.aggregates ?? null) as Record<string, unknown> | null,
    );
    return {
      items: camelAll(bundle?.items),
      total: Number(bundle?.total) || 0,
      aggregates: agg ?? {
        total: 0,
        awaitingSales: 0,
        workable: 0,
        pendingDocs: 0,
        managerReview: 0,
        closed: 0,
      },
    };
  },
};
