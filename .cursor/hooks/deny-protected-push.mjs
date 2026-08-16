#!/usr/bin/env node
/**
 * Cursor preToolUse / beforeShellExecution: refuse git push of build/main.
 * Fail open on malformed input so a hook bug cannot freeze the agent.
 * The git pre-push hook is the backstop if this miss-parses a command.
 */
import { execSync } from 'node:child_process';

const REASON = 'Refusing push to build/main — open a PR instead.';
const PROTECTED = new Set(['build', 'main']);
const FLAGS_TAKE_VALUE = new Set([
  '-o',
  '--push-option',
  '--repo',
  '--receive-pack',
  '--exec',
]);

function done(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function allow() {
  done({ permission: 'allow' });
}

function deny() {
  done({ permission: 'deny', user_message: REASON, agent_message: REASON });
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function commandFrom(event) {
  if (typeof event.command === 'string') return event.command;
  const input = event.tool_input;
  if (input && typeof input === 'object') {
    if (typeof input.command === 'string') return input.command;
    if (typeof input.commandLine === 'string') return input.commandLine;
  }
  return '';
}

function destName(refspec) {
  const raw = String(refspec).replace(/^\+/, '');
  const dest = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  return dest.replace(/^refs\/heads\//, '');
}

function currentBranch() {
  if (process.env.GIT_PRE_PUSH_HEAD) return process.env.GIT_PRE_PUSH_HEAD;
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function pushRefspecs(tokens) {
  const gitIdx = tokens.findIndex((t) => t === 'git' || t.endsWith('/git'));
  if (gitIdx < 0) return null;
  const pushIdx = tokens.indexOf('push', gitIdx + 1);
  if (pushIdx < 0) return null;
  const args = tokens.slice(pushIdx + 1);
  const refs = [];
  let i = 0;
  let sawRepo = false;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('-')) {
      const flag = a.split('=')[0];
      if (!a.includes('=') && FLAGS_TAKE_VALUE.has(flag)) i += 2;
      else i += 1;
      continue;
    }
    if (!sawRepo) {
      sawRepo = true;
      i += 1;
      continue;
    }
    refs.push(a);
    i += 1;
  }
  return refs;
}

function shouldDeny(command) {
  const refs = pushRefspecs(command.trim().split(/\s+/));
  if (refs === null) return false;
  if (refs.length === 0) return PROTECTED.has(currentBranch());
  for (const spec of refs) {
    const dest = destName(spec);
    if (dest === 'HEAD' || dest === '') {
      if (PROTECTED.has(currentBranch())) return true;
      continue;
    }
    if (PROTECTED.has(dest)) return true;
  }
  return false;
}

const raw = await readStdin();
let event = {};
try {
  event = raw ? JSON.parse(raw) : {};
} catch {
  allow();
}
const command = commandFrom(event);
if (!command || !shouldDeny(command)) allow();
deny();
