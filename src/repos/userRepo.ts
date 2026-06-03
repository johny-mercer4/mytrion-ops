import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, type NewUser, type User } from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { Role } from '../types/tenantContext.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation, normalizePagination } from './util.js';

export interface UpdateUserPatch {
  fullName?: string | null;
  role?: Role;
  status?: 'active' | 'disabled';
}

export const userRepo = {
  /** Tenant-scoped lookup by id. Returns undefined if the user is in another tenant. */
  async findById(ctx: TenantContext, id: string): Promise<User | undefined> {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  /**
   * Pre-authentication lookup by email. There is no TenantContext yet, but the
   * caller MUST pass the tenant the login is scoped to (email is unique per tenant).
   */
  async findByEmailForAuth(email: string, tenantId: string): Promise<User | undefined> {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), eq(users.tenantId, tenantId)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async create(input: NewUser): Promise<User> {
    try {
      const rows = await db
        .insert(users)
        .values({ ...input, email: input.email.toLowerCase() })
        .returning();
      return firstOrThrow(rows, 'Failed to create user');
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`A user with email ${input.email} already exists in this tenant`);
      }
      throw err;
    }
  },

  async listByTenant(
    ctx: TenantContext,
    page?: { limit?: number; offset?: number },
  ): Promise<User[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(users)
      .where(eq(users.tenantId, ctx.tenantId))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countByTenant(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, ctx.tenantId));
    return firstOrUndefined(rows)?.count ?? 0;
  },

  /** Post-auth bookkeeping; scoped by id only (we already authenticated this user). */
  async updateLastLogin(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  },

  async update(ctx: TenantContext, userId: string, patch: UpdateUserPatch): Promise<User | undefined> {
    const set: Partial<NewUser> & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.fullName !== undefined) set.fullName = patch.fullName;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.status !== undefined) set.status = patch.status;
    const rows = await db
      .update(users)
      .set(set)
      .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId)))
      .returning();
    return firstOrUndefined(rows);
  },
};
