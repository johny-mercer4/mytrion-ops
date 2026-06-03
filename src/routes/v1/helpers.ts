import type { FastifyRequest } from 'fastify';
import { AuthError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Narrow request.ctx to non-null after the `authenticate` guard has run. */
export function requireContext(request: FastifyRequest): TenantContext {
  if (!request.ctx) throw new AuthError('Authentication required');
  return request.ctx;
}
