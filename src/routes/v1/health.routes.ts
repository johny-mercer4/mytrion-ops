import type { FastifyInstance } from 'fastify';
import { pingDb } from '../../db/client.js';

/** Readiness probe (DB-aware) at GET /v1/health. The liveness probe is GET /health. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let db = false;
    try {
      db = await pingDb();
    } catch {
      db = false;
    }
    return { ok: db, db, time: new Date().toISOString() };
  });
}
