import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      CREDIT_PLATFORM_BASE_URL: 'https://cp.test',
      CREDIT_PLATFORM_API_KEY: 'cp-key',
      CREDIT_PLATFORM_ANALYST_API_KEY: 'analyst-key',
    },
  };
});

import {
  claimManualReview,
  parseBankStatements,
  releaseManualReview,
  runIsoftpullAll,
} from '../../src/integrations/creditPlatformClient.js';

function okJson(): Response {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('credit-platform queue HTTP wrappers', () => {
  it('claims and releases on the existing manual-review routes', async () => {
    fetchMock.mockResolvedValue(okJson());
    await claimManualReview('req-1', 'Ada', 'taking');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cp.test/api/v1/manual-review/req-1/claim');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ note: 'taking' });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-User-Name': 'Ada',
      'X-User-Role': 'analyst',
    });

    await releaseManualReview('req-1', 'Ada');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://cp.test/api/v1/manual-review/req-1/release');
  });

  it('parses bank statements and runs iSoftPull all over HTTP', async () => {
    fetchMock.mockResolvedValue(okJson());
    await parseBankStatements('req-1', [11, 12], 'Ada');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://cp.test/api/v1/manual-review/req-1/decision-desk/plaid-bs/parse',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      attachment_ids: [11, 12],
    });

    await runIsoftpullAll('req-1', 'Ada');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://cp.test/api/v1/requests/req-1/decision-desk/stages/isoftpull/run-all',
    );
  });
});
