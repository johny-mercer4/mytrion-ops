/**
 * Phase 2 Retention CS RoundRobin — prefer Zoho CRM online (Isonline) users
 * from RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS allowlist.
 * Spanish desk (is_spanish_desk) bypasses RR → RETENTION_CS_SPANISH_ZOHO_USER_ID.
 */
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { RETENTION_PHASE, retentionRrCursors } from '../../db/schema/index.js';
import { listActiveUsers, type CrmUser } from '../../integrations/zohoCrm.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { RetentionCaseDto } from '../../repos/retentionCaseRepo.js';
import { setDealStageClosedLost } from './zohoOwnership.js';
import type { CaseTransitionPatch } from './deadlines.js';
import { assertUnderDailyCap, CS_MAX_DEALS_PER_DAY } from './csCaps.js';

export interface CsRoundRobinPick {
  zohoUserId: string;
  name: string | null;
  /** How the assignee was chosen. */
  source: 'spanish_desk' | 'round_robin';
}

function parseAllowlist(): string[] {
  return env.RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function spanishDeskUserId(): string | null {
  const id = env.RETENTION_CS_SPANISH_ZOHO_USER_ID.trim();
  return id || null;
}

async function loadCursor(tenantId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(retentionRrCursors)
    .where(eq(retentionRrCursors.tenantId, tenantId))
    .limit(1);
  return rows[0]?.lastZohoUserId ?? null;
}

async function saveCursor(tenantId: string, zohoUserId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(retentionRrCursors)
    .values({ tenantId, lastZohoUserId: zohoUserId, updatedAt: now })
    .onConflictDoUpdate({
      target: retentionRrCursors.tenantId,
      set: { lastZohoUserId: zohoUserId, updatedAt: now },
    });
}

/** Short TTL so Dissatisfied/handoff doesn't call Zoho Users on every save. */
const USERS_CACHE_TTL_MS = 60_000;
let usersCache: { at: number; users: CrmUser[] } | null = null;

async function listActiveUsersCached(): Promise<CrmUser[]> {
  const now = Date.now();
  if (usersCache && now - usersCache.at < USERS_CACHE_TTL_MS) {
    return usersCache.users;
  }
  const users = await listActiveUsers();
  usersCache = { at: now, users };
  return users;
}

async function resolveUserName(
  zohoUserId: string,
  users?: CrmUser[],
): Promise<string | null> {
  try {
    const list = users ?? (await listActiveUsersCached());
    return list.find((u) => u.zohoUserId === zohoUserId)?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Next CS assignee from allowlist ∩ active users, preferring Isonline.
 * Advances tenant cursor. Returns null when allowlist empty or no active match.
 * Skips agents already at the daily 40-deal cap (tries next in pool).
 */
export async function pickCsRoundRobinAssignee(
  ctx: TenantContext,
  opts: {
    users?: CrmUser[];
    skipZohoUserIds?: string[];
    /** Skip Zoho Users fetch — use warm cache / allowlist only (Sales save hot path). */
    fast?: boolean;
  } = {},
): Promise<CsRoundRobinPick | null> {
  const allow = parseAllowlist();
  if (allow.length === 0) {
    logger.warn('retention CS RoundRobin skipped — RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS empty');
    return null;
  }
  const skip = new Set(opts.skipZohoUserIds ?? []);
  let users: CrmUser[];
  if (opts.users) {
    users = opts.users;
  } else if (usersCache) {
    users = usersCache.users;
  } else if (opts.fast) {
    // Do not block Dissatisfied/handoff on Zoho; warm cache in background.
    users = [];
    void listActiveUsersCached().catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'retention CS RoundRobin: background listActiveUsers failed',
      );
    });
  } else {
    try {
      users = await listActiveUsersCached();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'retention CS RoundRobin: listActiveUsers failed');
      users = [];
    }
  }

  const byId = new Map(users.map((u) => [u.zohoUserId, u]));
  const activeAllow =
    users.length > 0
      ? allow.filter((id) => byId.has(id) && !skip.has(id))
      : allow.filter((id) => !skip.has(id));
  if (activeAllow.length === 0) {
    logger.warn(
      { allowCount: allow.length },
      'retention CS RoundRobin — no allowlisted users available',
    );
    return null;
  }

  const online = activeAllow.filter((id) => byId.get(id)?.isOnline === true);
  const pool = online.length > 0 ? online : activeAllow;
  const last = await loadCursor(ctx.tenantId);
  // Rotate pool so we try next after cursor, then wrap.
  const startIdx = last && pool.includes(last) ? (pool.indexOf(last) + 1) % pool.length : 0;
  const ordered = [...pool.slice(startIdx), ...pool.slice(0, startIdx)];

  for (const nextId of ordered) {
    try {
      await assertUnderDailyCap(ctx, nextId);
      await saveCursor(ctx.tenantId, nextId);
      const user = byId.get(nextId);
      return { zohoUserId: nextId, name: user?.name ?? null, source: 'round_robin' };
    } catch {
      // at daily cap — try next
    }
  }

  logger.warn(
    { cap: CS_MAX_DEALS_PER_DAY, poolSize: pool.length },
    'retention CS RoundRobin — all candidates at daily cap',
  );
  return null;
}

