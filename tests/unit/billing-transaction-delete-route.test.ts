/**
 * DELETE /billing/transactions/:id — hard-delete a manually-entered Chase transaction.
 *
 * Route-level: the permission decision itself is unit-tested in payment-delete-access.test.ts;
 * this file pins that the ROUTE wires it correctly — admin/granted-only, Chase-only, unmapped-only,
 * and that a delete is audited with a full row snapshot (the only remaining record once the row is
 * actually gone).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { txRepo, grantRepo, auditFromContextMock, resolveWorkerAccessMock } = vi.hoisted(() => ({
  txRepo: { getById: vi.fn(), deleteIfUnmapped: vi.fn() },
  grantRepo: { isGranted: vi.fn() },
  auditFromContextMock: vi.fn(async (_ctx: unknown, _fields: { action: string; [k: string]: unknown }) => undefined),
  resolveWorkerAccessMock: vi.fn(),
}));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({ paymentTransactionRepo: txRepo }));
vi.mock('../../src/repos/paymentDeleteGrantRepo.js', () => ({ paymentDeleteGrantRepo: grantRepo }));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: auditFromContextMock };
});
// contextFromClaims re-derives ctx.role/departments from this resolver on EVERY request (the JWT's
// own role claim is ignored except for the profile-marker admin check) — a plain 'worker' token
// would otherwise 403 at the billing-department gate before ever reaching the delete-grant check
// this file exists to test. Admin cases still work via the 'Administrator' profile marker below.
vi.mock('../../src/modules/access/mytrionAccessService.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/access/mytrionAccessService.js')>();
  return { ...mod, mytrionAccessService: { ...mod.mytrionAccessService, resolveWorkerAccess: resolveWorkerAccessMock } };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

async function tokenFor(opts: { role: 'admin' | 'worker'; zohoUserId: string }): Promise<string> {
  return signAccessToken({
    userId: `zoho:${opts.zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: opts.role,
    worker: {
      zohoUserId: opts.zohoUserId,
      userName: 'Test Billing Worker',
      profile: opts.role === 'admin' ? 'Administrator' : 'Standard',
    },
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const chaseTx = { id: 700, source: 'chase', isInvoiceMapped: false, amount: '100.00' };

function del(id: number, token: string) {
  return app.inject({ method: 'DELETE', url: `/v1/billing/transactions/${id}`, headers: auth(token) });
}

beforeEach(() => {
  vi.clearAllMocks();
  txRepo.getById.mockResolvedValue(chaseTx as never);
  txRepo.deleteIfUnmapped.mockResolvedValue(chaseTx as never);
  grantRepo.isGranted.mockResolvedValue(false);
  // Plain worker, billing department access, NOT all-department — reaches requireBillingWrite fine,
  // so the only remaining gate the "worker" test cases exercise is the delete-specific grant check.
  resolveWorkerAccessMock.mockResolvedValue({
    accessibleMytrions: ['billing'],
    homeMytrion: 'billing',
    allDepartmentAccess: false,
    departments: ['billing'],
    viewAsUserIds: [],
    mytrionAccessModes: {},
    mytrionTabGrants: {},
  });
});

describe('admin', () => {
  it('deletes an unmapped Chase row and audits a full snapshot', async () => {
    const res = await del(700, await tokenFor({ role: 'admin', zohoUserId: '1' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success' });
    expect(txRepo.deleteIfUnmapped).toHaveBeenCalledWith(700);
    expect(grantRepo.isGranted).not.toHaveBeenCalled(); // admin never needs the grant table
    expect(auditFromContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'billing.transactions.delete',
        status: 'ok',
        resourceId: '700',
        detail: { deletedRow: chaseTx },
      }),
    );
  });
});

describe('non-admin without a grant', () => {
  it('403s and never touches the row', async () => {
    const res = await del(700, await tokenFor({ role: 'worker', zohoUserId: '12345' }));
    expect(res.statusCode).toBe(403);
    expect(txRepo.deleteIfUnmapped).not.toHaveBeenCalled();
  });

  it('checked the grant table with the BARE zoho user id, not the "zoho:" prefixed one', async () => {
    await del(700, await tokenFor({ role: 'worker', zohoUserId: '12345' }));
    expect(grantRepo.isGranted).toHaveBeenCalledWith('12345', 'chase');
  });
});

describe('non-admin WITH a grant', () => {
  it('deletes successfully', async () => {
    grantRepo.isGranted.mockResolvedValue(true);
    const res = await del(700, await tokenFor({ role: 'worker', zohoUserId: '12345' }));
    expect(res.statusCode).toBe(200);
    expect(txRepo.deleteIfUnmapped).toHaveBeenCalledWith(700);
  });

  it('is scoped by source — a grant for a DIFFERENT source does not unlock chase', async () => {
    grantRepo.isGranted.mockResolvedValue(false); // repo itself would only match source='chase' rows
    const res = await del(700, await tokenFor({ role: 'worker', zohoUserId: '12345' }));
    expect(res.statusCode).toBe(403);
  });
});

describe('safety guards', () => {
  it('refuses to delete a non-Chase transaction even for an admin', async () => {
    txRepo.getById.mockResolvedValue({ ...chaseTx, source: 'zelle' } as never);
    const res = await del(700, await tokenFor({ role: 'admin', zohoUserId: '1' }));
    expect(res.statusCode).toBe(400);
    expect(txRepo.deleteIfUnmapped).not.toHaveBeenCalled();
  });

  it('refuses to delete a still-MAPPED transaction — must unmap first', async () => {
    txRepo.getById.mockResolvedValue({ ...chaseTx, isInvoiceMapped: true } as never);
    const res = await del(700, await tokenFor({ role: 'admin', zohoUserId: '1' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.json().error).toBeDefined();
    expect(txRepo.deleteIfUnmapped).not.toHaveBeenCalled();
  });

  it('404s a missing transaction', async () => {
    txRepo.getById.mockResolvedValue(undefined);
    const res = await del(999, await tokenFor({ role: 'admin', zohoUserId: '1' }));
    expect(res.statusCode).toBe(404);
  });

  it('surfaces a lost race (deleteIfUnmapped found nothing) as a 400, not a false success', async () => {
    txRepo.deleteIfUnmapped.mockResolvedValue(undefined);
    const res = await del(700, await tokenFor({ role: 'admin', zohoUserId: '1' }));
    expect(res.statusCode).toBe(400);
    expect(auditFromContextMock).not.toHaveBeenCalled();
  });
});
