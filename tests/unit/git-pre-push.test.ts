/**
 * Push discipline: the pre-push hook and Cursor shell hook refuse build/main.
 * Pure stdin / JSON — no network, no real push.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const hook = new URL('../../scripts/git-pre-push.sh', import.meta.url);
const cursorHook = new URL('../../.cursor/hooks/deny-protected-push.mjs', import.meta.url);

function prePush(stdin: string) {
  return spawnSync('bash', [hook.pathname], {
    input: stdin,
    encoding: 'utf8',
    cwd: root.pathname,
  });
}

function cursorShell(command: string, head?: string) {
  return spawnSync('node', [cursorHook.pathname], {
    input: JSON.stringify({ command, tool_input: { command } }),
    encoding: 'utf8',
    cwd: root.pathname,
    env: head ? { ...process.env, GIT_PRE_PUSH_HEAD: head } : process.env,
  });
}

describe('scripts/git-pre-push.sh', () => {
  it('allows a feature branch refspec', () => {
    const r = prePush('refs/heads/feature/foo abc123 refs/heads/feature/foo def456\n');
    expect(r.status).toBe(0);
  });

  it('rejects remote build and main', () => {
    expect(prePush('refs/heads/feature/foo abc refs/heads/build def\n').status).toBe(1);
    expect(prePush('refs/heads/feature/foo abc refs/heads/main def\n').status).toBe(1);
  });

  it('rejects pushing local build or main', () => {
    expect(prePush('refs/heads/build abc refs/heads/feature/foo def\n').status).toBe(1);
    expect(prePush('refs/heads/main abc refs/heads/feature/foo def\n').status).toBe(1);
  });

  it('prints the PR reason on reject', () => {
    const r = prePush('refs/heads/hotfix/x abc refs/heads/main def\n');
    expect(r.stderr).toMatch(/open a PR instead/i);
  });
});

describe('Cursor deny-protected-push hook', () => {
  it('allows git push -u origin HEAD on a feature branch', () => {
    const r = cursorShell('git push -u origin HEAD', 'feature/foo');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ permission: 'allow' });
  });

  it('denies origin build / HEAD:main / implicit push on main', () => {
    expect(JSON.parse(cursorShell('git push origin build', 'feature/foo').stdout)).toMatchObject({
      permission: 'deny',
    });
    expect(JSON.parse(cursorShell('git push origin HEAD:main', 'hotfix/x').stdout)).toMatchObject({
      permission: 'deny',
    });
    expect(JSON.parse(cursorShell('git push', 'main').stdout)).toMatchObject({
      permission: 'deny',
    });
  });
});

describe('Claude Code push permissions', () => {
  const settings = JSON.parse(readFileSync(new URL('../../.claude/settings.json', import.meta.url), 'utf8')) as {
    permissions: { allow: string[]; deny: string[] };
  };

  it('does not blanket-deny all git push', () => {
    expect(settings.permissions.deny).not.toContain('Bash(git push:*)');
    expect(settings.permissions.deny).not.toContain('Bash(git push)');
    expect(settings.permissions.allow).toContain('Bash(git push:*)');
  });

  it('denies push of build/main and force', () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        'Bash(git push origin build:*)',
        'Bash(git push origin main:*)',
        'Bash(git push --force:*)',
        'Bash(git push origin HEAD:build:*)',
        'Bash(git push origin HEAD:main:*)',
      ]),
    );
  });
});
