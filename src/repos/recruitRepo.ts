import { createId } from '@paralleldrive/cuid2';
import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  hrDepartments,
  hrEmployees,
  recruitCandidates,
  recruitJobOpenings,
  recruitSettings,
  type NewRecruitCandidate,
  type NewRecruitJobOpening,
  type RecruitCandidateStage,
  type RecruitEmploymentType,
  type RecruitJobStatus,
} from '../db/schema/index.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

export interface RecruitJobInput {
  openingCode?: string | null | undefined;
  title: string;
  departmentId: string;
  hiringManagerEmployeeId?: string | null | undefined;
  employmentType?: RecruitEmploymentType | undefined;
  location?: string | null | undefined;
  status?: RecruitJobStatus | undefined;
  headcount?: number | undefined;
  description?: string | null | undefined;
}

export interface RecruitCandidateInput {
  jobOpeningId: string;
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  stage?: RecruitCandidateStage | undefined;
  source?: string | null | undefined;
  currentCompany?: string | null | undefined;
  currentTitle?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface RecruitCandidateListOpts {
  q?: string;
  stage?: RecruitCandidateStage;
  jobOpeningId?: string;
  limit?: number;
  offset?: number;
}

type RecruitPatch<T> = { [Key in keyof T]?: T[Key] | undefined };

async function departmentForJob(ctx: TenantContext, id: string) {
  const rows = await db
    .select({ id: hrDepartments.id, name: hrDepartments.name })
    .from(hrDepartments)
    .where(and(eq(hrDepartments.tenantId, ctx.tenantId), eq(hrDepartments.id, id)))
    .limit(1);
  const row = firstOrUndefined(rows);
  if (!row) throw new NotFoundError('HR department not found');
  return row;
}

export const recruitRepo = {
  async listJobs(ctx: TenantContext, status?: RecruitJobStatus) {
    const clauses = [eq(recruitJobOpenings.tenantId, ctx.tenantId)];
    if (status) clauses.push(eq(recruitJobOpenings.status, status));
    return db
      .select({
        id: recruitJobOpenings.id,
        tenantId: recruitJobOpenings.tenantId,
        openingCode: recruitJobOpenings.openingCode,
        title: recruitJobOpenings.title,
        departmentId: recruitJobOpenings.departmentId,
        departmentName: recruitJobOpenings.departmentName,
        hiringManagerEmployeeId: recruitJobOpenings.hiringManagerEmployeeId,
        employmentType: recruitJobOpenings.employmentType,
        location: recruitJobOpenings.location,
        status: recruitJobOpenings.status,
        headcount: recruitJobOpenings.headcount,
        description: recruitJobOpenings.description,
        openedAt: recruitJobOpenings.openedAt,
        closedAt: recruitJobOpenings.closedAt,
        createdAt: recruitJobOpenings.createdAt,
        updatedAt: recruitJobOpenings.updatedAt,
        candidateCount: sql<number>`count(${recruitCandidates.id})::int`,
        hiredCount: sql<number>`count(${recruitCandidates.id}) filter (where ${recruitCandidates.stage} = 'hired')::int`,
      })
      .from(recruitJobOpenings)
      .leftJoin(
        recruitCandidates,
        and(
          eq(recruitCandidates.tenantId, recruitJobOpenings.tenantId),
          eq(recruitCandidates.jobOpeningId, recruitJobOpenings.id),
        ),
      )
      .where(and(...clauses))
      .groupBy(recruitJobOpenings.id)
      .orderBy(
        sql`case ${recruitJobOpenings.status} when 'open' then 0 when 'draft' then 1 when 'paused' then 2 else 3 end`,
        desc(recruitJobOpenings.updatedAt),
      );
  },

  async getJob(ctx: TenantContext, id: string) {
    const rows = await db
      .select()
      .from(recruitJobOpenings)
      .where(
        and(eq(recruitJobOpenings.tenantId, ctx.tenantId), eq(recruitJobOpenings.id, id)),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async createJob(ctx: TenantContext, input: RecruitJobInput) {
    const department = await departmentForJob(ctx, input.departmentId);
    const now = new Date();
    const row: NewRecruitJobOpening = {
      tenantId: ctx.tenantId,
      openingCode: input.openingCode?.trim() || null,
      title: input.title.trim(),
      departmentId: department.id,
      departmentName: department.name,
      hiringManagerEmployeeId: input.hiringManagerEmployeeId?.trim() || null,
      employmentType: input.employmentType ?? 'full_time',
      location: input.location?.trim() || null,
      status: input.status ?? 'draft',
      headcount: input.headcount ?? 1,
      description: input.description?.trim() || null,
      openedAt: input.status === 'open' ? now : null,
      closedAt: input.status === 'closed' ? now : null,
    };
    const rows = await db.insert(recruitJobOpenings).values(row).returning();
    return firstOrThrow(rows, 'Recruit opening insert returned no row');
  },

  async updateJob(ctx: TenantContext, id: string, patch: RecruitPatch<RecruitJobInput>) {
    const updates: Partial<NewRecruitJobOpening> = { updatedAt: new Date() };
    if (patch.openingCode !== undefined) updates.openingCode = patch.openingCode?.trim() || null;
    if (patch.title !== undefined) updates.title = patch.title.trim();
    if (patch.departmentId !== undefined) {
      const department = await departmentForJob(ctx, patch.departmentId);
      updates.departmentId = department.id;
      updates.departmentName = department.name;
    }
    if (patch.hiringManagerEmployeeId !== undefined) {
      updates.hiringManagerEmployeeId = patch.hiringManagerEmployeeId?.trim() || null;
    }
    if (patch.employmentType !== undefined) updates.employmentType = patch.employmentType;
    if (patch.location !== undefined) updates.location = patch.location?.trim() || null;
    if (patch.headcount !== undefined) updates.headcount = patch.headcount;
    if (patch.description !== undefined) updates.description = patch.description?.trim() || null;
    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.status === 'open') updates.openedAt = new Date();
      if (patch.status === 'closed') updates.closedAt = new Date();
    }
    const rows = await db
      .update(recruitJobOpenings)
      .set(updates)
      .where(
        and(eq(recruitJobOpenings.tenantId, ctx.tenantId), eq(recruitJobOpenings.id, id)),
      )
      .returning();
    return firstOrUndefined(rows);
  },

  async deleteJob(ctx: TenantContext, id: string): Promise<boolean> {
    const candidates = await db
      .select({ id: recruitCandidates.id })
      .from(recruitCandidates)
      .where(
        and(
          eq(recruitCandidates.tenantId, ctx.tenantId),
          eq(recruitCandidates.jobOpeningId, id),
        ),
      )
      .limit(1);
    if (candidates.length > 0) {
      throw new ConflictError('Close this opening instead; candidates are already attached');
    }
    const rows = await db
      .delete(recruitJobOpenings)
      .where(
        and(eq(recruitJobOpenings.tenantId, ctx.tenantId), eq(recruitJobOpenings.id, id)),
      )
      .returning({ id: recruitJobOpenings.id });
    return rows.length > 0;
  },

  async listCandidates(ctx: TenantContext, opts: RecruitCandidateListOpts = {}) {
    const clauses = [eq(recruitCandidates.tenantId, ctx.tenantId)];
    if (opts.stage) clauses.push(eq(recruitCandidates.stage, opts.stage));
    if (opts.jobOpeningId?.trim()) {
      clauses.push(eq(recruitCandidates.jobOpeningId, opts.jobOpeningId.trim()));
    }
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      const searchClause = or(
        ilike(recruitCandidates.firstName, q),
        ilike(recruitCandidates.lastName, q),
        ilike(recruitCandidates.email, q),
        ilike(recruitJobOpenings.title, q),
      );
      if (searchClause) clauses.push(searchClause);
    }
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    return db
      .select({
        id: recruitCandidates.id,
        tenantId: recruitCandidates.tenantId,
        jobOpeningId: recruitCandidates.jobOpeningId,
        jobTitle: recruitJobOpenings.title,
        departmentId: recruitJobOpenings.departmentId,
        departmentName: recruitJobOpenings.departmentName,
        firstName: recruitCandidates.firstName,
        lastName: recruitCandidates.lastName,
        email: recruitCandidates.email,
        phone: recruitCandidates.phone,
        stage: recruitCandidates.stage,
        source: recruitCandidates.source,
        currentCompany: recruitCandidates.currentCompany,
        currentTitle: recruitCandidates.currentTitle,
        notes: recruitCandidates.notes,
        appliedAt: recruitCandidates.appliedAt,
        convertedEmployeeId: recruitCandidates.convertedEmployeeId,
        convertedAt: recruitCandidates.convertedAt,
        createdAt: recruitCandidates.createdAt,
        updatedAt: recruitCandidates.updatedAt,
      })
      .from(recruitCandidates)
      .innerJoin(
        recruitJobOpenings,
        and(
          eq(recruitJobOpenings.tenantId, recruitCandidates.tenantId),
          eq(recruitJobOpenings.id, recruitCandidates.jobOpeningId),
        ),
      )
      .where(and(...clauses))
      .orderBy(
        sql`case ${recruitCandidates.stage} when 'offer' then 0 when 'interview' then 1 when 'screening' then 2 when 'new' then 3 when 'hired' then 4 else 5 end`,
        desc(recruitCandidates.updatedAt),
      )
      .limit(limit)
      .offset(offset);
  },

