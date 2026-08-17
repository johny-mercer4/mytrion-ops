/**
 * Deploy recovery: reload once when the build id changes, never loop, never treat
 * Vite-dev or a failed index fetch as a new build.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkDeployedBuild,
  extractIndexBuildId,
  installStaleBuildReload,
  normalizeAssetRef,
  staleBuildDecision,
} from './staleBuildReload';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractIndexBuildId', () => {
  it('reads octane-build meta and ignores Telegram / inline scripts', () => {
    const html = `<!doctype html><html><head>
      <meta name="octane-build" content="abc123def456">
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script type="module" crossorigin src="./assets/index.js"></script>
      <link rel="stylesheet" href="./assets/index.css">
    </head></html>`;
    expect(extractIndexBuildId(html)).toBe('abc123def456');
  });

  it('reads __OCTANE_BUILD__ from the hashless entry', () => {
    expect(extractIndexBuildId('window.__OCTANE_BUILD__="deadbeefcafebabe";import"./x.js"')).toBe(
      'deadbeefcafebabe',
    );
  });

  it('reads a legacy hashed Vite entry', () => {
    const html = `<!doctype html><html><head>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script type="module" crossorigin src="./assets/index-CJPDZUwI.js"></script>
      <link rel="stylesheet" href="./assets/index-BluM44iZ.css">
    </head></html>`;
    expect(extractIndexBuildId(html)).toBe('assets/index-CJPDZUwI.js');
  });

  it('returns null for Vite dev (src/main.tsx) so local HMR never reloads', () => {
    expect(
      extractIndexBuildId('<script type="module" src="/src/main.tsx"></script>'),
    ).toBeNull();
  });

  it('does not treat a stable assets/index.js path as a build id', () => {
    expect(
      extractIndexBuildId('<script type="module" src="./assets/index.js"></script>'),
    ).toBeNull();
  });
});

describe('normalizeAssetRef', () => {
  it('collapses ./ / and absolute URLs to the same id', () => {
    expect(normalizeAssetRef('./assets/index-Abc.js')).toBe('assets/index-Abc.js');
    expect(normalizeAssetRef('/assets/index-Abc.js')).toBe('assets/index-Abc.js');
    expect(normalizeAssetRef('https://ops.example/assets/index-Abc.js')).toBe(
      'assets/index-Abc.js',
    );
  });
});

describe('staleBuildDecision', () => {
  it('reloads only when the build id changed and we have not already tried', () => {
    expect(staleBuildDecision('old-id', 'new-id', false)).toBe('reload');
    expect(staleBuildDecision('old-id', 'new-id', true)).toBe('skip');
    expect(staleBuildDecision('same-id', 'same-id', false)).toBe('skip');
    expect(staleBuildDecision('old-id', null, false)).toBe('skip');
    expect(staleBuildDecision(null, 'new-id', false)).toBe('skip');
  });
});

describe('checkDeployedBuild', () => {
  it('reloads when the deployed index meta points at a new build', async () => {
    await expect(
      checkDeployedBuild({
        current: 'old-id',
        alreadyReloaded: false,
        fetchHtml: async () => '<meta name="octane-build" content="new-id">',
      }),
    ).resolves.toBe('reload');
  });

  it('reloads when the hashless entry JS has a new __OCTANE_BUILD__', async () => {
    await expect(
      checkDeployedBuild({
        current: 'old-id',
        alreadyReloaded: false,
        fetchHtml: async () => '<script type="module" src="./assets/index.js"></script>',
        fetchEntry: async () => 'window.__OCTANE_BUILD__="new-id";',
      }),
    ).resolves.toBe('reload');
  });

  it('reloads when the deployed index points at a new hashed entry', async () => {
    await expect(
      checkDeployedBuild({
        current: 'assets/index-Old.js',
        alreadyReloaded: false,
        fetchHtml: async () =>
          '<script type="module" src="./assets/index-New.js"></script>',
      }),
    ).resolves.toBe('reload');
  });

  it('does not fetch index.html on install (avoids the Home HTTP/2 burst)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const stop = installStaleBuildReload();
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it('skips a network miss instead of looping', async () => {
    await expect(
      checkDeployedBuild({
        current: 'old-id',
        alreadyReloaded: false,
        fetchHtml: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    ).resolves.toBe('skip');
  });
});
