import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { API_PREFIX, APP_NAME } from './config/constants.js';
import { env, isDev, isProduction, isTest } from './config/env.js';
import { isAllowedOrigin } from './lib/cors.js';
import { safeEqual } from './lib/crypto.js';
import { logger } from './lib/logger.js';
import { apiKeyAuthPlugin } from './plugins/apiKeyAuth.js';
import { authPlugin } from './plugins/auth.js';
import { combinedAuthPlugin } from './plugins/combinedAuth.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { healthcheckPlugin } from './plugins/healthcheck.js';
import { rbacPlugin } from './plugins/rbac.js';
import { requestContextPlugin } from './plugins/requestContext.js';
import { wsHeartbeatPlugin } from './plugins/wsHeartbeat.js';
import { registerCommsRealtime } from './modules/comms/bootstrap.js';
import { requireCommsSchema } from './modules/comms/readiness.js';
import { supportBotGatewayAuthPlugin } from './plugins/supportBotGatewayAuth.js';
import { registerWidgetStatic } from './plugins/widgetStatic.js';
import { registerMiniAppStatic } from './plugins/miniAppStatic.js';
import { applyDepartmentPolicy } from './modules/agents/departmentAgents.js';
import { loadMcpTools } from './modules/tools/mcpTools.js';
import { loadDbtMcpTools } from './modules/tools/dbtMcpTools.js';
import { toolRegistry } from './modules/tools/index.js';
import { adminRoutes } from './routes/v1/admin.routes.js';
import { dataLoaderRoutes } from './routes/v1/dataLoader.routes.js';
import { analyticsRoutes } from './routes/v1/analytics.routes.js';
import { cmpSchemaRoutes } from './routes/v1/cmpSchema.routes.js';
import { dwhSchemaRoutes } from './routes/v1/dwhSchema.routes.js';
import { mytrionSchemaRoutes } from './routes/v1/mytrionSchema.routes.js';
import { verificationSchemaRoutes } from './routes/v1/verificationSchema.routes.js';
import { verificationPipelineRoutes } from './routes/v1/verificationPipeline.routes.js';
import { verificationClientsRoutes } from './routes/v1/verificationClients.routes.js';
import { mytrionAccessRoutes } from './routes/v1/mytrionAccess.routes.js';
import { startAnalyticsWarmer } from './modules/analytics/cache.js';
import { carrierMiniAppRoutes } from './routes/v1/carrierMiniApp.routes.js';
import { carrierMiniAppReportRoutes } from './routes/v1/carrierMiniAppReports.routes.js';
import { carrierMiniAppActionsRoutes } from './routes/v1/carrierMiniAppActions.routes.js';
import { commsRoutes } from './routes/v1/comms.routes.js';
import { commsAdminRoutes } from './routes/v1/commsAdmin.routes.js';
import { commsAttachmentsRoutes } from './routes/v1/commsAttachments.routes.js';
import { commsEscalationsRoutes } from './routes/v1/commsEscalations.routes.js';
import { commsQueueRoutes } from './routes/v1/commsQueue.routes.js';
import { commsThreadsRoutes } from './routes/v1/commsThreads.routes.js';
import { commsTicketsRoutes } from './routes/v1/commsTickets.routes.js';
import { deskRoutes } from './routes/v1/desk.routes.js';
import { dataCenterRoutes } from './routes/v1/dataCenter.routes.js';
import { salesInvoicesRoutes } from './routes/v1/salesInvoices.routes.js';
import { salesCardReportsRoutes } from './routes/v1/salesCardReports.routes.js';
import { managerRoutes } from './routes/v1/manager.routes.js';
import { csApplicationsRoutes } from './routes/v1/csApplications.routes.js';
import { csCitifuelRoutes } from './routes/v1/csCitifuel.routes.js';
import { csMaintenanceRoutes } from './routes/v1/csMaintenance.routes.js';
import { csAnalyticsRoutes } from './routes/v1/csAnalytics.routes.js';
import { billingRoutes } from './routes/v1/billing.routes.js';
import { financeRoutes } from './routes/v1/finance.routes.js';
import { paymentsIngestRoutes } from './routes/v1/paymentsIngest.routes.js';
import { inboxMessagesRoutes } from './routes/v1/inboxMessages.routes.js';
import { hrRoutes } from './routes/v1/hr.routes.js';
import { hrPeopleRoutes } from './routes/v1/hrPeople.routes.js';
import { hrDepartmentsRoutes } from './routes/v1/hrDepartments.routes.js';
import { hrAttendanceRoutes } from './routes/v1/hrAttendance.routes.js';
import { hrLeaveRoutes } from './routes/v1/hrLeave.routes.js';
import { recruitRoutes } from './routes/v1/recruit.routes.js';
import { rejectionReportsRoutes } from './routes/v1/rejectionReports.routes.js';
import { agentRoutes } from './routes/v1/agent.routes.js';
import { authRoutes } from './routes/v1/auth.routes.js';
import { automationRoutes } from './routes/v1/automation.routes.js';
import { chatRoutes } from './routes/v1/chat.routes.js';
import { healthRoutes } from './routes/v1/health.routes.js';
import { integrationsRoutes } from './routes/v1/integrations.routes.js';
import { ringcentralRoutes } from './routes/v1/ringcentral.routes.js';
import { knowledgeRoutes } from './routes/v1/knowledge.routes.js';
import { moneyCodeRoutes } from './routes/v1/moneyCode.routes.js';
import { realtimeRoutes } from './routes/v1/realtime.routes.js';
import { clientNewsRoutes } from './routes/v1/clientNews.routes.js';
import { supportBotRoutes } from './routes/v1/supportBot.routes.js';
import { retentionRoutes } from './routes/v1/retention.routes.js';
import { scopeRoutes } from './routes/v1/scope.routes.js';
import { approvalsRoutes } from './routes/v1/approvals.routes.js';
import { filesRoutes } from './routes/v1/files.routes.js';
import { tasksRoutes } from './routes/v1/tasks.routes.js';
import { toolsRoutes } from './routes/v1/tools.routes.js';
import { touchpointsRoutes } from './routes/v1/touchpoints.routes.js';
import { salesKpiRoutes } from './routes/v1/salesKpi.routes.js';
import { salesBootstrapRoutes } from './routes/v1/salesBootstrap.routes.js';
import { callHubRoutes } from './routes/v1/callHub.routes.js';
import { managerTasksRoutes } from './routes/v1/managerTasks.routes.js';
import { kpiAdminRoutes } from './routes/v1/kpiAdmin.routes.js';

