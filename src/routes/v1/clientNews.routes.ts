/**
 * /v1/client-news — authoring for the mini-app's news feed. ADMIN-ONLY (CLAUDE.md rule 7:
 * writes gate on role + audit): news is Octane speaking to clients, so creation is an
 * internal operator action — the zoho-octane widget or an admin script calls this. Reading
 * BY clients happens in carrierMiniApp.routes (/carrier/mini-app/inbox), filtered by their
 * own verified registration — never through here.
 */
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { clientNews, type NewClientNewsPost } from '../../db/schema/index.js';
import { RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { pushImportantNews } from '../../modules/notifications/news.js';
import { sanitizePlainText, sanitizeRichText } from '../../modules/notifications/richText.js';
import { requireContext } from './helpers.js';

const localizedSchema = z.object({
  en: z.string().min(1).max(4000),
  ru: z.string().max(4000).optional(),
  uz: z.string().max(4000).optional(),
  es: z.string().max(4000).optional(),
});

const createSchema = z.object({
  title: localizedSchema,
  body: localizedSchema,
  audience_scope: z.enum(['all', 'carriers']).default('all'),
  carrier_ids: z.array(z.string().min(1).max(40)).max(200).default([]),
  roles: z.array(z.enum(['owner', 'driver'])).min(1).default(['owner', 'driver']),
  severity: z.enum(['info', 'important']).default('info'),
  pinned: z.boolean().default(false),
  publish_at: z.coerce.date().optional(),
  expires_at: z.coerce.date().optional(),
});

export async function clientNewsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post('/client-news', guard, async (request, reply) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) throw new RBACError('Posting client news requires admin access');
    const body = createSchema.parse(request.body);
    if (body.audience_scope === 'carriers' && body.carrier_ids.length === 0) {
      return reply.status(400).send({ code: 'NEWS_NO_CARRIERS', message: "audience_scope 'carriers' needs carrier_ids" });
    }
    // Server-side sanitize is the real gate — the CRM's editor is convenience, not security.
    const cleanText = (v: typeof body.title) => ({
      en: sanitizePlainText(v.en),
      ...(v.ru ? { ru: sanitizePlainText(v.ru) } : {}),
      ...(v.uz ? { uz: sanitizePlainText(v.uz) } : {}),
      ...(v.es ? { es: sanitizePlainText(v.es) } : {}),
    });
    const cleanRich = (v: typeof body.body) => ({
      en: sanitizeRichText(v.en),
      ...(v.ru ? { ru: sanitizeRichText(v.ru) } : {}),
      ...(v.uz ? { uz: sanitizeRichText(v.uz) } : {}),
      ...(v.es ? { es: sanitizeRichText(v.es) } : {}),
    });
    const values: NewClientNewsPost = {
      tenantId: ctx.tenantId,
      title: cleanText(body.title),
      body: cleanRich(body.body),
      audienceScope: body.audience_scope,
      carrierIds: body.carrier_ids,
      roles: body.roles,
      severity: body.severity,
      pinned: body.pinned,
      createdBy: ctx.userId,
    };
    if (body.publish_at) values.publishAt = body.publish_at;
    if (body.expires_at) values.expiresAt = body.expires_at;
    const [post] = await db.insert(clientNews).values(values).returning();
    if (!post) throw new Error('news insert returned no row');
    await auditFromContext(ctx, {
      action: 'client_news.create',
      status: 'ok',
      resourceType: 'client_news',
      resourceId: post.id,
      detail: { scope: post.audienceScope, carriers: post.carrierIds.length, severity: post.severity },
    });
    // important + targeted → bot push through the notification outbox (fire-and-forget).
    pushImportantNews(post);
    return reply.status(201).send(post);
  });

  app.get('/client-news', guard, async (request) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) throw new RBACError('Listing client news requires admin access');
    return db
      .select()
      .from(clientNews)
      .where(eq(clientNews.tenantId, ctx.tenantId))
      .orderBy(desc(clientNews.createdAt))
      .limit(100);
  });
}
