import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  workerMytrionAccess,
  type NewWorkerMytrionAccess,
  type WorkerMytrionAccess,
} from '../db/schema/index.js';
import {
  toMytrionAccessModes,
  toMytrionIds,
  type MytrionAccessModes,
  type MytrionId,
} from '../lib/mytrions.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface WorkerMytrionAccessDto {
  id: string;
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profileName: string | null;
  /** null = inherit the profile default; array = explicit replacement set. */
  allowedMytrions: MytrionId[] | null;
  deniedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  /** null = inherit; true/false = explicit override. */
  allDepartmentAccess: boolean | null;
  /** Zoho user ids this worker may "View as" (targeted impersonation grant). */
  viewAsUserIds: string[];
  mytrionAccessModes: MytrionAccessModes;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkerAccessInput {
  zohoUserId: string;
  userName?: string | null;
  email?: string | null;
  profileName?: string | null;
  /** null = inherit; array = replace. */
  allowedMytrions?: MytrionId[] | null;
  deniedMytrions?: MytrionId[];
  homeMytrion?: MytrionId | null;
  /** null = inherit; boolean = explicit. */
  allDepartmentAccess?: boolean | null;
  viewAsUserIds?: string[];
  mytrionAccessModes?: MytrionAccessModes;
  active?: boolean;
}

const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

function toDto(row: WorkerMytrionAccess): WorkerMytrionAccessDto {
  return {
    id: row.id,
    zohoUserId: row.zohoUserId,
    userName: row.userName,
    email: row.email,
    profileName: row.profileName,
    allowedMytrions: row.allowedMytrions == null ? null : toMytrionIds(row.allowedMytrions),
    deniedMytrions: toMytrionIds(row.deniedMytrions),
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess,
    viewAsUserIds: Array.isArray(row.viewAsUserIds) ? row.viewAsUserIds : [],
    mytrionAccessModes: toMytrionAccessModes(row.mytrionAccessModes),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const workerMytrionAccessRepo = {
  /** Every override for the tenant (admin list view). */
  async list(ctx: TenantContext): Promise<WorkerMytrionAccessDto[]> {
    const rows = await db
      .select()
      .from(workerMytrionAccess)
      .where(eq(workerMytrionAccess.tenantId, ctx.tenantId))
      .orderBy(asc(workerMytrionAccess.userName));
    return rows.map(toDto);
  },

  /** The override for a single Zoho user (tenant-isolated). */
  async findByZohoUserId(ctx: TenantContext, zohoUserId: string): Promise<WorkerMytrionAccessDto | undefined> {
    const rows = await db
      .select()
      .from(workerMytrionAccess)
      .where(
        and(
          eq(workerMytrionAccess.tenantId, ctx.tenantId),
          eq(workerMytrionAccess.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Insert or update a user's override (keyed on (tenant, zohoUserId)). */
  async upsert(ctx: TenantContext, input: UpsertWorkerAccessInput): Promise<WorkerMytrionAccessDto> {
    const zohoUserId = input.zohoUserId.trim();
    const userName = trimOrNull(input.userName);
    const email = trimOrNull(input.email);
    const profileName = trimOrNull(input.profileName);
    const allowedMytrions = input.allowedMytrions == null ? null : toMytrionIds(input.allowedMytrions);
    const deniedMytrions = toMytrionIds(input.deniedMytrions ?? []);
    const homeMytrion = input.homeMytrion ?? null;
    const allDepartmentAccess = input.allDepartmentAccess === undefined ? null : input.allDepartmentAccess;
    const viewAsUserIds = (input.viewAsUserIds ?? []).map((s) => s.trim()).filter(Boolean);
    const mytrionAccessModes = toMytrionAccessModes(input.mytrionAccessModes ?? {});
    const active = input.active ?? true;
    const values: NewWorkerMytrionAccess = {
      tenantId: ctx.tenantId,
      zohoUserId,
      userName,
      email,
      profileName,
      allowedMytrions,
      deniedMytrions,
      homeMytrion,
      allDepartmentAccess,
      viewAsUserIds,
      mytrionAccessModes,
      active,
    };
    const rows = await db
      .insert(workerMytrionAccess)
      .values(values)
      .onConflictDoUpdate({
        target: [workerMytrionAccess.tenantId, workerMytrionAccess.zohoUserId],
        set: {
          userName,
          email,
          profileName,
          allowedMytrions,
          deniedMytrions,
          homeMytrion,
          allDepartmentAccess,
          viewAsUserIds,
          mytrionAccessModes,
          active,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toDto(firstOrThrow(rows, 'Failed to upsert worker access'));
  },
};
