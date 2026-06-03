import type { FastifyInstance } from 'fastify';

/**
 * Liveness probe at `/health` (Render healthCheckPath). Intentionally trivial and
 * unauthenticated — it must not touch the DB so it stays green during DB blips.
 * Deeper readiness checks (DB/Redis) live at GET /v1/health.
 */
export function healthcheckPlugin(app: FastifyInstance): void {
  app.get('/health', async () => ({ ok: true }));
}
