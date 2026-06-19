import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { API_PREFIX, APP_NAME } from './config/constants.js';
import { env, isDev, isProduction, isTest } from './config/env.js';
import { isAllowedOrigin } from './lib/cors.js';
import { logger } from './lib/logger.js';
import { apiKeyAuthPlugin } from './plugins/apiKeyAuth.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { healthcheckPlugin } from './plugins/healthcheck.js';
import { rbacPlugin } from './plugins/rbac.js';
import { requestContextPlugin } from './plugins/requestContext.js';
import { adminRoutes } from './routes/v1/admin.routes.js';
import { authRoutes } from './routes/v1/auth.routes.js';
import { automationRoutes } from './routes/v1/automation.routes.js';
import { chatRoutes } from './routes/v1/chat.routes.js';
import { healthRoutes } from './routes/v1/health.routes.js';
import { knowledgeRoutes } from './routes/v1/knowledge.routes.js';
import { toolsRoutes } from './routes/v1/tools.routes.js';

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

  // Cross-cutting (root-level so decorators/hooks reach every route).
  requestContextPlugin(app);
  errorHandlerPlugin(app);
  authPlugin(app);
  apiKeyAuthPlugin(app);
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
    ],
    credentials: true,
  });
  await app.register(sensible);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  // File uploads for knowledge training (POST /v1/knowledge/upload).
  await app.register(multipart, {
    limits: { fileSize: 10_000_000, files: 20, fields: 10 },
  });

  if (!isProduction && !isTest) {
    await registerDocs(app);
  }

  healthcheckPlugin(app); // GET /health (liveness)

  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(authRoutes);
      await v1.register(chatRoutes);
      await v1.register(knowledgeRoutes);
      await v1.register(toolsRoutes);
      await v1.register(automationRoutes);
      await v1.register(adminRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}

export { logger };
