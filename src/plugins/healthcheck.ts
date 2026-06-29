import type { FastifyInstance } from 'fastify';
import { resolveWidgetDir, WIDGET_DIR_CANDIDATES } from './widgetStatic.js';

/**
 * Liveness probe at `/health` (Render healthCheckPath). Intentionally trivial and
 * unauthenticated — it must not touch the DB so it stays green during DB blips.
 * Deeper readiness checks (DB) live at GET /v1/health.
 *
 * It also echoes the deployed git commit (Render injects RENDER_GIT_COMMIT) and whether the
 * widget build resolved, so `curl /health` answers "which commit is live and is /widget served?"
 * in one shot — no dashboard spelunking when a deploy looks stale.
 */
export function healthcheckPlugin(app: FastifyInstance): void {
  app.get('/health', async () => ({
    ok: true,
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    widget: resolveWidgetDir() ? 'served' : 'missing',
    widgetTried: resolveWidgetDir() ? undefined : WIDGET_DIR_CANDIDATES,
  }));
}
