import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  miniAppPasswordResets,
  type MiniAppPasswordReset,
  type NewMiniAppPasswordReset,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CreatePasswordResetInput {
  carrierUserId: string;
  registrationId?: string | null;
  carrierId?: string | null;
  companyName?: string | null;
  login: string;
  profile: 'owner' | 'manager' | 'driver';
  agentZohoUserId?: string | null;
  agentName?: string | null;
  note?: string | null;
}

export interface PasswordResetDto {
  id: string;
  carrierUserId: string;
  registrationId: string | null;
  carrierId: string | null;
  companyName: string | null;
  login: string;
  profile: 'owner' | 'manager' | 'driver';
  agentZohoUserId: string | null;
  agentName: string | null;
  status: 'pending' | 'resolved' | 'cancelled';
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

function toDto(row: MiniAppPasswordReset): PasswordResetDto {
  return {
    id: row.id,
    carrierUserId: row.carrierUserId,
    registrationId: row.registrationId,
    carrierId: row.carrierId,
    companyName: row.companyName,
    login: row.login,
    profile: row.profile,
    agentZohoUserId: row.agentZohoUserId,
    agentName: row.agentName,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export const miniAppPasswordResetRepo = {
  async create(ctx: TenantContext, input: CreatePasswordResetInput): Promise<PasswordResetDto> {
    const values: NewMiniAppPasswordReset = {
      tenantId: ctx.tenantId,
      carrierUserId: input.carrierUserId,
      registrationId: input.registrationId ?? null,
      carrierId: input.carrierId ?? null,
      companyName: input.companyName ?? null,
      login: input.login,
      profile: input.profile,
      agentZohoUserId: input.agentZohoUserId ?? null,
      agentName: input.agentName ?? null,
      note: input.note ?? null,
    };
    const rows = await db.insert(miniAppPasswordResets).values(values).returning();
    return toDto(firstOrThrow(rows, 'mini_app_password_resets insert returned no row'));
  },

  async findPendingByCarrierUser(
    ctx: TenantContext,
    carrierUserId: string,
  ): Promise<PasswordResetDto | undefined> {
    const rows = await db
      .select()
      .from(miniAppPasswordResets)
      .where(
        and(
          eq(miniAppPasswordResets.tenantId, ctx.tenantId),
          eq(miniAppPasswordResets.carrierUserId, carrierUserId),
          eq(miniAppPasswordResets.status, 'pending'),
        ),
      )
      .orderBy(desc(miniAppPasswordResets.createdAt))
      .limit(1);
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  async listPendingForAgent(ctx: TenantContext, agentZohoUserId: string): Promise<PasswordResetDto[]> {
    const rows = await db
      .select()
      .from(miniAppPasswordResets)
      .where(
        and(
          eq(miniAppPasswordResets.tenantId, ctx.tenantId),
          eq(miniAppPasswordResets.agentZohoUserId, agentZohoUserId),
          eq(miniAppPasswordResets.status, 'pending'),
        ),
      )
      .orderBy(desc(miniAppPasswordResets.createdAt));
    return rows.map(toDto);
  },

  async listPendingForCarrier(ctx: TenantContext, carrierId: string): Promise<PasswordResetDto[]> {
    const rows = await db
      .select()
      .from(miniAppPasswordResets)
      .where(
        and(
          eq(miniAppPasswordResets.tenantId, ctx.tenantId),
          eq(miniAppPasswordResets.carrierId, carrierId),
          eq(miniAppPasswordResets.status, 'pending'),
        ),
      )
      .orderBy(desc(miniAppPasswordResets.createdAt));
    return rows.map(toDto);
  },

  /** Tenant-wide pending queue — admin Carrier User Management. */
  async listPending(ctx: TenantContext): Promise<PasswordResetDto[]> {
    const rows = await db
      .select()
      .from(miniAppPasswordResets)
      .where(
        and(eq(miniAppPasswordResets.tenantId, ctx.tenantId), eq(miniAppPasswordResets.status, 'pending')),
      )
      .orderBy(desc(miniAppPasswordResets.createdAt));
    return rows.map(toDto);
  },

  async findById(ctx: TenantContext, id: string): Promise<MiniAppPasswordReset | undefined> {
    const rows = await db
      .select()
      .from(miniAppPasswordResets)
      .where(and(eq(miniAppPasswordResets.tenantId, ctx.tenantId), eq(miniAppPasswordResets.id, id)))
      .limit(1);
    return rows[0];
  },

  async resolve(
    ctx: TenantContext,
    id: string,
    resolvedByZohoUserId: string,
  ): Promise<PasswordResetDto | undefined> {
    const rows = await db
      .update(miniAppPasswordResets)
      .set({
        status: 'resolved',
        resolvedByZohoUserId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(miniAppPasswordResets.tenantId, ctx.tenantId),
          eq(miniAppPasswordResets.id, id),
          eq(miniAppPasswordResets.status, 'pending'),
        ),
      )
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },
};
