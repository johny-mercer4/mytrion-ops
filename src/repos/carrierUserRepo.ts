import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { carrierUsers, type CarrierUser, type NewCarrierUser } from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation, normalizePagination } from './util.js';

/** Flat DTO for the admin UI — NEVER includes passwordHash. */
export interface CarrierUserDto {
  id: string;
  carrierId: string;
  applicationId: string | null;
  login: string;
  agentName: string | null;
  agentZohoUserId: string | null;
  profile: string | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCarrierUserInput {
  carrierId: string;
  applicationId?: string | undefined;
  login: string;
  passwordHash: string;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  profile?: string | undefined;
}

export interface UpdateCarrierUserInput {
  carrierId?: string | undefined;
  applicationId?: string | null | undefined;
  passwordHash?: string | undefined;
  agentName?: string | null | undefined;
  agentZohoUserId?: string | null | undefined;
  profile?: string | null | undefined;
  status?: 'active' | 'disabled' | undefined;
}

export function toCarrierUserDto(row: CarrierUser): CarrierUserDto {
  return {
    id: row.id,
    carrierId: row.carrierId,
    applicationId: row.applicationId,
    login: row.login,
    agentName: row.agentName,
    agentZohoUserId: row.agentZohoUserId,
    profile: row.profile,
    status: row.status,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const carrierUserRepo = {
  async list(
    ctx: TenantContext,
    opts: { limit?: number; offset?: number; carrierId?: string } = {},
  ): Promise<{ users: CarrierUserDto[]; total: number }> {
    const { limit, offset } = normalizePagination(opts);
    const where = opts.carrierId
      ? and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.carrierId, opts.carrierId))
      : eq(carrierUsers.tenantId, ctx.tenantId);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(carrierUsers)
        .where(where)
        .orderBy(desc(carrierUsers.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(carrierUsers).where(where),
    ]);
    return { users: rows.map(toCarrierUserDto), total: counts[0]?.count ?? 0 };
  },

  async findById(ctx: TenantContext, id: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(and(eq(carrierUsers.id, id), eq(carrierUsers.tenantId, ctx.tenantId)))
      .limit(1);
    return rows[0];
  },

  /** Tenant-id-keyed lookup for the auth path (token refresh has claims, not a full ctx). */
  async findByIdAny(tenantId: string, id: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(and(eq(carrierUsers.id, id), eq(carrierUsers.tenantId, tenantId)))
      .limit(1);
    return rows[0];
  },

  /** Auth lookup by login (lowercased) WITHIN a tenant — includes passwordHash; auth-path only. */
  async findByLoginForAuth(tenantId: string, login: string): Promise<CarrierUser | undefined> {
    const rows = await db
      .select()
      .from(carrierUsers)
      .where(
        and(eq(carrierUsers.tenantId, tenantId), eq(carrierUsers.login, login.trim().toLowerCase())),
      )
      .limit(1);
    return rows[0];
  },

  async create(ctx: TenantContext, input: CreateCarrierUserInput): Promise<CarrierUserDto> {
    const values: NewCarrierUser = {
      tenantId: ctx.tenantId,
      carrierId: input.carrierId.trim(),
      applicationId: input.applicationId?.trim() || null,
      login: input.login.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      agentName: input.agentName?.trim() || null,
      agentZohoUserId: input.agentZohoUserId?.trim() || null,
      profile: input.profile?.trim() || null,
    };
    try {
      const rows = await db.insert(carrierUsers).values(values).returning();
      return toCarrierUserDto(firstOrThrow(rows, 'Failed to insert carrier user'));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`A carrier user with login '${values.login}' already exists`);
      }
      throw err;
    }
  },

  /** Patch provided fields (tenant-scoped). Returns null when no such id for this tenant. */
  async update(
    ctx: TenantContext,
    id: string,
    patch: UpdateCarrierUserInput,
  ): Promise<CarrierUserDto | null> {
    const set: Partial<NewCarrierUser> = { updatedAt: new Date() };
    if (patch.carrierId !== undefined) set.carrierId = patch.carrierId.trim();
    if (patch.applicationId !== undefined) set.applicationId = patch.applicationId?.trim() || null;
    if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
    if (patch.agentName !== undefined) set.agentName = patch.agentName?.trim() || null;
    if (patch.agentZohoUserId !== undefined) {
      set.agentZohoUserId = patch.agentZohoUserId?.trim() || null;
    }
    if (patch.profile !== undefined) set.profile = patch.profile?.trim() || null;
    if (patch.status !== undefined) set.status = patch.status;
    const rows = await db
      .update(carrierUsers)
      .set(set)
      .where(and(eq(carrierUsers.id, id), eq(carrierUsers.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    return row ? toCarrierUserDto(row) : null;
  },

  /** Delete one (tenant-scoped). Returns true when a row was removed. */
  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(carrierUsers)
      .where(and(eq(carrierUsers.id, id), eq(carrierUsers.tenantId, ctx.tenantId)))
      .returning({ id: carrierUsers.id });
    return rows.length > 0;
  },

  async updateLastLogin(id: string): Promise<void> {
    await db.update(carrierUsers).set({ lastLoginAt: new Date() }).where(eq(carrierUsers.id, id));
  },
};
