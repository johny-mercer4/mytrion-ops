import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { newPrefixedId } from '../lib/ids.js';
import type { TenantContext } from '../types/tenantContext.js';

interface RequestStore {
  requestId: string;
  ctx: TenantContext | null;
}

/**
 * AsyncLocalStorage carrying per-request id + security context, so deep code
 * (audit logger, cost tracker) can read it without threading it through every call.
 */
const store = new AsyncLocalStorage<RequestStore>();

export function getRequestStore(): RequestStore | undefined {
  return store.getStore();
}

export function getCurrentRequestId(): string | undefined {
  return store.getStore()?.requestId;
}

export function getCurrentContext(): TenantContext | null {
  return store.getStore()?.ctx ?? null;
}

export function setCurrentContext(ctx: TenantContext): void {
  const current = store.getStore();
  if (current) current.ctx = ctx;
}

export function requestContextPlugin(app: FastifyInstance): void {
  app.decorateRequest('requestId', '');
  app.decorateRequest('ctx', null);

  app.addHook('onRequest', (request, reply, done) => {
    const headerId = request.headers['x-request-id'];
    const requestId = typeof headerId === 'string' && headerId.length > 0 ? headerId : newPrefixedId('req');
    request.requestId = requestId;
    void reply.header('x-request-id', requestId);
    // enterWith binds the store for the remainder of this request's async chain.
    store.enterWith({ requestId, ctx: null });
    done();
  });
}
