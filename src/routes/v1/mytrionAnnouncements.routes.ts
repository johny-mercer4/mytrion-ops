import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { mytrionAnnouncementRepo } from '../../repos/mytrionAnnouncementRepo.js';
import type { MytrionAnnouncement } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireInternal } from './helpers.js';

const DEPARTMENTS = [
  'sales',
  'customer-service',
  'billing',
  'finance',
  'collection',
  'mobile',
  'verification',
] as const;

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  targetDepartments: z.array(z.enum(DEPARTMENTS)).min(1).max(DEPARTMENTS.length),
  priority: z.enum(['normal', 'high']).default('normal'),
});
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

function managerContext(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'Manager announcements');
}

function readerDepartments(ctx: TenantContext): string[] {
  return ctx.allDepartmentAccess ? [...DEPARTMENTS] : ctx.departments;
}

function dto(
  announcement: MytrionAnnouncement & { readAt?: Date | null; viewCount?: number },
) {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    targetDepartments: announcement.targetDepartments,
    priority: announcement.priority,
    createdByUserId: announcement.createdByUserId,
    publishedAt: announcement.publishedAt.toISOString(),
    createdAt: announcement.createdAt.toISOString(),
    ...(announcement.viewCount !== undefined ? { viewCount: announcement.viewCount } : {}),
    ...(announcement.readAt !== undefined
      ? { readAt: announcement.readAt?.toISOString() ?? null, read: announcement.readAt != null }
      : {}),
  };
}

export async function mytrionAnnouncementsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/manager/announcements', auth, async (request) => {
    const ctx = managerContext(request);
    const query = listSchema.parse(request.query ?? {});
    const announcements = await mytrionAnnouncementRepo.listForManager(ctx, query.limit);
    return { announcements: announcements.map(dto) };
  });

  app.post('/manager/announcements', auth, async (request, reply) => {
    const ctx = managerContext(request);
    const body = createSchema.parse(request.body ?? {});
    const targetDepartments = [...new Set(body.targetDepartments)];
    const announcement = await mytrionAnnouncementRepo.create(ctx, {
      title: body.title,
      body: body.body,
      targetDepartments,
      priority: body.priority,
    });
    await auditFromContext(ctx, {
      action: 'mytrion_announcement.publish',
      status: 'ok',
      resourceType: 'mytrion_announcement',
      resourceId: announcement.id,
      detail: { targetDepartments, priority: announcement.priority },
    });
    return reply.code(201).send({ announcement: dto(announcement) });
  });

  app.get('/announcements', auth, async (request) => {
    const ctx = requireInternal(request, 'Department announcements');
    const query = listSchema.parse(request.query ?? {});
    const announcements = await mytrionAnnouncementRepo.listForReader(
      ctx,
      ctx.userId,
      readerDepartments(ctx),
      query.limit,
    );
    return { announcements: announcements.map(dto) };
  });

  app.post<{ Params: { announcementId: string } }>(
    '/announcements/:announcementId/view',
    auth,
    async (request) => {
      const ctx = requireInternal(request, 'Department announcements');
      const announcementId = z.string().trim().min(1).max(160).parse(request.params.announcementId);
      const viewed = await mytrionAnnouncementRepo.recordView(
        ctx,
        announcementId,
        ctx.userId,
        readerDepartments(ctx),
      );
      if (!viewed) throw new NotFoundError('Announcement not found');
      return { viewed: true, id: announcementId };
    },
  );

  app.post<{ Params: { announcementId: string } }>(
    '/announcements/:announcementId/read',
    auth,
    async (request) => {
      const ctx = requireInternal(request, 'Department announcements');
      const announcementId = z.string().trim().min(1).max(160).parse(request.params.announcementId);
      const marked = await mytrionAnnouncementRepo.markRead(
        ctx,
        announcementId,
        ctx.userId,
        readerDepartments(ctx),
      );
      if (!marked) throw new NotFoundError('Announcement not found');
      await auditFromContext(ctx, {
        action: 'mytrion_announcement.read',
        status: 'ok',
        resourceType: 'mytrion_announcement',
        resourceId: announcementId,
      });
      return { read: true, id: announcementId };
    },
  );
}
