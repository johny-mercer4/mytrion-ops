/**
 * CMP MySQL SSH tunnel — on-demand local port forward for local dev.
 *
 * RDS lives in a private VPC; local dev reaches it via bastion SSH (see scripts/db-tunnel.sh).
 * `pnpm dev:all` starts the tunnel alongside the API, but when the API runs alone the Admin →
 * CMP Database tab triggers `ensureCmpTunnel()` before schema queries so metadata loads without
 * a manual `ssh -N -L …`.
 */
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { type ChildProcess, spawn } from 'node:child_process';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface CmpTunnelStatus {
  /** True when the local forward port accepts connections (or tunnel mode is off). */
  ready: boolean;
  /** True when this call started a new ssh process. */
  started: boolean;
  message: string;
}

let tunnelProcess: ChildProcess | null = null;
let inflight: Promise<CmpTunnelStatus> | null = null;

function expandHome(path: string): string {
  return path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path;
}

function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/** True when MYSQL_SSH_* + MYSQL_DB_* are set — tunnel mode is available. */
export function isCmpTunnelConfigured(): boolean {
  return Boolean(env.MYSQL_SSH_HOST && env.MYSQL_SSH_USER && env.MYSQL_DB_HOST);
}

/** True when the app dials a local forward and should auto-start SSH when the port is down. */
export function cmpTunnelRequired(): boolean {
  if (!isCmpTunnelConfigured()) return false;
  return isLocalHost(env.AWS_MYSQL_HOST);
}

function isPortOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function keyReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function killTunnel(): void {
  if (!tunnelProcess) return;
  tunnelProcess.kill();
  tunnelProcess = null;
}

function spawnTunnel(keyPath: string, localPort: number): ChildProcess {
  const args = [
    '-i',
    keyPath,
    '-p',
    String(env.MYSQL_SSH_PORT),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-N',
    '-L',
    `${localPort}:${env.MYSQL_DB_HOST}:${env.MYSQL_DB_PORT}`,
    `${env.MYSQL_SSH_USER}@${env.MYSQL_SSH_HOST}`,
  ];
  const child = spawn('ssh', args, { stdio: 'ignore' });
  child.on('exit', (code, signal) => {
    logger.info({ code, signal }, 'CMP SSH tunnel exited');
    if (tunnelProcess === child) tunnelProcess = null;
  });
  child.on('error', (err) => {
    logger.warn({ err: err.message }, 'CMP SSH tunnel process error');
    if (tunnelProcess === child) tunnelProcess = null;
  });
  return child;
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen('127.0.0.1', port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function runEnsure(): Promise<CmpTunnelStatus> {
  if (!cmpTunnelRequired()) {
    return { ready: true, started: false, message: 'Direct connect — SSH tunnel not required.' };
  }

  const localPort = env.MYSQL_DB_LOCAL_PORT;
  if (await isPortOpen('127.0.0.1', localPort)) {
    return { ready: true, started: false, message: 'SSH tunnel already up.' };
  }

  const keyPath = expandHome(env.MYSQL_SSH_KEYFILE);
  if (!env.MYSQL_SSH_KEYFILE || !(await keyReadable(keyPath))) {
    return {
      ready: false,
      started: false,
      message: `SSH key not found at ${env.MYSQL_SSH_KEYFILE || '(unset)'} — place your dbtunnel key and retry.`,
    };
  }

  let started = false;
  if (!tunnelProcess || tunnelProcess.exitCode !== null) {
    tunnelProcess = spawnTunnel(keyPath, localPort);
    started = true;
    logger.info(
      { localPort, rds: env.MYSQL_DB_HOST, bastion: env.MYSQL_SSH_HOST },
      'CMP SSH tunnel starting',
    );
  }

  const ready = await waitForPort(localPort, 20_000);
  if (!ready) {
    killTunnel();
    return {
      ready: false,
      started,
      message:
        'SSH tunnel did not become ready — check MYSQL_SSH_* / MYSQL_DB_* in .env and that the bastion key is valid.',
    };
  }

  return { ready: true, started, message: started ? 'SSH tunnel connected.' : 'SSH tunnel ready.' };
}

/** Ensure the local CMP MySQL forward is up before cmpDb connects. No-op when not in tunnel mode. */
export function ensureCmpTunnel(): Promise<CmpTunnelStatus> {
  if (!inflight) {
    inflight = runEnsure().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Stop a tunnel this process started (dev shutdown / tests). */
export function closeCmpTunnel(): void {
  killTunnel();
}
