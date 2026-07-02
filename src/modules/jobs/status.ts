/**
 * Read-only job observability for the admin route: per-queue/state counts + recent failures,
 * straight from the pgboss schema (identifier validated by the env schema regex).
 */
import { env } from '../../config/env.js';
import { pg } from '../../db/client.js';

export interface QueueStateCount {
  name: string;
  state: string;
  count: number;
}

export interface RecentFailure {
  id: string;
  name: string;
  completedOn: string | null;
  output: unknown;
}

export async function jobCounts(): Promise<QueueStateCount[]> {
  const rows = await pg<{ name: string; state: string; count: string }[]>`
    SELECT name, state, count(*)::text AS count
    FROM ${pg(env.PGBOSS_SCHEMA)}.job
    GROUP BY name, state
    ORDER BY name, state
  `;
  return rows.map((r) => ({ name: r.name, state: r.state, count: Number(r.count) }));
}

export async function recentFailures(limit = 20): Promise<RecentFailure[]> {
  const rows = await pg<{ id: string; name: string; completed_on: Date | null; output: unknown }[]>`
    SELECT id, name, completed_on, output
    FROM ${pg(env.PGBOSS_SCHEMA)}.job
    WHERE state = 'failed'
    ORDER BY completed_on DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    completedOn: r.completed_on ? r.completed_on.toISOString() : null,
    output: r.output,
  }));
}
