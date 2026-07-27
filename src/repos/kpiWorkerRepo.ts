import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiPopulationProfiles,
  kpiWorkerMemberships,
  kpiWorkers,
  type KpiWorker,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface KpiDirectoryWorker {
  zohoUserId: string;
  displayName?: string | null;
  email?: string | null;
  profileName?: string | null;
  roleName?: string | null;
  active: boolean;
}

export function normalizeKpiProfile(profileName: string): string {
  return profileName.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const kpiWorkerRepo = {
  /**
   * Backdate only the original membership created when the KPI directory was bootstrapped.
   * Any worker with a closed/prior membership is excluded so a backfill cannot rewrite known
   * profile history.
   */
  async backdateInitialMemberships(
    ctx: TenantContext,
    eligibleFrom: Date,
  ): Promise<number> {
    const eligibleFromIso = eligibleFrom.toISOString();
    const rows = await db.execute(sql`
      update kpi_worker_memberships current
      set eligible_from = ${eligibleFromIso}::timestamptz
      from kpi_workers worker
      where current.tenant_id = ${ctx.tenantId}
        and current.worker_id = worker.id
        and worker.tenant_id = ${ctx.tenantId}
        and current.eligible_to is null
        and current.eligible_from > ${eligibleFromIso}::timestamptz
        and abs(extract(epoch from (current.eligible_from - worker.first_seen_at))) < 60
        and not exists (
          select 1
          from kpi_worker_memberships historical
          where historical.tenant_id = current.tenant_id
            and historical.worker_id = current.worker_id
            and historical.id <> current.id
        )
      returning current.id
    `);
    return rows.length;
  },

  async enabledProfileNames(ctx: TenantContext): Promise<Set<string>> {
    const rows = await db
      .select({ normalizedProfileName: kpiPopulationProfiles.normalizedProfileName })
      .from(kpiPopulationProfiles)
      .where(
        and(
          eq(kpiPopulationProfiles.tenantId, ctx.tenantId),
          eq(kpiPopulationProfiles.active, true),
        ),
      );
    return new Set(rows.map((row) => row.normalizedProfileName));
  },

  async list(ctx: TenantContext, eligibleOnly = false): Promise<KpiWorker[]> {
    if (!eligibleOnly) {
      return db
        .select()
        .from(kpiWorkers)
        .where(eq(kpiWorkers.tenantId, ctx.tenantId))
        .orderBy(asc(kpiWorkers.displayName));
    }
    return db
      .select({
        id: kpiWorkers.id,
        tenantId: kpiWorkers.tenantId,
        zohoUserId: kpiWorkers.zohoUserId,
        displayName: kpiWorkers.displayName,
        email: kpiWorkers.email,
        currentProfileName: kpiWorkers.currentProfileName,
        currentRoleName: kpiWorkers.currentRoleName,
        sourceActive: kpiWorkers.sourceActive,
        firstSeenAt: kpiWorkers.firstSeenAt,
        lastSeenAt: kpiWorkers.lastSeenAt,
        createdAt: kpiWorkers.createdAt,
        updatedAt: kpiWorkers.updatedAt,
      })
      .from(kpiWorkers)
      .innerJoin(
        kpiWorkerMemberships,
        and(
          eq(kpiWorkerMemberships.tenantId, kpiWorkers.tenantId),
          eq(kpiWorkerMemberships.workerId, kpiWorkers.id),
          isNull(kpiWorkerMemberships.eligibleTo),
        ),
      )
      .where(and(eq(kpiWorkers.tenantId, ctx.tenantId), eq(kpiWorkers.sourceActive, true)))
      .orderBy(asc(kpiWorkers.displayName));
  },

  async listEligibleAt(
    ctx: TenantContext,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<KpiWorker[]> {
    return db
      .selectDistinct({
        id: kpiWorkers.id,
        tenantId: kpiWorkers.tenantId,
        zohoUserId: kpiWorkers.zohoUserId,
        displayName: kpiWorkers.displayName,
        email: kpiWorkers.email,
        currentProfileName: kpiWorkers.currentProfileName,
        currentRoleName: kpiWorkers.currentRoleName,
        sourceActive: kpiWorkers.sourceActive,
        firstSeenAt: kpiWorkers.firstSeenAt,
        lastSeenAt: kpiWorkers.lastSeenAt,
        createdAt: kpiWorkers.createdAt,
        updatedAt: kpiWorkers.updatedAt,
      })
      .from(kpiWorkers)
      .innerJoin(
        kpiWorkerMemberships,
        and(
          eq(kpiWorkerMemberships.tenantId, kpiWorkers.tenantId),
          eq(kpiWorkerMemberships.workerId, kpiWorkers.id),
          lt(kpiWorkerMemberships.eligibleFrom, periodEnd),
          or(
            isNull(kpiWorkerMemberships.eligibleTo),
            gt(kpiWorkerMemberships.eligibleTo, periodStart),
          ),
        ),
      )
      .where(eq(kpiWorkers.tenantId, ctx.tenantId))
      .orderBy(asc(kpiWorkers.displayName));
  },

  async profileForPeriod(
    ctx: TenantContext,
    workerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<string | null> {
    const rows = await db
      .select({ profileName: kpiWorkerMemberships.profileName })
      .from(kpiWorkerMemberships)
      .where(
        and(
          eq(kpiWorkerMemberships.tenantId, ctx.tenantId),
          eq(kpiWorkerMemberships.workerId, workerId),
          lt(kpiWorkerMemberships.eligibleFrom, periodEnd),
          or(
            isNull(kpiWorkerMemberships.eligibleTo),
            gt(kpiWorkerMemberships.eligibleTo, periodStart),
          ),
        ),
      )
      .orderBy(desc(kpiWorkerMemberships.eligibleFrom))
      .limit(1);
    return rows[0]?.profileName ?? null;
  },

  async findByZohoUserId(
    ctx: TenantContext,
    zohoUserId: string,
  ): Promise<KpiWorker | undefined> {
    const rows = await db
      .select()
      .from(kpiWorkers)
      .where(
        and(
          eq(kpiWorkers.tenantId, ctx.tenantId),
          eq(kpiWorkers.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /** Upsert the directory row and open/close its effective population membership atomically. */
  async sync(ctx: TenantContext, input: KpiDirectoryWorker): Promise<KpiWorker> {
    const now = new Date();
    const profileName = input.profileName?.trim() || null;
    const normalizedProfile = profileName ? normalizeKpiProfile(profileName) : null;
    return db.transaction(async (tx) => {
      const rows = await tx
        .insert(kpiWorkers)
        .values({
          tenantId: ctx.tenantId,
          zohoUserId: input.zohoUserId.trim(),
          displayName: input.displayName?.trim() || null,
          email: input.email?.trim() || null,
          currentProfileName: profileName,
          currentRoleName: input.roleName?.trim() || null,
          sourceActive: input.active,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [kpiWorkers.tenantId, kpiWorkers.zohoUserId],
          set: {
            displayName: input.displayName?.trim() || null,
            email: input.email?.trim() || null,
            currentProfileName: profileName,
            currentRoleName: input.roleName?.trim() || null,
            sourceActive: input.active,
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        .returning();
      const worker = firstOrThrow(rows, 'Failed to upsert KPI worker');

      const activeRules = normalizedProfile
        ? await tx
            .select({ id: kpiPopulationProfiles.id })
            .from(kpiPopulationProfiles)
            .where(
              and(
                eq(kpiPopulationProfiles.tenantId, ctx.tenantId),
                eq(kpiPopulationProfiles.normalizedProfileName, normalizedProfile),
                eq(kpiPopulationProfiles.active, true),
              ),
            )
            .limit(1)
        : [];
      const eligible = input.active && activeRules.length > 0;
      const openRows = await tx
        .select()
        .from(kpiWorkerMemberships)
        .where(
          and(
            eq(kpiWorkerMemberships.tenantId, ctx.tenantId),
            eq(kpiWorkerMemberships.workerId, worker.id),
            isNull(kpiWorkerMemberships.eligibleTo),
          ),
        )
        .limit(1);
      const open = openRows[0];

      if (open && (!eligible || open.profileName !== profileName)) {
        await tx
          .update(kpiWorkerMemberships)
          .set({ eligibleTo: now })
          .where(
            and(
              eq(kpiWorkerMemberships.tenantId, ctx.tenantId),
              eq(kpiWorkerMemberships.id, open.id),
            ),
          );
      }
      if (eligible && (!open || open.profileName !== profileName)) {
        await tx.insert(kpiWorkerMemberships).values({
          tenantId: ctx.tenantId,
          workerId: worker.id,
          profileName: profileName ?? '',
          eligibleFrom: now,
        });
      }
      return worker;
    });
  },

  async isCurrentlyEligible(ctx: TenantContext, workerId: string): Promise<boolean> {
    const rows = await db
      .select({ id: kpiWorkerMemberships.id })
      .from(kpiWorkerMemberships)
      .where(
        and(
          eq(kpiWorkerMemberships.tenantId, ctx.tenantId),
          eq(kpiWorkerMemberships.workerId, workerId),
          isNull(kpiWorkerMemberships.eligibleTo),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  /** Active-users API omits disabled/deleted users; close memberships for rows not seen. */
  async markMissingInactive(ctx: TenantContext, seenZohoUserIds: ReadonlySet<string>): Promise<number> {
    const existing = await this.list(ctx);
    let changed = 0;
    for (const worker of existing) {
      if (!worker.sourceActive || seenZohoUserIds.has(worker.zohoUserId)) continue;
      await this.sync(ctx, {
        zohoUserId: worker.zohoUserId,
        displayName: worker.displayName,
        email: worker.email,
        profileName: worker.currentProfileName,
        roleName: worker.currentRoleName,
        active: false,
      });
      changed += 1;
    }
    return changed;
  },
};
