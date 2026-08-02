/**
 * Schema-readiness probe for native Mytrion communications.
 *
 * This reads PostgreSQL catalog metadata only; no tenant rows are selected. Keeping the query in a
 * repo preserves the repository boundary while allowing boot/readiness code to fail with a useful
 * service-unavailable response instead of a table-not-found 500.
 */
import { pg } from '../db/client.js';

export interface CommsSchemaReadiness {
  ready: boolean;
  missing: string[];
}

interface ReadinessRow {
  threads: string | null;
  messages: string | null;
  members: string | null;
  ticketTypes: string | null;
  tickets: string | null;
  departments: string | null;
  settings: string | null;
}

const REQUIRED = [
  ['threads', 'mytrion_threads'],
  ['messages', 'mytrion_thread_messages'],
  ['members', 'mytrion_thread_members'],
  ['ticketTypes', 'mytrion_ticket_types'],
  ['tickets', 'mytrion_tickets'],
  ['departments', 'mytrion_department_config'],
  ['settings', 'mytrion_comms_settings'],
] as const;

export const commsReadinessRepo = {
  async check(): Promise<CommsSchemaReadiness> {
    const [row] = await pg<ReadinessRow[]>`
      select
        to_regclass('public.mytrion_threads')::text as threads,
        to_regclass('public.mytrion_thread_messages')::text as messages,
        to_regclass('public.mytrion_thread_members')::text as members,
        to_regclass('public.mytrion_ticket_types')::text as "ticketTypes",
        to_regclass('public.mytrion_tickets')::text as tickets,
        to_regclass('public.mytrion_department_config')::text as departments,
        to_regclass('public.mytrion_comms_settings')::text as settings
    `;
    const missing = REQUIRED.filter(([field]) => !row?.[field]).map(([, table]) => table);
    return { ready: missing.length === 0, missing };
  },
};
