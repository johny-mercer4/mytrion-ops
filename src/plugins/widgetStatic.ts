import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';

// Resolve <repo>/web/app from this file's location (works under both tsx-dev and `node dist`):
// dev   → <repo>/src/plugins/widgetStatic.ts  → ../../web/app
// prod  → <repo>/dist/plugins/widgetStatic.js  → ../../web/app
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_DIR = path.resolve(HERE, '..', '..', 'web', 'app');

/**
 * Serve the built AI Chat widget (web/app) under /widget so the UI lives same-origin with the API.
 * Same-origin is the whole point: the widget's direct (live-token) streaming fetch then needs no
 * CORS allowlisting at all. The files are public on purpose — they hold no secrets (the backend key
 * comes from a Zoho org variable at runtime). No-op when the build is absent (dev/test, or the API
 * deployed without first building web/).
 *
 * Encapsulated so its single hook only touches /widget responses: helmet sets a global
 * X-Frame-Options: SAMEORIGIN, which would blank the widget inside Zoho's cross-origin iframe — we
 * strip it here (and only here) so CRM can embed the widget while the API keeps its frame guard.
 */
export async function registerWidgetStatic(app: FastifyInstance): Promise<void> {
  if (!existsSync(path.join(WIDGET_DIR, 'index.html'))) {
    logger.info({ dir: WIDGET_DIR }, 'widget build not found — /widget static host disabled');
    return;
  }

  await app.register(async (scope) => {
    // Allow embedding in the Zoho CRM iframe. helmet writes X-Frame-Options: SAMEORIGIN straight
    // onto the raw Node response, so reply.removeHeader() can't see it — strip it off reply.raw.
    // To tighten later, set a scoped CSP frame-ancestors listing your Zoho data-center domain.
    scope.addHook('onSend', async (_req, reply) => {
      reply.removeHeader('X-Frame-Options');
      if (!reply.raw.headersSent) reply.raw.removeHeader('X-Frame-Options');
    });
    await scope.register(fastifyStatic, {
      root: WIDGET_DIR,
      prefix: '/widget/',
      index: ['index.html'],
      // index.html must revalidate so a redeploy is picked up; vite's hashed assets cache hard.
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
    // Bare /widget → /widget/ so the index resolves.
    scope.get('/widget', async (_req, reply) => reply.redirect('/widget/'));
  });

  logger.info({ dir: WIDGET_DIR }, 'serving AI Chat widget at /widget/');
}