// Redact auth-bearing request headers from Fastify's request logger (defense-in-depth: the default
// serializer doesn't dump headers, but if request-header logging is ever enabled these must not leak).
const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-support-bot-key"]',
  'req.headers["x-ingest-secret"]',
  'req.headers["x-inbox-secret"]',
  'req.headers["x-rejection-secret"]',
  'req.headers["x-webhook-signature"]',
];

function loggerOption() {
  if (isTest) return false;
  if (isDev) {
    return {
      level: env.LOG_LEVEL,
      redact: LOG_REDACT_PATHS,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: env.LOG_LEVEL, redact: LOG_REDACT_PATHS };
}

type RateBudget = 'auth' | 'webhook' | 'cached-read' | 'upstream-read' | 'touchpoint' | 'write';

/** Keep read/write/provider budgets independent even when every office user shares one NAT. */
function rateBudget(request: Pick<FastifyRequest, 'method' | 'url'>): RateBudget {
  const path = request.url.split('?')[0] ?? request.url;
  if (path.includes('/auth/')) return 'auth';
  if (path.includes('/webhook') || path.includes('/ingest')) return 'webhook';
  if (path.includes('/touchpoints/')) return 'touchpoint';
  if (request.method !== 'GET' && request.method !== 'HEAD') return 'write';
  if (
    path.includes('/verification/') ||
    path.includes('/call-hub/') ||
    path.includes('/data-center/') ||
    path.includes('/dashboard')
  ) {
    return 'upstream-read';
  }
  return 'cached-read';
}

async function registerDocs(app: FastifyInstance): Promise<void> {
  try {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Octane Assistant API', version: '0.1.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  } catch (err) {
    app.log.warn({ err }, 'failed to register swagger (continuing without docs)');
  }
}

/**
 * Build the Fastify app. Cross-cutting decorators/hooks are applied directly on the
 * root instance (so they propagate to all routes without fastify-plugin); official
 * plugins + versioned routes are registered after.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOption(),
    trustProxy: true,
    bodyLimit: 2_000_000,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : `req_${APP_NAME}`;
    },
  });

  // Tolerate an empty JSON body. The Zoho server-side proxy issues POSTs (the only verb it
  // reliably allows for mutations) often with `content-type: application/json` and no body — e.g.
  // the POST delete aliases (/scope/risks/:id/delete, /knowledge/docs/:id/delete) that take no
  // payload. Fastify's default parser 400s on that (FST_ERR_CTP_EMPTY_JSON_BODY); we treat empty
  // as {} while still rejecting malformed JSON. Global on purpose — every widget POST hits the same
  // proxy. Caveat: a future POST route with an all-optional schema would accept an empty body as a
  // no-op {} rather than erroring; keep at least one required field (or a .refine) on such schemas.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  // Cross-cutting (root-level so decorators/hooks reach every route).
  requestContextPlugin(app);
  errorHandlerPlugin(app);
  authPlugin(app);
  apiKeyAuthPlugin(app);
  combinedAuthPlugin(app);
  supportBotGatewayAuthPlugin(app);
  rbacPlugin(app);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    // helmet's default is COOP: same-origin, which puts any window.open() popup in a SEPARATE
    // browsing context group and makes `window.opener` null inside it. That silently breaks every
    // OAuth-popup sign-in we host — most visibly the RingCentral softphone: Embeddable opens the RC
    // login popup, RC redirects it to its own redirect.html, and redirect.js hands the code back via
    // `window.opener.oAuthCallback(...)` / `window.opener.postMessage({callbackUri}, ...)` then
    // window.close(). With the opener severed that throws, so the popup never closes and the agent
    // sits on redirect.html's literal "Loading..." forever. Dev never saw it because the Vite dev
    // server sends no COOP at all. `same-origin-allow-popups` keeps this document protected from a
    // cross-origin opener while letting popups WE open keep their opener reference.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  await app.register(cors, {
    // Reflect the caller's Origin when allowed (exact match or allowed suffix, e.g.
    // *.zappsusercontent.com) — never a bare "*", since we send a custom x-api-key header.
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-support-bot-key',
      'x-request-id',
      'x-department-access',
      'x-all-departments',
      'x-zoho-user-id',
      // Admin "act as agent" impersonation (honored only for a verified admin session).
      'x-act-as-zoho-user-id',
      'x-act-as-user-name',
      'x-act-as-profile',
      'x-act-as-role',
      'x-webhook-key-id',
      'x-webhook-timestamp',
      'x-webhook-signature',
      'idempotency-key',
      'x-support-bot-confirmation-id',
      'x-support-bot-turn-id',
      'x-support-bot-write-occurrence',
      'x-support-bot-session-key',
      'x-support-bot-fencing-token',
    ],
    credentials: true,
  });
  await app.register(sensible);
  // Native WebSocket support (GET /v1/realtime — inbox pub/sub). Registered at the root so
  // the versioned scope's websocket routes can attach; 1 MiB frame cap.
  await app.register(websocket, { options: { maxPayload: 1_048_576 } });
  // Protocol ping + reaper for both WS endpoints. Must come after the websocket registration
  // (it reads app.websocketServer) and before any route that attaches sockets.
  wsHeartbeatPlugin(app);
  // Hand the hub its row-level thread authorizer. Registered here rather than imported by the hub so
  // the hub keeps depending only on logger + types; the authorizer reuses the REST reader filter.
  registerCommsRealtime();
  await app.register(rateLimit, {
    // Authentication guards run in onRequest. Limiting in preHandler lets authenticated office
    // users receive their own bucket instead of 30–40 people sharing one NAT/IP bucket.
    hook: 'preHandler',
    max: (request) => {
      const budget = rateBudget(request);
      if (budget === 'auth') return 20;
      if (budget === 'write') return request.url.includes('/kpi/') ? 120 : 30;
      if (budget === 'upstream-read') return 60;
      return 120;
    },
    timeWindow: '1 minute',
    cache: 10_000,
    // One support-bot gateway fronts up to 800 Telegram groups behind a single IP. Its dedicated
    // credential bypasses the browser/IP bucket entirely; the support-bot handlers apply their own
    // carrier-aware limits and RBAC. (From build — kept alongside the per-budget buckets below.)
    allowList: (request) => {
      // Tests drive a whole suite through ONE in-process app instance, which is not a client: this
      // branch tightened writes to 30/min, so a 110-case file 429s partway through and the failure
      // reads as a route bug. Route-level guards (SELF_REGISTER_RATE_LIMITED, MINIAPP_WRITE_RATE_
      // LIMITED) are unaffected and still assert in tests — only the global abuse bucket is off.
      if (isTest) return true;
      const key = request.headers['x-support-bot-key'];
      return (
        request.url.startsWith(`${API_PREFIX}/support-bot`) &&
        typeof key === 'string' &&
        env.SUPPORT_BOT_GATEWAY_API_KEY.length > 0 &&
        safeEqual(key, env.SUPPORT_BOT_GATEWAY_API_KEY)
      );
    },
    keyGenerator: (request) => {
      const ctx = request.ctx;
      const budget = rateBudget(request);
      // Use the authenticated ACTOR. An admin viewing as an agent must not consume the target's
      // budget; effective identity still belongs in data-cache keys, not abuse-control keys.
      if (ctx?.sessionVerified) return `${budget}:principal:${ctx.tenantId}:${ctx.userId}`;
      return `${budget}:ip:${request.ip}`;
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    onExceeded: (request, key) => {
      request.log.warn({ key, route: request.routeOptions.url, method: request.method }, 'rate limit exceeded');
    },
    errorResponseBuilder: (_request, context) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / 1000));
      // @fastify/rate-limit throws this object into the app error handler. statusCode must live at
      // the top level or a customized response is accidentally converted to an HTTP 500.
      return {
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
        details: { retryAfterSeconds },
      };
    },
  });
  // File uploads for knowledge training (POST /v1/knowledge/upload).
  await app.register(multipart, {
    // Global ceiling; each route additionally enforces its OWN per-request cap — /v1/files/upload uses
    // FILE_MAX_SIZE_MB, comms attachments use COMMS_ATTACHMENT_MAX_MB.
    //
    // The max() over both is load-bearing: FILE_MAX_SIZE_MB is zod-capped at 200MB, so a larger chat
    // attachment limit would be silently truncated here — the request would die in the parser with a
    // generic error before the comms route's own, clearer 413 could ever run.
    limits: {
      fileSize: Math.max(
        10_000_000,
        env.FILE_MAX_SIZE_MB * 1024 * 1024,
        env.COMMS_ATTACHMENT_MAX_MB * 1024 * 1024,
      ),
      files: 20,
      fields: 20,
    },
  });

  if (!isProduction && !isTest) {
    await registerDocs(app);
  }

  healthcheckPlugin(app); // GET /health (liveness)

  // Serve the AI Chat widget UI same-origin at /widget (public; no-op if apps/mytrion-crm/app isn't built).
  await registerWidgetStatic(app);

  // Serve the Telegram carrier onboarding mini-app same-origin at /mini-app (public; no-op if
  // apps/mini-app/app isn't built). BotFather Main App URL = <origin>/mini-app/.
  await registerMiniAppStatic(app);

  // Discover Zoho MCP tools once at boot and register them (flag-gated). Non-fatal AND bounded: a
  // slow/hung MCP endpoint must never block startup (Render deploy/health timeouts), so we race
  // discovery against a hard deadline and continue with native tools if it loses.
  if (env.FF_ZOHO_MCP_ENABLED) {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('mcp discovery timed out')), 20_000),
    );
    try {
      const mcpTools = await Promise.race([loadMcpTools(), deadline]);
      applyDepartmentPolicy(mcpTools); // no agent lists MCP tools → admin-only
      toolRegistry.register(mcpTools);
    } catch (err) {
      logger.error(
        { err },
        'zoho mcp: tool discovery failed/timed out; continuing without MCP tools',
      );
    }
  }

  // Same pattern for the hosted dbt warehouse MCP (OpenAI tool loop ↔ Claude Custom Connector parity).
  // Query-memory RAG identity is per-call via X-User-Email (Zoho worker email on TenantContext).
  if (env.FF_DBT_MCP_ENABLED) {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('dbt mcp discovery timed out')), 20_000),
    );
    try {
      const dbtTools = await Promise.race([loadDbtMcpTools(), deadline]);
      // Manifests list `dbt_mcp.*`; department policy expands the wildcard onto query/recall tools.
      applyDepartmentPolicy(dbtTools);
      toolRegistry.register(dbtTools);
    } catch (err) {
      logger.error(
        { err },
        'dbt mcp: tool discovery failed/timed out; continuing without dbt MCP tools',
      );
    }
  }

  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes);
      await v1.register(chatRoutes);
      await v1.register(knowledgeRoutes);
      await v1.register(scopeRoutes);
      await v1.register(toolsRoutes);
      await v1.register(automationRoutes);
      await v1.register(moneyCodeRoutes);
      await v1.register(adminRoutes);
      await v1.register(dataLoaderRoutes);
      await v1.register(cmpSchemaRoutes);
      await v1.register(dwhSchemaRoutes);
      await v1.register(mytrionSchemaRoutes);
      await v1.register(verificationSchemaRoutes);
      await v1.register(mytrionAccessRoutes);
      await v1.register(clientNewsRoutes);
      await v1.register(supportBotRoutes);
      await v1.register(carrierMiniAppRoutes);
      await v1.register(carrierMiniAppReportRoutes);
      await v1.register(carrierMiniAppActionsRoutes);
      await v1.register(retentionRoutes);
      await v1.register(realtimeRoutes);
      await v1.register(touchpointsRoutes);
      await v1.register(deskRoutes);
      await v1.register(async (comms) => {
        // Auth runs in each route's onRequest guard; schema readiness is checked immediately after
        // it, before any repository query can turn a missing migration into an opaque HTTP 500.
        comms.addHook('preHandler', requireCommsSchema);
        await comms.register(commsRoutes);
        await comms.register(commsTicketsRoutes);
        await comms.register(commsThreadsRoutes);
        await comms.register(commsAttachmentsRoutes);
        await comms.register(commsEscalationsRoutes);
        await comms.register(commsQueueRoutes);
        await comms.register(commsAdminRoutes);
      });
      await v1.register(dataCenterRoutes);
      await v1.register(salesInvoicesRoutes);
      await v1.register(salesCardReportsRoutes);
      await v1.register(managerRoutes);
      await v1.register(verificationPipelineRoutes);
      await v1.register(verificationClientsRoutes);
      await v1.register(csApplicationsRoutes);
      await v1.register(csCitifuelRoutes);
      await v1.register(csMaintenanceRoutes);
      await v1.register(csAnalyticsRoutes);
      await v1.register(billingRoutes);
      await v1.register(financeRoutes);
      await v1.register(paymentsIngestRoutes);
      await v1.register(inboxMessagesRoutes);
      await v1.register(hrRoutes);
      await v1.register(hrPeopleRoutes);
      await v1.register(hrDepartmentsRoutes);
      await v1.register(hrAttendanceRoutes);
      await v1.register(hrLeaveRoutes);
      await v1.register(recruitRoutes);
      // Owns GET /data-center/rejections (moved off the Zoho Desk scan) plus the Deluge webhook.
      await v1.register(rejectionReportsRoutes);
      await v1.register(agentRoutes);
      await v1.register(tasksRoutes);
      await v1.register(filesRoutes);
      await v1.register(approvalsRoutes);
      await v1.register(integrationsRoutes);
      await v1.register(ringcentralRoutes);
      await v1.register(analyticsRoutes);
      await v1.register(salesKpiRoutes);
      await v1.register(salesBootstrapRoutes);
      await v1.register(callHubRoutes);
      await v1.register(managerTasksRoutes);
      await v1.register(kpiAdminRoutes);
    },
    { prefix: API_PREFIX },
  );

  // Live-analytics snapshot warmer: warm now, then recompute on the TTL cadence (default 2h) so
  // dashboard GETs always hit a warm cache. No-op without a DWH; never runs in tests.
  if (!isTest) startAnalyticsWarmer();

  return app;
}

export { logger };
