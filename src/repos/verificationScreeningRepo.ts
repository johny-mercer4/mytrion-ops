/**
 * Phase 3 persistence — the local blacklist and the screening hits raised against a case.
 *
 * Both checks run against our own Postgres; there is no external service. Tenant-first `where` on
 * every query, including the duplicate scan, which is the one most likely to be written carelessly:
 * a cross-tenant duplicate match would leak the existence of another tenant's applicant.
 */
import { and, eq, getTableColumns, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationBlacklistEntries,
  verificationCases,
  verificationScreeningHits,
  type NewVerificationBlacklistEntry,
  type VerificationBlacklistEntry,
  type VerificationScreeningHit,
} from '../db/schema/index.js';
import type {
  VerificationIdentifierType,
  VerificationScreeningVerdict,
} from '../db/schema/verification_flow.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

export const verificationScreeningRepo = {
  /** Check A: which of these hashes are blacklisted for this tenant. */
  async matchBlacklist(
    ctx: TenantContext,
    hashes: string[],
  ): Promise<VerificationBlacklistEntry[]> {
    if (hashes.length === 0) return [];
    return db
      .select()
      .from(verificationBlacklistEntries)
      .where(
        and(
          eq(verificationBlacklistEntries.tenantId, ctx.tenantId),
          eq(verificationBlacklistEntries.active, true),
          inArray(verificationBlacklistEntries.valueHash, hashes),
        ),
      );
  },

  /**
   * Check B / Data Center: cases in THIS tenant sharing an identifier.
   *
   * Compares on the stored plaintext business identifiers (EIN/MC/DOT/email/phone/cell) rather than
   * the hashes, because these columns are the ones a duplicate actually shares and they are not secret.
   * `excludeCaseId` keeps a case from matching itself; Data Center search passes null (no current file).
   */
  async matchDuplicates(
    ctx: TenantContext,
    excludeCaseId: string | null,
    needles: {
      ein?: string | null;
      mc?: string | null;
      dot?: string | null;
      email?: string | null;
      phone?: string | null;
      companyName?: string | null;
    },
  ): Promise<
    Array<{
      id: string;
      entryType: VerificationIdentifierType;
      display: string;
      statusCode: string;
      createdAt: Date;
      applicationDate: string | null;
      zohoDealId: string | null;
      zohoStage: string | null;
    }>
  > {
    const clauses = [];
    if (needles.ein) clauses.push(sql`nullif(regexp_replace(coalesce(${verificationCases.ein},''), '\\D', '', 'g'), '') = ${needles.ein.replace(/\D+/g, '')}`);
    if (needles.mc) clauses.push(sql`nullif(regexp_replace(coalesce(${verificationCases.mc},''), '\\D', '', 'g'), '') = ${needles.mc.replace(/\D+/g, '')}`);
    if (needles.dot) clauses.push(sql`nullif(regexp_replace(coalesce(${verificationCases.dot},''), '\\D', '', 'g'), '') = ${needles.dot.replace(/\D+/g, '')}`);
    if (needles.email) clauses.push(sql`lower(coalesce(${verificationCases.email},'')) = ${needles.email.toLowerCase()}`);
    if (needles.phone) {
      const phone = needles.phone.replace(/\D+/g, '');
      clauses.push(sql`nullif(regexp_replace(coalesce(${verificationCases.phone},''), '\\D', '', 'g'), '') = ${phone}`);
      clauses.push(sql`nullif(regexp_replace(coalesce(${verificationCases.cell},''), '\\D', '', 'g'), '') = ${phone}`);
    }
    if (needles.companyName) {
      clauses.push(
        sql`lower(btrim(coalesce(${verificationCases.companyName},''))) = ${needles.companyName.trim().toLowerCase()}`,
      );
    }
    if (clauses.length === 0) return [];

    const any = or(...clauses);
    const rows = await db
      .select({
        id: verificationCases.id,
        ein: verificationCases.ein,
        mc: verificationCases.mc,
        dot: verificationCases.dot,
        email: verificationCases.email,
        phone: verificationCases.phone,
        cell: verificationCases.cell,
        companyName: verificationCases.companyName,
        statusCode: verificationCases.statusCode,
        createdAt: verificationCases.createdAt,
        applicationDate: verificationCases.applicationDate,
        zohoDealId: verificationCases.zohoDealId,
        zohoStage: verificationCases.zohoStage,
      })
      .from(verificationCases)
      .where(
        and(
          eq(verificationCases.tenantId, ctx.tenantId),
          ...(excludeCaseId ? [ne(verificationCases.id, excludeCaseId)] : []),
          ...(any ? [any] : []),
        ),
      )
      .limit(50);

    // Name which identifier collided — "duplicate of Kaiser Freight" is unactionable, "same EIN as
    // Kaiser Freight" tells the agent what to check.
    const out: Array<{
      id: string;
      entryType: VerificationIdentifierType;
      display: string;
      statusCode: string;
      createdAt: Date;
      applicationDate: string | null;
      zohoDealId: string | null;
      zohoStage: string | null;
    }> = [];
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D+/g, '');
    for (const row of rows) {
      const rest = {
        statusCode: row.statusCode,
        createdAt: row.createdAt,
        applicationDate: row.applicationDate,
        zohoDealId: row.zohoDealId,
        zohoStage: row.zohoStage,
      };
      if (needles.ein && digits(row.ein) === digits(needles.ein) && digits(needles.ein)) {
        out.push({ id: row.id, entryType: 'ein', display: row.companyName ?? row.id, ...rest });
      } else if (needles.mc && digits(row.mc) === digits(needles.mc) && digits(needles.mc)) {
        out.push({ id: row.id, entryType: 'mc', display: row.companyName ?? row.id, ...rest });
      } else if (needles.dot && digits(row.dot) === digits(needles.dot) && digits(needles.dot)) {
        out.push({ id: row.id, entryType: 'usdot', display: row.companyName ?? row.id, ...rest });
      } else if (needles.email && (row.email ?? '').toLowerCase() === needles.email.toLowerCase()) {
        out.push({ id: row.id, entryType: 'email', display: row.email ?? row.id, ...rest });
      } else if (
        needles.phone &&
        (digits(row.phone) === digits(needles.phone) || digits(row.cell) === digits(needles.phone)) &&
        digits(needles.phone)
      ) {
        out.push({ id: row.id, entryType: 'phone', display: row.phone ?? row.cell ?? row.id, ...rest });
      } else {
        out.push({ id: row.id, entryType: 'name', display: row.companyName ?? row.id, ...rest });
      }
    }
    return out;
  },

  async listHits(ctx: TenantContext, caseId: string): Promise<VerificationScreeningHit[]> {
    return db
      .select()
      .from(verificationScreeningHits)
      .where(
        and(
          eq(verificationScreeningHits.tenantId, ctx.tenantId),
          eq(verificationScreeningHits.caseId, caseId),
        ),
      );
  },

  /** Replace this case's hits — a re-run should not stack duplicates of the same match. */
  async replaceHits(
    ctx: TenantContext,
    caseId: string,
    hits: Array<Omit<typeof verificationScreeningHits.$inferInsert, 'tenantId' | 'caseId'>>,
  ): Promise<VerificationScreeningHit[]> {
    await db
      .delete(verificationScreeningHits)
      .where(
        and(
          eq(verificationScreeningHits.tenantId, ctx.tenantId),
          eq(verificationScreeningHits.caseId, caseId),
          // Keep hits an agent already ruled on — re-running the check must not erase their verdict.
          eq(verificationScreeningHits.verdict, 'unverified'),
        ),
      );
    if (hits.length === 0) return this.listHits(ctx, caseId);

    const existing = await this.listHits(ctx, caseId);
    const settled = new Set(existing.map((h) => `${h.checkType}:${h.entryType}:${h.matchedEntryId ?? h.matchedCaseId ?? ''}`));
    const fresh = hits.filter(
      (h) => !settled.has(`${h.checkType}:${h.entryType}:${h.matchedEntryId ?? h.matchedCaseId ?? ''}`),
    );
    if (fresh.length > 0) {
      await db
        .insert(verificationScreeningHits)
        .values(fresh.map((h) => ({ ...h, tenantId: ctx.tenantId, caseId })));
    }
    return this.listHits(ctx, caseId);
  },

  async setVerdict(
    ctx: TenantContext,
    caseId: string,
    hitId: string,
    input: { verdict: VerificationScreeningVerdict; verifiedBy?: string | undefined; note?: string | undefined },
  ): Promise<VerificationScreeningHit | undefined> {
    const rows = await db
      .update(verificationScreeningHits)
      .set({
        verdict: input.verdict,
        verifiedBy: input.verifiedBy ?? null,
        verifiedAt: new Date(),
        note: input.note ?? null,
      })
      .where(
        and(
          eq(verificationScreeningHits.tenantId, ctx.tenantId),
          eq(verificationScreeningHits.caseId, caseId),
          eq(verificationScreeningHits.id, hitId),
        ),
      )
      .returning();
    return firstOrUndefined(rows);
  },

  // ---- blacklist ----

  async listBlacklist(ctx: TenantContext, limit = 200): Promise<VerificationBlacklistEntry[]> {
    return db
      .select()
      .from(verificationBlacklistEntries)
      .where(eq(verificationBlacklistEntries.tenantId, ctx.tenantId))
      .limit(Math.min(Math.max(limit, 1), 1000));
  },

  /**
   * Add or reactivate. A previously deactivated entry being re-added must come back on rather than
   * conflict — the unique index is on (tenant, type, hash), so this is an upsert by design.
   */
  /**
   * `inserted` is true only when the row was NEW. `xmax = 0` is Postgres' own discriminator: zero on a
   * fresh insert, non-zero on a row the ON CONFLICT path updated. Callers need the difference —
   * re-declining an applicant already on the list must not be reported as a fresh ban.
   */
  async addBlacklistEntry(
    ctx: TenantContext,
    input: Omit<NewVerificationBlacklistEntry, 'tenantId'>,
  ): Promise<VerificationBlacklistEntry & { inserted: boolean }> {
    const rows = await db
      .insert(verificationBlacklistEntries)
      .values({ ...input, tenantId: ctx.tenantId })
      .onConflictDoUpdate({
        target: [
          verificationBlacklistEntries.tenantId,
          verificationBlacklistEntries.entryType,
          verificationBlacklistEntries.valueHash,
        ],
        set: {
          active: true,
          reason: input.reason ?? null,
          sourceCaseId: input.sourceCaseId ?? null,
          addedBy: input.addedBy ?? null,
        },
      })
      .returning({
        ...getTableColumns(verificationBlacklistEntries),
        inserted: sql<boolean>`xmax = 0`,
      });
    return firstOrThrow(rows, 'Failed to add blacklist entry');
  },

  /**
   * Returns how many identifiers were NOT already banned.
   *
   * It used to return `entries.length` — the number of rows ATTEMPTED — so re-declining an applicant
   * already on the list told Collections "8 identifiers added" when nothing had been added.
   */
  async addBlacklistEntries(
    ctx: TenantContext,
    entries: Array<Omit<NewVerificationBlacklistEntry, 'tenantId'>>,
  ): Promise<{ added: number; alreadyListed: number }> {
    let added = 0;
    for (const entry of entries) {
      const row = await this.addBlacklistEntry(ctx, entry);
      if (row.inserted) added += 1;
    }
    return { added, alreadyListed: entries.length - added };
  },

  async deactivateBlacklistEntry(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .update(verificationBlacklistEntries)
      .set({ active: false })
      .where(
        and(
          eq(verificationBlacklistEntries.tenantId, ctx.tenantId),
          eq(verificationBlacklistEntries.id, id),
        ),
      )
      .returning({ id: verificationBlacklistEntries.id });
    return rows.length > 0;
  },
};
