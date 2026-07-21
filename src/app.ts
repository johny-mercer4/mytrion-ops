import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { API_PREFIX, APP_NAME } from './config/constants.js';
import { env, isDev, isProduction, isTest } from './config/env.js';
import { isAllowedOrigin } from './lib/cors.js';
import { logger } from './lib/logger.js';
import { apiKeyAuthPlugin } from './plugins/apiKeyAuth.js';
import { authPlugin } from './plugins/auth.js';
import { combinedAuthPlugin } from './plugins/combinedAuth.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { healthcheckPlugin } from './plugins/healthcheck.js';
import { rbacPlugin } from './plugins/rbac.js';
import { requestContextPlugin } from './plugins/requestContext.js';
import { registerWidgetStatic } from './plugins/widgetStatic.js';
import { registerMiniAppStatic } from './plugins/miniAppStatic.js';
import { applyDepartmentPolicy } from './modules/agents/departmentAgents.js';
import { loadMcpTools } from './modules/tools/mcpTools.js';
import { loadDbtMcpTools } from './modules/tools/dbtMcpTools.js';
import { toolRegistry } from './modules/tools/index.js';
import { adminRoutes } from './routes/v1/admin.routes.js';
import { analyticsRoutes } from './routes/v1/analytics.routes.js';
import { cmpSchemaRoutes } from './routes/v1/cmpSchema.routes.js';
import { dwhSchemaRoutes } from './routes/v1/dwhSchema.routes.js';
import { verificationSchemaRoutes } from './routes/v1/verificationSchema.routes.js';
import { mytrionAccessRoutes } from './routes/v1/mytrionAccess.routes.js';
import { startAnalyticsWarmer } from './modules/analytics/cache.js';
import { carrierMiniAppRoutes } from './routes/v1/carrierMiniApp.routes.js';
import { deskRoutes } from './routes/v1/desk.routes.js';
import { dataCenterRoutes } from './routes/v1/dataCenter.routes.js';
import { csApplicationsRoutes } from './routes/v1/csApplications.routes.js';
import { csCitifuelRoutes } from './routes/v1/csCitifuel.routes.js';
import { csAnalyticsRoutes } from './routes/v1/csAnalytics.routes.js';
import { billingRoutes } from './routes/v1/billing.routes.js';
import { paymentsIngestRoutes } from './routes/v1/paymentsIngest.routes.js';
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
import { retentionRoutes } from './routes/v1/retention.routes.js';
import { scopeRoutes } from './routes/v1/scope.routes.js';
import { approvalsRoutes } from './routes/v1/approvals.routes.js';
import { filesRoutes } from './routes/v1/files.routes.js';
import { tasksRoutes } from './routes/v1/tasks.routes.js';
import { toolsRoutes } from './routes/v1/tools.routes.js';
import { touchpointsRoutes } from './routes/v1/touchpoints.routes.js';

function loggerOption() {
  if (isTest) return false;
  if (isDev) {
    return {
      level: env.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: env.LOG_LEVEL };
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
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
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
    },
  );

  // Cross-cutting (root-level so decorators/hooks reach every route).
  requestContextPlugin(app);
  errorHandlerPlugin(app);
  authPlugin(app);
  apiKeyAuthPlugin(app);
  combinedAuthPlugin(app);
  rbacPlugin(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    // Reflect the caller's Origin when allowed (exact match or allowed suffix, e.g.
    // *.zappsusercontent.com) — never a bare "*", since we send a custom x-api-key header.
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-request-id',
      'x-department-access',
      'x-all-departments',
      'x-zoho-user-id',
      // Admin "act as agent" impersonation (honored only for a verified admin session).
      'x-act-as-zoho-user-id',
      'x-act-as-user-name',
      'x-act-as-profile',
      'x-act-as-role',
    ],
    credentials: true,
  });
  await app.register(sensible);
  // Native WebSocket support (GET /v1/realtime — inbox pub/sub). Registered at the root so
  // the versioned scope's websocket routes can attach; 1 MiB frame cap.
  await app.register(websocket, { options: { maxPayload: 1_048_576 } });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  // File uploads for knowledge training (POST /v1/knowledge/upload).
  await app.register(multipart, {
    // Global ceiling; /v1/files/upload additionally enforces FILE_MAX_SIZE_MB per request.
    limits: { fileSize: Math.max(10_000_000, env.FILE_MAX_SIZE_MB * 1024 * 1024), files: 20, fields: 20 },
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
      logger.error({ err }, 'zoho mcp: tool discovery failed/timed out; continuing without MCP tools');
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
      applyDepartmentPolicy(dbtTools); // no agent lists dbt_mcp.* → admin-only
      toolRegistry.register(dbtTools);
    } catch (err) {
      logger.error({ err }, 'dbt mcp: tool discovery failed/timed out; continuing without dbt MCP tools');
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
      await v1.register(cmpSchemaRoutes);
      await v1.register(dwhSchemaRoutes);
      await v1.register(verificationSchemaRoutes);
      await v1.register(mytrionAccessRoutes);
      await v1.register(carrierMiniAppRoutes);
      await v1.register(retentionRoutes);
      await v1.register(realtimeRoutes);
      await v1.register(touchpointsRoutes);
      await v1.register(deskRoutes);
      await v1.register(dataCenterRoutes);
      await v1.register(csApplicationsRoutes);
      await v1.register(csCitifuelRoutes);
      await v1.register(csAnalyticsRoutes);
      await v1.register(billingRoutes);
      await v1.register(paymentsIngestRoutes);
      await v1.register(agentRoutes);
      await v1.register(tasksRoutes);
      await v1.register(filesRoutes);
      await v1.register(approvalsRoutes);
      await v1.register(integrationsRoutes);
      await v1.register(ringcentralRoutes);
      await v1.register(analyticsRoutes);
    },
    { prefix: API_PREFIX },
  );

  // Live-analytics snapshot warmer: warm now, then recompute on the TTL cadence (default 2h) so
  // dashboard GETs always hit a warm cache. No-op without a DWH; never runs in tests.
  if (!isTest) startAnalyticsWarmer();

  return app;
}

export { logger };
