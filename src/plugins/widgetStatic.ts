import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';

// Locate <repo>/apps/mytrion-crm/app robustly across layouts (tsx-dev = src/plugins, prod =
// dist/plugins, plus a cwd fallback and a WIDGET_DIR override) so a deploy whose CWD differs still
// finds the build.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WIDGET_DIR_CANDIDATES = [
  process.env.WIDGET_DIR,
  path.resolve(HERE, '..', '..', 'apps', 'mytrion-crm', 'app'),
  path.resolve(process.cwd(), 'apps', 'mytrion-crm', 'app'),
].filter((d): d is string => Boolean(d));

export function resolveWidgetDir(): string | null {
  for (const dir of WIDGET_DIR_CANDIDATES) {
    if (existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

/**
 * Serve the built AI Chat widget (apps/mytrion-crm/app) under /widget so the UI lives same-origin
 * with the API. Same-origin is the whole point: the widget's direct (live-token) streaming fetch
 * then needs no CORS allowlisting at all. The files are public on purpose — they hold no secrets
 * (the backend key comes from a Zoho org variable at runtime). No-op when the build is absent
 * (dev/test, or the API deployed without first building apps/mytrion-crm/).
 *
 * Encapsulated so its single hook only touches /widget responses. helmet applies global headers
 * that would block a cross-origin iframe; for /widget only we relax them so Zoho CRM can embed the
 * widget while the API keeps its hardened defaults:
 *   - X-Frame-Options: SAMEORIGIN  → removed (the actual iframe blocker; no CSP frame-ancestors is set)
 *   - Cross-Origin-Resource-Policy: same-origin → cross-origin (in case the embedder enables COEP)
 * helmet writes these straight onto the raw Node response, so we operate on reply.raw.
 */
export async function registerWidgetStatic(app: FastifyInstance): Promise<void> {
  const widgetDir = resolveWidgetDir();
  if (!widgetDir) {
    logger.warn(
      { tried: WIDGET_DIR_CANDIDATES },
      'widget build not found — /widget static host disabled (did the deploy run `pnpm --dir apps/mytrion-crm build`?)',
    );
    return;
  }

  await app.register(async (scope) => {
    // Make /widget embeddable in the (cross-origin) Zoho CRM iframe. To tighten later, set a scoped
    // CSP frame-ancestors listing your exact Zoho data-center domain instead of removing XFO outright.
    scope.addHook('onSend', async (_req, reply) => {
      reply.removeHeader('X-Frame-Options');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      if (!reply.raw.headersSent) {
        reply.raw.removeHeader('X-Frame-Options');
        reply.raw.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
    });
    await scope.register(fastifyStatic, {
      root: widgetDir,
      // Serve the worker portal at the ROOT so the domain itself is the Mytrion Ops gate
      // (login → Zoho OAuth → CRM). The SPA's router lives at '/' + '/m/:mytrion' and its assets
      // are relative (vite base './'), so it must run at root, not a sub-path. Deep-link/refresh
      // fallback to index.html for non-API GETs is handled by the not-found handler (errorHandler).
      prefix: '/',
      index: ['index.html'],
      // index.html must revalidate so a redeploy is picked up; vite's hashed assets cache hard.
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
  });

  logger.info({ dir: widgetDir }, 'serving Mytrion Ops portal at / (root)');
}
