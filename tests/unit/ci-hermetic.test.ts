/**
 * CI / `pnpm test` must stay hermetic: no live vendors, no audit writes, no prod DSN.
 * Pins the contract so a later edit cannot silently re-open those holes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('test baseline is hermetic', () => {
  it('does not write audit rows', () => {
    expect(env.FF_AUDIT_LOG_ENABLED).toBe(false);
  });

  it('does not carry live vendor credentials', () => {
    expect(env.EFS_WSDL_URL).toBe('');
    expect(env.EFS_LOGIN).toBe('');
    expect(env.EFS_PASSWORD).toBe('');
    expect(env.SERVER_CRM_URL).toBe('');
    expect(env.SERVER_CRM_KEY).toBe('');
    expect(env.DWH_DATABASE_URL).toBe('');
    expect(env.OPENAI_API_KEY).toBe('');
    expect(env.TELEGRAM_BOT_TOKEN).toBe('');
    expect(env.ZOHO_CRM_REFRESH_TOKEN).toBe('');
    expect(env.RINGCENTRAL_JWT).toBe('');
    expect(env.FF_MANAGER_EFS_WRITES_ENABLED).toBe(false);
    expect(env.FF_COMPOSIO_ENABLED).toBe(false);
    expect(env.FF_ZOHO_MCP_ENABLED).toBe(false);
    expect(env.FF_JOBS_ENABLED).toBe(false);
  });

  it('keeps the test logger silent', () => {
    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('silent');
  });
});

describe('vitest.config isolates the suite from prod', () => {
  const config = read('../../vitest.config.ts');

  it('does not inherit a developer MYTRION_OPS_DATABASE_URL', () => {
    expect(config).toMatch(/process\.env\.CI === 'true'/);
    expect(config).toMatch(/VITEST_DATABASE_URL/);
    expect(config).not.toMatch(
      /const TEST_DATABASE_URL =\s*process\.env\.MYTRION_OPS_DATABASE_URL \?\?/,
    );
  });

  it('pins audit off and blanks EFS / servercrm', () => {
    expect(config).toMatch(/FF_AUDIT_LOG_ENABLED: '0'/);
    expect(config).toMatch(/EFS_LOGIN: ''/);
    expect(config).toMatch(/SERVER_CRM_URL: ''/);
  });
});

describe('CI workflow stays code-only', () => {
  const ci = read('../../.github/workflows/ci.yml');

  it('does not run live evals or job workers', () => {
    expect(ci).not.toMatch(/eval:live/);
    expect(ci).not.toMatch(/audit:mobile|audit:shots/);
    expect(ci).toMatch(/FF_JOBS_ENABLED: '0'/);
    expect(ci).toMatch(/EFS_LOGIN: ''/);
  });

  it('gates conventional commits, file size, and the mini-app bundle', () => {
    expect(ci).toMatch(/check-conventional-commits\.sh/);
    expect(ci).toMatch(/check-file-size\.sh/);
    expect(ci).toMatch(/apps\/mini-app\/src\//);
    expect(ci).toMatch(/apps\/mini-app\/app\//);
  });
});
