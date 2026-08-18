import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import {
  RECRUIT_CANDIDATE_STAGES,
  RECRUIT_EMPLOYMENT_TYPES,
  RECRUIT_JOB_STATUSES,
} from '../../db/schema/index.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { recruitRepo } from '../../repos/recruitRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const jobStatus = z.enum(RECRUIT_JOB_STATUSES);
const employmentType = z.enum(RECRUIT_EMPLOYMENT_TYPES);
const candidateStage = z.enum(RECRUIT_CANDIDATE_STAGES);

const jobBody = z.object({
  openingCode: z.string().max(40).nullable().optional(),
  title: z.string().trim().min(1).max(180),
  departmentId: z.string().trim().min(1).max(80),
  hiringManagerEmployeeId: z.string().max(80).nullable().optional(),
  employmentType: employmentType.optional(),
  location: z.string().max(180).nullable().optional(),
  status: jobStatus.optional(),
  headcount: z.number().int().min(1).max(500).optional(),
  description: z.string().max(10_000).nullable().optional(),
});

const candidateBody = z.object({
  jobOpeningId: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  stage: candidateStage.optional(),
  source: z.string().max(120).nullable().optional(),
  currentCompany: z.string().max(180).nullable().optional(),
  currentTitle: z.string().max(180).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const convertBody = z.object({
  employeeId: z.string().max(80).nullable().optional(),
  designation: z.string().max(180).nullable().optional(),
  location: z.string().max(180).nullable().optional(),
  dateOfJoining: z.string().max(40).nullable().optional(),
  mobile: z.string().max(50).nullable().optional(),
});

/**
 * Recruit is co-owned by two departments — Recruiters (the `recruit` grant) and HR — plus admins.
 * Declared here instead of a bare `requireDepartment('recruit')` so an HR user always reaches the
 * hiring workspace, whether or not their per-user grant also lists `recruit`: hiring is an HR
 * function. Anyone with NEITHER department is refused, so this never opens up like `hr` (which is
 * read-open to every internal worker). A plain employee — and a team lead, who has no `hr`/`recruit`
 * department of their own — has no way in.
 */
function requireRecruitRead(request: FastifyRequest): TenantContext {
  const base = requireContext(request);
  if (base.audience !== 'internal') throw new RBACError('Recruit workspace is internal-only');
  const ctx = withDepartmentAccess(base, request);
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('recruit') ||
    ctx.departments.includes('hr');
  if (!ok) throw new RBACError('Recruit workspace requires Recruiter or HR access');
  return ctx;
}

/**
 * Full CRUD for HR and admins; a dedicated Recruiter writes unless their `recruit` access is
 * read-only. HR carries no `recruit` access-mode, so they are never the read-only case — hiring CRUD
 * is theirs by policy.
 */
function requireRecruitWrite(request: FastifyRequest): TenantContext {
  const ctx = requireRecruitRead(request);
  if (ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess) return ctx;
  if (ctx.departments.includes('hr')) return ctx;
  if (ctx.mytrionAccessModes?.recruit === 'read') {
    throw new RBACError('Recruit workspace requires full (write) access — your access is read-only');
  }
  return ctx;
}

function requireRecruitAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireRecruitRead(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required');
  }
  return ctx;
}

function jobDto(row: Awaited<ReturnType<typeof recruitRepo.listJobs>>[number]) {
  return {
    ...row,
    openedAt: row.openedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function candidateDto(row: Awaited<ReturnType<typeof recruitRepo.listCandidates>>[number]) {
  return {
    ...row,
    appliedAt: row.appliedAt.toISOString(),
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function recruitRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  app.get('/recruit/jobs', auth, async (request) => {
    const ctx = requireRecruitRead(request);
    const query = z.object({ status: jobStatus.optional() }).parse(request.query);
    return {
      items: (await recruitRepo.listJobs(ctx, query.status)).map(jobDto),
    };
  });

  app.post('/recruit/jobs', auth, async (request) => {
    const ctx = requireRecruitWrite(request);
    const body = jobBody.parse(request.body);
    const row = await recruitRepo.createJob(ctx, body);
    await auditFromContext(ctx, {
      action: 'recruit.job.create',
      status: 'ok',
      resourceType: 'recruit_job_opening',
      resourceId: row.id,
      detail: { departmentId: row.departmentId, status: row.status },
    });
    const enriched = (await recruitRepo.listJobs(ctx)).find((item) => item.id === row.id);
    if (!enriched) throw new NotFoundError('Recruit opening not found after create');
    return jobDto(enriched);
  });

  app.patch<{ Params: { id: string } }>('/recruit/jobs/:id', auth, async (request) => {
    const ctx = requireRecruitWrite(request);
    const patch = jobBody.partial().parse(request.body);
    const row = await recruitRepo.updateJob(ctx, request.params.id, patch);
    if (!row) throw new NotFoundError('Recruit opening not found');
    await auditFromContext(ctx, {
      action: 'recruit.job.update',
      status: 'ok',
      resourceType: 'recruit_job_opening',
      resourceId: row.id,
      detail: { fields: Object.keys(patch) },
    });
    const enriched = (await recruitRepo.listJobs(ctx)).find((item) => item.id === row.id);
    if (!enriched) throw new NotFoundError('Recruit opening not found after update');
    return jobDto(enriched);
  });

  app.delete<{ Params: { id: string } }>('/recruit/jobs/:id', auth, async (request, reply) => {
    const ctx = requireRecruitWrite(request);
    if (!(await recruitRepo.deleteJob(ctx, request.params.id))) {
      throw new NotFoundError('Recruit opening not found');
    }
    await auditFromContext(ctx, {
      action: 'recruit.job.delete',
      status: 'ok',
      resourceType: 'recruit_job_opening',
      resourceId: request.params.id,
      detail: {},
    });
    return reply.code(204).send();
  });

  app.get('/recruit/candidates', auth, async (request) => {
    const ctx = requireRecruitRead(request);
    const query = z
      .object({
        q: z.string().max(200).optional(),
        stage: candidateStage.optional(),
        jobOpeningId: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const options = {
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.stage !== undefined ? { stage: query.stage } : {}),
      ...(query.jobOpeningId !== undefined ? { jobOpeningId: query.jobOpeningId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    };
    return {
      items: (await recruitRepo.listCandidates(ctx, options)).map(candidateDto),
    };
  });

  app.post('/recruit/candidates', auth, async (request) => {
    const ctx = requireRecruitWrite(request);
    const body = candidateBody.parse(request.body);
    const row = await recruitRepo.createCandidate(ctx, body);
    await auditFromContext(ctx, {
      action: 'recruit.candidate.create',
      status: 'ok',
      resourceType: 'recruit_candidate',
      resourceId: row.id,
      detail: { jobOpeningId: row.jobOpeningId },
    });
    const enriched = await recruitRepo.getCandidate(ctx, row.id);
    if (!enriched) throw new NotFoundError('Candidate not found after create');
    return candidateDto(enriched);
  });

  app.patch<{ Params: { id: string } }>('/recruit/candidates/:id', auth, async (request) => {
    const ctx = requireRecruitWrite(request);
    const patch = candidateBody.partial().parse(request.body);
    const row = await recruitRepo.updateCandidate(ctx, request.params.id, patch);
    if (!row) throw new NotFoundError('Candidate not found');
    await auditFromContext(ctx, {
      action: 'recruit.candidate.update',
      status: 'ok',
      resourceType: 'recruit_candidate',
      resourceId: row.id,
      detail: { fields: Object.keys(patch) },
    });
    const enriched = await recruitRepo.getCandidate(ctx, row.id);
    if (!enriched) throw new NotFoundError('Candidate not found after update');
    return candidateDto(enriched);
  });

  app.delete<{ Params: { id: string } }>(
    '/recruit/candidates/:id',
    auth,
    async (request, reply) => {
      const ctx = requireRecruitWrite(request);
      if (!(await recruitRepo.deleteCandidate(ctx, request.params.id))) {
        throw new NotFoundError('Candidate not found or already converted');
      }
      await auditFromContext(ctx, {
        action: 'recruit.candidate.delete',
        status: 'ok',
        resourceType: 'recruit_candidate',
        resourceId: request.params.id,
        detail: {},
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/recruit/candidates/:id/convert',
    auth,
    async (request) => {
      const ctx = requireRecruitAdmin(request);
      const body = convertBody.parse(request.body ?? {});
      const result = await recruitRepo.convertCandidate(ctx, request.params.id, body);
      await auditFromContext(ctx, {
        action: 'recruit.candidate.convert',
        status: 'ok',
        resourceType: 'hr_employee',
        resourceId: result.employeeId,
        detail: { candidateId: result.candidateId },
      });
      return result;
    },
  );

  app.get('/recruit/settings', auth, async (request) => {
    const ctx = requireRecruitAdmin(request);
    const row = await recruitRepo.getSettings(ctx);
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  app.patch('/recruit/settings', auth, async (request) => {
    const ctx = requireRecruitAdmin(request);
    const patch = z
      .object({
        defaultLocation: z.string().max(180).nullable().optional(),
        employeeIdPrefix: z.string().trim().min(1).max(20).optional(),
        defaultEmployeeStatus: z.string().trim().min(1).max(80).optional(),
      })
      .parse(request.body);
    const row = await recruitRepo.updateSettings(ctx, patch);
    await auditFromContext(ctx, {
      action: 'recruit.settings.update',
      status: 'ok',
      resourceType: 'recruit_settings',
      resourceId: row.id,
      detail: { fields: Object.keys(patch) },
    });
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}
