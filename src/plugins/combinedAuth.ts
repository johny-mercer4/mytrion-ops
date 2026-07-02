/**
 * Combined inbound auth for caller-facing routes: accept a verified WORKER SESSION (Zoho OAuth
 * Bearer JWT → request.ctx carries the verified identity) OR the static API_KEY (system identity,
 * for server-to-server + the pre-login/same-origin widget). A Bearer that isn't a valid session
 * falls through to the API-key check (which itself accepts `Authorization: Bearer <API_KEY>`), so
 * existing callers keep working.
 *
 * Registered AFTER authPlugin + apiKeyAuthPlugin (both decorations must already exist).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export function combinedAuthPlugin(app: FastifyInstance): void {
  app.decorate(
    'sessionOrApiKey',
    async function sessionOrApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const header = request.headers.authorization;
      if (header && header.startsWith('Bearer ')) {
        try {
          await app.authenticate(request, reply); // session JWT → verified ctx
          return;
        } catch {
          // Not a valid session token — may be the API key presented as a bearer; fall through.
        }
      }
      await app.apiKeyAuth(request, reply); // static API_KEY → system identity
    },
  );
}
