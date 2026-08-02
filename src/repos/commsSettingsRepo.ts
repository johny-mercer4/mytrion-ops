import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionCommsSettings,
  type MytrionCommsSettings,
  type SlaHoursByPriority,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The one-row-per-tenant comms control centre (SLA maps, DM phase gate, timezone).
 *
 * 0092 seeds a row for every tenant that existed when it ran, so a MISSING row means a tenant created
 * afterwards. That must not fail a ticket create, so reads fall back to the same defaults the DDL
 * declares rather than throwing — and the fallback is a shared constant instead of two literals that
 * can drift apart.
 */

export interface EffectiveCommsSettings {
  slaHoursByPriority: SlaHoursByPriority;
  firstResponseHoursByPriority: SlaHoursByPriority;
  dmEnabled: boolean;
  dmAdminReadEnabled: boolean;
  timezone: string;
  /** False when the tenant has no row and the defaults above are in force. */
  persisted: boolean;
}

/** Mirrors the column DEFAULTs in 0092_comms_core.sql. Kept in one place on purpose. */
export const DEFAULT_COMMS_SETTINGS: Omit<EffectiveCommsSettings, 'persisted'> = {
  slaHoursByPriority: { low: 72, medium: 24, high: 4, critical: 4 },
  firstResponseHoursByPriority: { low: 24, medium: 8, high: 2, critical: 1 },
  dmEnabled: false,
  dmAdminReadEnabled: false,
  timezone: 'Asia/Tashkent',
};

export const commsSettingsRepo = {
  buildGetQuery(ctx: TenantContext) {
    return db
      .select()
      .from(mytrionCommsSettings)
      .where(eq(mytrionCommsSettings.tenantId, ctx.tenantId))
      .limit(1);
  },

  async get(ctx: TenantContext): Promise<MytrionCommsSettings | undefined> {
    const [row] = await this.buildGetQuery(ctx);
    return row;
  },

  /** Settings with the DDL defaults filled in — what every caller should use. */
  async getEffective(ctx: TenantContext): Promise<EffectiveCommsSettings> {
    const row = await this.get(ctx);
    if (!row) return { ...DEFAULT_COMMS_SETTINGS, persisted: false };
    return {
      slaHoursByPriority: row.slaHoursByPriority,
      firstResponseHoursByPriority: row.firstResponseHoursByPriority,
      dmEnabled: row.dmEnabled,
      dmAdminReadEnabled: row.dmAdminReadEnabled,
      timezone: row.timezone,
      persisted: true,
    };
  },
};

/**
 * Hours for a priority out of one of the two maps.
 *
 * The maps are jsonb and therefore admin-editable, so a priority can genuinely be absent — falling
 * back to `medium` and then to a literal keeps a half-filled map from producing a NULL due date, which
 * would silently exclude the ticket from the SLA sweeper's partial index.
 */
export function slaHoursFor(
  map: SlaHoursByPriority,
  priority: string,
  fallbackHours: number,
): number {
  const direct = map[priority];
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  const medium = map.medium;
  if (typeof medium === 'number' && Number.isFinite(medium) && medium > 0) return medium;
  return fallbackHours;
}
