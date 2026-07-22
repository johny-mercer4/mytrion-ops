import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionProfileDefaults,
  type MytrionProfileDefault,
  type NewMytrionProfileDefault,
} from '../db/schema/index.js';
import { profileKeyOf, toMytrionIds, type MytrionId } from '../lib/mytrions.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface MytrionProfileDefaultDto {
  id: string;
  profileName: string;
  profileKey: string;
  allowedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProfileDefaultInput {
  profileName: string;
  allowedMytrions: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean;
  active?: boolean;
}

function toDto(row: MytrionProfileDefault): MytrionProfileDefaultDto {
  return {
    id: row.id,
    profileName: row.profileName,
    profileKey: row.profileKey,
    allowedMytrions: toMytrionIds(row.allowedMytrions),
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mytrionProfileDefaultsRepo = {
  /** Every profile default for the tenant, by profile name. */
  async list(ctx: TenantContext): Promise<MytrionProfileDefaultDto[]> {
    const rows = await db
      .select()
      .from(mytrionProfileDefaults)
      .where(eq(mytrionProfileDefaults.tenantId, ctx.tenantId))
      .orderBy(asc(mytrionProfileDefaults.profileName));
    return rows.map(toDto);
  },

  /** One profile default by its match key (trim+lowercase of the profile name). */
  async findByKey(ctx: TenantContext, profileKey: string): Promise<MytrionProfileDefaultDto | undefined> {
    const rows = await db
      .select()
      .from(mytrionProfileDefaults)
      .where(
        and(
          eq(mytrionProfileDefaults.tenantId, ctx.tenantId),
          eq(mytrionProfileDefaults.profileKey, profileKey),
        ),
      )
      .limit(1);
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Insert or update the default for a profile (keyed on (tenant, profileKey)). */
  async upsert(ctx: TenantContext, input: UpsertProfileDefaultInput): Promise<MytrionProfileDefaultDto> {
    const profileName = input.profileName.trim();
    const profileKey = profileKeyOf(profileName);
    const allowedMytrions = toMytrionIds(input.allowedMytrions);
    const homeMytrion = input.homeMytrion ?? null;
    const allDepartmentAccess = input.allDepartmentAccess ?? false;
    const active = input.active ?? true;
    const values: NewMytrionProfileDefault = {
      tenantId: ctx.tenantId,
      profileName,
      profileKey,
      allowedMytrions,
      homeMytrion,
      allDepartmentAccess,
      active,
    };
    const rows = await db
      .insert(mytrionProfileDefaults)
      .values(values)
      .onConflictDoUpdate({
        target: [mytrionProfileDefaults.tenantId, mytrionProfileDefaults.profileKey],
        set: { profileName, allowedMytrions, homeMytrion, allDepartmentAccess, active, updatedAt: new Date() },
      })
      .returning();
    return toDto(firstOrThrow(rows, 'Failed to upsert profile default'));
  },
};
