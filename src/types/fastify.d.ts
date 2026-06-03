import 'fastify';
import type { Audience, Role, TenantContext } from './tenantContext.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation id for this request (also echoed as the x-request-id header). */
    requestId: string;
    /** Security context, populated by the `authenticate` decorator. Null until then. */
    ctx: TenantContext | null;
  }

  interface FastifyInstance {
    /** onRequest/preHandler guard: verifies the Bearer token and sets request.ctx. */
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** preHandler factory: requires the authenticated user to hold one of these roles. */
    requireRole(...roles: Role[]): preHandlerHookHandler;
    /** preHandler factory: requires the authenticated user's scopes to include `scope`. */
    requireScope(scope: string): preHandlerHookHandler;
    /** preHandler factory: requires the authenticated user's audience to match. */
    requireAudience(...audiences: Audience[]): preHandlerHookHandler;
  }
}
