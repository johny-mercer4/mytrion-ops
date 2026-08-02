import { and, desc, eq, exists, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionThreadMembers,
  mytrionThreads,
  type CommsThreadKind,
  type MytrionThread,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The comms read gate — Mytrion-agnostic on purpose.
 *
 * Nothing in this module knows about Sales, Customer Service or any other Mytrion: a thread is
 * scoped by who participates in it and which department owns its queue. That is what lets the same
 * ticket/chat surface be mounted in every Mytrion without a per-Mytrion branch anywhere.
 *
 * The SAME filter serves REST and the WebSocket subscribe check, so the socket and the API can never
 * disagree about who may read a thread.
 */

/** The bare Zoho user id for a worker session, or null for a customer/system identity. */
export function actorZohoUserIdOf(ctx: TenantContext): string | null {
  if (ctx.audience !== 'internal' || !ctx.userId.startsWith('zoho:')) return null;
  const id = ctx.userId.slice('zoho:'.length);
  return id.length > 0 ? id : null;
}

function hasBlanketAccess(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
}

/**
 * Fail closed when a composed filter comes back undefined.
 *
 * `and()` / `or()` are typed `SQL | undefined`, and an undefined WHERE is not a narrow filter — it is
 * NO filter, i.e. every row in the table. A non-null assertion would silence the type without
 * ruling that out, so this throws instead: an internal error is recoverable, a silent cross-tenant
 * read is not.
 */
function requireFilter(filter: SQL | undefined): SQL {
  if (filter === undefined) {
    throw new Error(
      'comms reader filter composed to undefined — refusing to run an unfiltered read',
    );
  }
  return filter;
}

/**
 * Read RBAC for threads. Exported for offline SQL assertions in the RBAC-leakage suite (the
 * `fileVisibilityFilter` pattern), which is how rule 9 is proved without a database.
 *
 * Two arms for an ordinary worker:
 *   - PARTICIPANT: they hold a member row. This is what makes "I see the tickets and escalations I
 *     raised" true — the creator is a member, and another agent in the same Mytrion who is not a
 *     member sees nothing, because raising a ticket does not put it in their peers' view.
 *   - DEPARTMENT: the thread's queue is a department they hold. This is what lets Customer Service
 *     work the whole inbound queue while Sales sees only its own threads.
 *
 * DMs deliberately break the house "admins see everything" rule: a blanket-access caller gets the
 * whole tenant EXCEPT direct messages, plus their own DMs via the participant arm. Internal 1:1 chat
 * is the one dataset where an admin bypass is an HR exposure and resolves no ticket.
 */
export function commsThreadReaderFilter(ctx: TenantContext): SQL {
  const actor = actorZohoUserIdOf(ctx);
  const tenant = eq(mytrionThreads.tenantId, ctx.tenantId);

  // Correlated EXISTS rather than a join, so the arm composes under OR without duplicating rows.
  const participantArm = actor
    ? exists(
        db
          .select({ one: sql`1` })
          .from(mytrionThreadMembers)
          .where(
            and(
              eq(mytrionThreadMembers.tenantId, mytrionThreads.tenantId),
              eq(mytrionThreadMembers.threadId, mytrionThreads.id),
              eq(mytrionThreadMembers.memberKind, 'worker'),
              eq(mytrionThreadMembers.memberKey, actor),
              ne(mytrionThreadMembers.state, 'left'),
            ),
          ),
      )
    : sql`false`;

  if (hasBlanketAccess(ctx)) {
    // `or(...)` and not a bare `ne`: an admin must still see their OWN direct messages.
    return requireFilter(and(tenant, or(ne(mytrionThreads.kind, 'dm'), participantArm)));
  }

  // An empty department grant must collapse this arm to FALSE, never to "no filter" — that inversion
  // is the classic all-rows leak, and it is why the empty case is handled explicitly here.
  const departmentArm =
    ctx.departments.length === 0
      ? sql`false`
      : and(
          eq(mytrionThreads.visibility, 'department'),
          inArray(mytrionThreads.department, ctx.departments),
        );

  return requireFilter(and(tenant, or(participantArm, departmentArm)));
}

export interface ListThreadsOptions {
  kind?: CommsThreadKind;
  department?: string;
  /** Only threads the caller participates in — "mine", as opposed to the department queue. */
  participatingOnly?: boolean;
  state?: 'open' | 'archived';
  limit?: number;
  offset?: number;
}

export const commsThreadRepo = {
  /**
   * Split from `list` so the RBAC suite can inspect `.toSQL()` without a database. Every list read
   * in the comms system goes through this, so proving this query proves them all.
   */
  buildListQuery(ctx: TenantContext, opts: ListThreadsOptions = {}) {
    const actor = actorZohoUserIdOf(ctx);
    const where: (SQL | undefined)[] = [commsThreadReaderFilter(ctx)];

    if (opts.kind) where.push(eq(mytrionThreads.kind, opts.kind));
    if (opts.department) where.push(eq(mytrionThreads.department, opts.department));
    if (opts.state) where.push(eq(mytrionThreads.state, opts.state));

    if (opts.participatingOnly) {
      // Narrowing, never widening: this is ANDed on top of the reader filter, so it can only ever
      // remove rows the caller could already see.
      where.push(
        actor
          ? exists(
              db
                .select({ one: sql`1` })
                .from(mytrionThreadMembers)
                .where(
                  and(
                    eq(mytrionThreadMembers.tenantId, mytrionThreads.tenantId),
                    eq(mytrionThreadMembers.threadId, mytrionThreads.id),
                    eq(mytrionThreadMembers.memberKind, 'worker'),
                    eq(mytrionThreadMembers.memberKey, actor),
                    ne(mytrionThreadMembers.state, 'left'),
                  ),
                ),
            )
          : sql`false`,
      );
    }

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    return db
      .select()
      .from(mytrionThreads)
      .where(and(...where))
      .orderBy(desc(mytrionThreads.lastMessageAt))
      .limit(limit)
      .offset(offset);
  },

  async list(ctx: TenantContext, opts: ListThreadsOptions = {}): Promise<MytrionThread[]> {
    return this.buildListQuery(ctx, opts);
  },

  buildFindQuery(ctx: TenantContext, threadId: string) {
    return db
      .select()
      .from(mytrionThreads)
      .where(and(eq(mytrionThreads.id, threadId), commsThreadReaderFilter(ctx)))
      .limit(1);
  },

  /**
   * Fetch a thread the caller may read, or undefined.
   *
   * Returning undefined rather than throwing is deliberate: the route 404s, which does not confirm
   * the row exists. A 403 would leak that a guessed id is real — better IDOR hygiene than the Desk
   * path's `assertTicketOwned`, which answers 403.
   */
  async getForReader(ctx: TenantContext, threadId: string): Promise<MytrionThread | undefined> {
    const [row] = await this.buildFindQuery(ctx, threadId);
    return row;
  },

  /** Authorization for a `comms:thread:<id>` WebSocket subscription — the SAME gate as REST. */
  async canReadThread(ctx: TenantContext, threadId: string): Promise<boolean> {
    return (await this.getForReader(ctx, threadId)) !== undefined;
  },
};