  async getCandidate(ctx: TenantContext, id: string) {
    const rows = await this.listCandidates(ctx, { limit: 500 });
    return rows.find((row) => row.id === id);
  },

  async createCandidate(ctx: TenantContext, input: RecruitCandidateInput) {
    const job = await this.getJob(ctx, input.jobOpeningId);
    if (!job) throw new NotFoundError('Recruit opening not found');
    const row: NewRecruitCandidate = {
      tenantId: ctx.tenantId,
      jobOpeningId: job.id,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      stage: input.stage ?? 'new',
      source: input.source?.trim() || null,
      currentCompany: input.currentCompany?.trim() || null,
      currentTitle: input.currentTitle?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    const rows = await db.insert(recruitCandidates).values(row).returning();
    return firstOrThrow(rows, 'Recruit candidate insert returned no row');
  },

  async updateCandidate(
    ctx: TenantContext,
    id: string,
    patch: RecruitPatch<RecruitCandidateInput>,
  ) {
    const updates: Partial<NewRecruitCandidate> = { updatedAt: new Date() };
    if (patch.jobOpeningId !== undefined) {
      const job = await this.getJob(ctx, patch.jobOpeningId);
      if (!job) throw new NotFoundError('Recruit opening not found');
      updates.jobOpeningId = job.id;
    }
    if (patch.firstName !== undefined) updates.firstName = patch.firstName.trim();
    if (patch.lastName !== undefined) updates.lastName = patch.lastName.trim();
    if (patch.email !== undefined) updates.email = patch.email?.trim().toLowerCase() || null;
    if (patch.phone !== undefined) updates.phone = patch.phone?.trim() || null;
    if (patch.stage !== undefined) updates.stage = patch.stage;
    if (patch.source !== undefined) updates.source = patch.source?.trim() || null;
    if (patch.currentCompany !== undefined) {
      updates.currentCompany = patch.currentCompany?.trim() || null;
    }
    if (patch.currentTitle !== undefined) {
      updates.currentTitle = patch.currentTitle?.trim() || null;
    }
    if (patch.notes !== undefined) updates.notes = patch.notes?.trim() || null;
    const rows = await db
      .update(recruitCandidates)
      .set(updates)
      .where(
        and(eq(recruitCandidates.tenantId, ctx.tenantId), eq(recruitCandidates.id, id)),
      )
      .returning();
    return firstOrUndefined(rows);
  },

  async deleteCandidate(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(recruitCandidates)
      .where(
        and(
          eq(recruitCandidates.tenantId, ctx.tenantId),
          eq(recruitCandidates.id, id),
          isNull(recruitCandidates.convertedEmployeeId),
        ),
      )
      .returning({ id: recruitCandidates.id });
    return rows.length > 0;
  },

  async getSettings(ctx: TenantContext) {
    await db
      .insert(recruitSettings)
      .values({ tenantId: ctx.tenantId })
      .onConflictDoNothing({ target: recruitSettings.tenantId });
    const rows = await db
      .select()
      .from(recruitSettings)
      .where(eq(recruitSettings.tenantId, ctx.tenantId))
      .limit(1);
    return firstOrThrow(rows, 'Recruit settings could not be initialized');
  },

  async updateSettings(
    ctx: TenantContext,
    patch: {
      defaultLocation?: string | null | undefined;
      employeeIdPrefix?: string | undefined;
      defaultEmployeeStatus?: string | undefined;
    },
  ) {
    await this.getSettings(ctx);
    const updates: Partial<typeof recruitSettings.$inferInsert> = { updatedAt: new Date() };
    if (patch.defaultLocation !== undefined) {
      updates.defaultLocation = patch.defaultLocation?.trim() || null;
    }
    if (patch.employeeIdPrefix !== undefined) {
      updates.employeeIdPrefix = patch.employeeIdPrefix.trim().toUpperCase();
    }
    if (patch.defaultEmployeeStatus !== undefined) {
      updates.defaultEmployeeStatus = patch.defaultEmployeeStatus.trim();
    }
    const rows = await db
      .update(recruitSettings)
      .set(updates)
      .where(eq(recruitSettings.tenantId, ctx.tenantId))
      .returning();
    return firstOrThrow(rows, 'Recruit settings update returned no row');
  },

  async convertCandidate(
    ctx: TenantContext,
    candidateId: string,
    input: {
      employeeId?: string | null | undefined;
      designation?: string | null | undefined;
      location?: string | null | undefined;
      dateOfJoining?: string | null | undefined;
      mobile?: string | null | undefined;
    },
  ) {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: recruitCandidates.id,
          firstName: recruitCandidates.firstName,
          lastName: recruitCandidates.lastName,
          email: recruitCandidates.email,
          phone: recruitCandidates.phone,
          currentTitle: recruitCandidates.currentTitle,
          convertedEmployeeId: recruitCandidates.convertedEmployeeId,
          departmentId: recruitJobOpenings.departmentId,
          departmentName: recruitJobOpenings.departmentName,
        })
        .from(recruitCandidates)
        .innerJoin(
          recruitJobOpenings,
          and(
            eq(recruitJobOpenings.tenantId, recruitCandidates.tenantId),
            eq(recruitJobOpenings.id, recruitCandidates.jobOpeningId),
          ),
        )
        .where(
          and(
            eq(recruitCandidates.tenantId, ctx.tenantId),
            eq(recruitCandidates.id, candidateId),
          ),
        )
        .limit(1);
      const candidate = firstOrUndefined(rows);
      if (!candidate) throw new NotFoundError('Candidate not found');
      if (candidate.convertedEmployeeId) {
        throw new ConflictError('Candidate has already been converted to an employee');
      }