export interface HandoffCaseHint {
  isSpanishDesk?: boolean | null | undefined;
}

/** Enrich a Retention handoff patch with Spanish desk or RoundRobin CS assignee → p2_working. */
export async function enrichHandoffWithRoundRobin(
  ctx: TenantContext,
  patch: CaseTransitionPatch,
  caseHint: HandoffCaseHint = {},
): Promise<CaseTransitionPatch> {
  if (patch.phaseCode !== RETENTION_PHASE.retention) return patch;

  if (caseHint.isSpanishDesk) {
    const spanishId = spanishDeskUserId();
    if (spanishId) {
      try {
        await assertUnderDailyCap(ctx, spanishId);
        // Name from warm cache only — do not await Zoho Users on the handoff hot path.
        const name = (await resolveUserName(spanishId, usersCache?.users)) ?? 'Jean Paul';
        return {
          ...patch,
          statusCode: 'p2_working',
          assignedAgentZohoUserId: spanishId,
          agentName: name,
          eventNotes:
            (patch.eventNotes ?? 'Handed to Retention') +
            ` · Spanish desk ${name.trim()} (${spanishId})`,
        };
      } catch (err) {
        logger.warn(
          { spanishId, err: err instanceof Error ? err.message : String(err) },
          'retention Spanish desk at daily cap — falling through to RoundRobin',
        );
      }
    } else {
      logger.warn(
        'retention Spanish desk case but RETENTION_CS_SPANISH_ZOHO_USER_ID unset — RoundRobin',
      );
    }
  }

  const pick = await pickCsRoundRobinAssignee(ctx, { fast: true });
  if (!pick) {
    return {
      ...patch,
      statusCode: 'p2_new',
      assignedAgentZohoUserId: null,
      agentName: null,
    };
  }
  return {
    ...patch,
    statusCode: 'p2_working',
    assignedAgentZohoUserId: pick.zohoUserId,
    agentName: pick.name,
    eventNotes:
      (patch.eventNotes ?? 'Handed to Retention') +
      ` · RR assign ${pick.name?.trim() || 'CS'} (${pick.zohoUserId})`,
  };
}

/**
 * Side effects after a case transition lands.
 * Retention handoff / CS desk claim update the case assignee only — Deal/Contact/Company
 * stay with the Sales agent. Zoho ownership transfers solely on Open Pool claim approve
 * (`transferZohoThenFinalize` in retentionPoolClaimRepo).
 * Entered CITI → Deal Stage Closed Lost.
 */
export async function afterRetentionPhaseSideEffects(
  beforePhase: string,
  after: Pick<
    RetentionCaseDto,
    'phaseCode' | 'assignedAgentZohoUserId' | 'zohoDealId' | 'id'
  >,
  _opts: {
    previousAssigneeZohoUserId?: string | null;
  } = {},
): Promise<void> {
  if (after.phaseCode === RETENTION_PHASE.citi && beforePhase !== RETENTION_PHASE.citi) {
    await setDealStageClosedLost(after.zohoDealId);
  }
}

/**
 * Run Zoho / notify work after the HTTP response — keeps Sales modal updates snappy.
 * Failures are logged; DB transition already committed.
 */
export function scheduleRetentionPostCommit(
  label: string,
  work: () => Promise<void>,
): void {
  void work().catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      `${label} post-commit failed`,
    );
  });
}
