import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';

// Locate <repo>/apps/mini-app/app across layouts (tsx-dev = src/plugins, prod = dist/plugins, cwd
// fallback, MINI_APP_DIR override) — same resolver shape as the widget's.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MINI_APP_DIR_CANDIDATES = [
  process.env.MINI_APP_DIR,
  path.resolve(HERE, '..', '..', 'apps', 'mini-app', 'app'),
  path.resolve(process.cwd(), 'apps', 'mini-app', 'app'),
].filter((d): d is string => Boolean(d));

export function resolveMiniAppDir(): string | null {
  for (const dir of MINI_APP_DIR_CANDIDATES) {
    if (existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

/**
 * Serve the built Telegram carrier onboarding mini-app (apps/mini-app/app) under /mini-app so it
 * lives SAME-ORIGIN with the API — the mini-app's fetches to /v1/* then need no CORS allowlisting,
 * and BotFather's Main App URL is just <origin>/mini-app/. The files are public (they hold no
 * secrets). No-op when the build is absent (dev/test, or a deploy that didn't build apps/mini-app).
 *
 * Telegram opens the mini-app inside its own webview, so — like the widget — we drop the global
 * X-Frame-Options and relax Cross-Origin-Resource-Policy for these responses only.
 */
export async function registerMiniAppStatic(app: FastifyInstance): Promise<void> {
  const miniAppDir = resolveMiniAppDir();
  if (!miniAppDir) {
    logger.warn(
      { tried: MINI_APP_DIR_CANDIDATES },
      'mini-app build not found — /mini-app static host disabled (did the deploy run `pnpm --dir apps/mini-app build`?)',
    );
    return;
  }

  await app.register(async (scope) => {
    scope.addHook('onSend', async (_req, reply) => {
      reply.removeHeader('X-Frame-Options');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      if (!reply.raw.headersSent) {
        reply.raw.removeHeader('X-Frame-Options');
        reply.raw.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
    });
    await scope.register(fastifyStatic, {
      root: miniAppDir,
      prefix: '/mini-app/',
      index: ['index.html'],
      // index.html must revalidate so a redeploy is picked up; vite's hashed assets cache hard.
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
    // Bare /mini-app → /mini-app/ so the index resolves.
    scope.get('/mini-app', async (_req, reply) => reply.redirect('/mini-app/'));
  });

  logger.info({ dir: miniAppDir }, 'serving carrier mini-app at /mini-app/');
}