      const settingsRows = await tx
        .select()
        .from(recruitSettings)
        .where(eq(recruitSettings.tenantId, ctx.tenantId))
        .limit(1);
      const settings = firstOrUndefined(settingsRows);
      const employeeRecordId = `hre_${createId()}`;
      const defaultEmployeeId = `${settings?.employeeIdPrefix || 'EMP'}-${new Date()
        .getFullYear()
        .toString()}-${candidate.id.slice(-5).toUpperCase()}`;
      const claimed = await tx
        .update(recruitCandidates)
        .set({
          stage: 'hired',
          convertedEmployeeId: employeeRecordId,
          convertedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recruitCandidates.tenantId, ctx.tenantId),
            eq(recruitCandidates.id, candidate.id),
            isNull(recruitCandidates.convertedEmployeeId),
          ),
        )
        .returning({ id: recruitCandidates.id });
      if (claimed.length === 0) {
        throw new ConflictError('Candidate was converted by another request');
      }

      const employeeRows = await tx
        .insert(hrEmployees)
        .values({
          id: employeeRecordId,
          tenantId: ctx.tenantId,
          employeeId: input.employeeId?.trim() || defaultEmployeeId,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
          departmentId: candidate.departmentId,
          department: candidate.departmentName,
          designation: input.designation?.trim() || candidate.currentTitle,
          location: input.location?.trim() || settings?.defaultLocation || null,
          status: settings?.defaultEmployeeStatus || 'Active',
          dateOfJoining: input.dateOfJoining?.trim() || null,
          mobile: input.mobile?.trim() || candidate.phone,
          source: 'recruit',
          rawFields: { recruitCandidateId: candidate.id },
        })
        .returning({ id: hrEmployees.id });
      return {
        candidateId: candidate.id,
        employeeId: firstOrThrow(employeeRows, 'Employee conversion returned no row').id,
      };
    });
  },
};
