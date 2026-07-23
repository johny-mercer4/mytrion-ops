import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionRoleDefaults,
  type MytrionRoleDefault,
  type NewMytrionRoleDefault,
} from '../db/schema/index.js';
import {
  roleKeyOf,
  toMytrionAccessModes,
  toMytrionIds,
  type MytrionAccessModes,
  type MytrionId,
} from '../lib/mytrions.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface MytrionRoleDefaultDto {
  id: string;
  roleName: string;
  roleKey: string;
  allowedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  mytrionAccessModes: MytrionAccessModes;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRoleDefaultInput {
  roleName: string;
  allowedMytrions: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean;
  mytrionAccessModes?: MytrionAccessModes;
  active?: boolean;
}

function toDto(row: MytrionRoleDefault): MytrionRoleDefaultDto {
  return {
    id: row.id,
    roleName: row.roleName,
    roleKey: row.roleKey,
    allowedMytrions: toMytrionIds(row.allowedMytrions),
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess,
    mytrionAccessModes: toMytrionAccessModes(row.mytrionAccessModes),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const mytrionRoleDefaultsRepo = {
  /** Every role default for the tenant, by role name. */
  async list(ctx: TenantContext): Promise<MytrionRoleDefaultDto[]> {
    const rows = await db
      .select()
      .from(mytrionRoleDefaults)
      .where(eq(mytrionRoleDefaults.tenantId, ctx.tenantId))
      .orderBy(asc(mytrionRoleDefaults.roleName));
    return rows.map(toDto);
  },

  /** One role default by its match key (trim+lowercase of the role name). */
  async findByKey(ctx: TenantContext, roleKey: string): Promise<MytrionRoleDefaultDto | undefined> {
    const rows = await db
      .select()
      .from(mytrionRoleDefaults)
      .where(
        and(eq(mytrionRoleDefaults.tenantId, ctx.tenantId), eq(mytrionRoleDefaults.roleKey, roleKey)),
      )
      .limit(1);
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Insert or update the default for a Zoho role (keyed on (tenant, roleKey)). */
  async upsert(ctx: TenantContext, input: UpsertRoleDefaultInput): Promise<MytrionRoleDefaultDto> {
    const roleName = input.roleName.trim();
    const roleKey = roleKeyOf(roleName);
    const allowedMytrions = toMytrionIds(input.allowedMytrions);
    const homeMytrion = input.homeMytrion ?? null;
    const allDepartmentAccess = input.allDepartmentAccess ?? false;
    const mytrionAccessModes = toMytrionAccessModes(input.mytrionAccessModes ?? {});
    const active = input.active ?? true;
    const values: NewMytrionRoleDefault = {
      tenantId: ctx.tenantId,
      roleName,
      roleKey,
      allowedMytrions,
      homeMytrion,
      allDepartmentAccess,
      mytrionAccessModes,
      active,
    };
    const rows = await db
      .insert(mytrionRoleDefaults)
      .values(values)
      .onConflictDoUpdate({
        target: [mytrionRoleDefaults.tenantId, mytrionRoleDefaults.roleKey],
        set: {
          roleName,
          allowedMytrions,
          homeMytrion,
          allDepartmentAccess,
          mytrionAccessModes,
          active,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toDto(firstOrThrow(rows, 'Failed to upsert role default'));
  },
};
