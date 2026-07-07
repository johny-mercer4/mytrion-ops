import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  carrierUsers,
  type CarrierProfile,
  type CarrierUser,
  type NewCarrierUser,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation, normalizePagination } from './util.js';

/** Flat DTO for the admin UI — NEVER includes passwordHash. */
export interface CarrierUserDto {
  id: string;
  profile: CarrierProfile;
  carrierId: string | null;
  applicationId: string | null;
  parentUserId: string | null;
  cardId: string | null;
  login: string;
  agentName: string | null;
  agentZohoUserId: string | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCarrierUserInput {
  profile: CarrierProfile;
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  parentUserId?: string | undefined;
  cardId?: string | undefined;
  login: string;
  passwordHash: string;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
}

export interface UpdateCarrierUserInput {
  carrierId?: string | null | undefined;
  applicationId?: string | null | undefined;
  cardId?: string | null | undefined;
  parentUserId?: string | undefined;
  passwordHash?: string | undefined;
  agentName?: string | null | undefined;
  agentZohoUserId?: string | null | undefined;
  status?: 'active' | 'disabled' | undefined;
}

export function toCarrierUserDto(row: CarrierUser): CarrierUserDto {
  return {
    id: row.id,
    profile: row.profile,
    carrierId: row.carrierId,
    applicationId: row.applicationId,
    parentUserId: row.parentUserId,
    cardId: row.cardId,
    login: row.login,
    agentName: row.agentName,
    agentZohoUserId: row.agentZohoUserId,
    status: row.status,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

export const carrierUserRepo = {
  async list(
    ctx: TenantContext,
    opts: { limit?: number; offset?: number; carrierId?: string; profile?: CarrierProfile } = {},
  ): Promise<{ users: CarrierUserDto[]; total: number }> {
    const { limit, offset } = normalizePagination(opts);
    const clauses = [eq(carrierUsers.tenantId, ctx.tenantId)];
    if (opts.carrierId) clauses.push(eq(carrierUsers.carrierId, opts.carrierId));
    if (opts.profile) clauses.push(eq(carrierUsers.profile, opts.profile));
    const where = and(...clauses);
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

  /** How many driver accounts point at this owner (delete guard). */
  async countChildren(ctx: TenantContext, parentUserId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(carrierUsers)
      .where(
        and(eq(carrierUsers.tenantId, ctx.tenantId), eq(carrierUsers.parentUserId, parentUserId)),
      );
    return rows[0]?.count ?? 0;
  },

  async create(ctx: TenantContext, input: CreateCarrierUserInput): Promise<CarrierUserDto> {
    const values: NewCarrierUser = {
      tenantId: ctx.tenantId,
      profile: input.profile,
      carrierId: trimOrNull(input.carrierId),
      applicationId: trimOrNull(input.applicationId),
      parentUserId: trimOrNull(input.parentUserId),
      cardId: trimOrNull(input.cardId),
      login: input.login.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      agentName: trimOrNull(input.agentName),
      agentZohoUserId: trimOrNull(input.agentZohoUserId),
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
    if (patch.carrierId !== undefined) set.carrierId = trimOrNull(patch.carrierId);
    if (patch.applicationId !== undefined) set.applicationId = trimOrNull(patch.applicationId);
    if (patch.cardId !== undefined) set.cardId = trimOrNull(patch.cardId);
    if (patch.parentUserId !== undefined) set.parentUserId = trimOrNull(patch.parentUserId);
    if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
    if (patch.agentName !== undefined) set.agentName = trimOrNull(patch.agentName);
    if (patch.agentZohoUserId !== undefined) set.agentZohoUserId = trimOrNull(patch.agentZohoUserId);
    if (patch.status !== undefined) set.status = patch.status;
    const rows = await db
      .update(carrierUsers)
      .set(set)
      .where(and(eq(carrierUsers.id, id), eq(carrierUsers.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    return row ? toCarrierUserDto(row) : null;
  },

  /**
   * Back-fill the carrier id for EVERY account provisioned under an application id whose
   * carrier_id is still empty — the "populate the carrier id automatically later" path
   * (called by the admin action or a future automation once the application converts).
   */
  async populateCarrierId(
    ctx: TenantContext,
    applicationId: string,
    carrierId: string,
  ): Promise<CarrierUserDto[]> {
    const rows = await db
      .update(carrierUsers)
      .set({ carrierId: carrierId.trim(), updatedAt: new Date() })
      .where(
        and(
          eq(carrierUsers.tenantId, ctx.tenantId),
          eq(carrierUsers.applicationId, applicationId.trim()),
          isNull(carrierUsers.carrierId),
        ),
      )
      .returning();
    return rows.map(toCarrierUserDto);
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
