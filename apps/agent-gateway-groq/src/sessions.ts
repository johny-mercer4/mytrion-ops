import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import {
  completeModel,
  safetyIdentifierForChat,
  type ModelCompletion,
  type ModelMessage,
} from './modelProvider.js';
import { systemPrompt } from './prompt.js';
import { startTypingKeepAlive } from './telegram.js';
import { buildTelegramTools } from './telegramTools.js';
import { toolDispatcher } from './toolRuntime.js';
import { greetingText, selectAiToolPlan, type AiRouteDecision } from './aiRouter.js';
import { buildOctaneTools } from './tools.js';
import { incrementCounter, turnEnqueued, type TurnLifecycle } from './metrics.js';
import {
  acquireTurnSlot,
  maxConcurrentTurns,
  releaseTurnSlot,
} from './turnConcurrency.js';
import { isServiceEnabled, serviceUnavailableText } from './serviceRegistry.js';
import {
  enqueueSupportMemoryCommit,
  recallSupportMemory,
} from './supportMemory.js';
import {
  capabilitySummaryText,
  filterToolsForRole,
  isToolAllowedForRole,
  roleDeniedText,
  type GatewayRole,
} from './skillRegistry.js';
import { zeroTokenOutcome } from './turnOutcome.js';

export { maxConcurrentTurns } from './turnConcurrency.js';

const SESSIONS_FILE = 'data/openai-sessions.json';
const LEGACY_SESSIONS_FILE = 'data/groq-sessions.json';
const MAX_TURNS = Number(process.env['SESSION_MAX_TURNS'] ?? '40');
const MAX_AGE_MS = Number(process.env['SESSION_MAX_AGE_H'] ?? '24') * 3600_000;
const MAX_HISTORY_MESSAGES = Number(process.env['SESSION_HISTORY_MESSAGES'] ?? '24');
const QUIET_GAP_MS = 10 * 60_000;
const MAX_MODEL_STEPS = 8;
const MAX_PENDING_TURNS = positiveInt('MAX_PENDING_TURNS', 2_000);
const MAX_PENDING_PER_USER = positiveInt('MAX_PENDING_PER_USER', 5);

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SessMeta {
  startedAt: number;
  lastAt: number;
  turns: number;
  messages: StoredMessage[];
}

export type SessionKey = string;
export function sessionKey(chatId: number, userId: number): SessionKey {
  return `${chatId}:${userId}`;
}

const sessions = new Map<SessionKey, SessMeta>();

function loadSessions(): void {
  const sourceFile = existsSync(SESSIONS_FILE) ? SESSIONS_FILE : LEGACY_SESSIONS_FILE;
  try {
    const raw: unknown = JSON.parse(readFileSync(sourceFile, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as Partial<SessMeta>;
      if (
        typeof candidate.startedAt !== 'number' ||
        typeof candidate.lastAt !== 'number' ||
        typeof candidate.turns !== 'number' ||
        !Array.isArray(candidate.messages)
      ) {
        continue;
      }
      const messages = candidate.messages.filter(isStoredMessage).slice(-MAX_HISTORY_MESSAGES);
      // Bare numeric keys are legacy per-chat histories. They intentionally do not match a
      // per-user key, so the first isolated user thread starts fresh without cross-user context.
      sessions.set(key, { ...candidate, messages } as SessMeta);
    }
    if (sourceFile === LEGACY_SESSIONS_FILE) {
      schedulePersist();
      console.log(
        `[sessions] Migrated ${sessions.size} chat histories to ${SESSIONS_FILE}`,
      );
    }
  } catch {
    // First boot or a corrupt optional history file: start clean.
  }
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  );
}

const PERSIST_DEBOUNCE_MS = 500;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;
let persistChain: Promise<void> = Promise.resolve();

async function flushPersist(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (!persistDirty) return persistChain;
  persistDirty = false;
  const snapshot = JSON.stringify(Object.fromEntries(sessions), null, 1);
  persistChain = persistChain
    .then(async () => {
      await mkdir('data', { recursive: true });
      const temporary = `${SESSIONS_FILE}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, SESSIONS_FILE);
    })
    .catch((error: unknown) => {
      schedulePersist();
      console.error(
        '[sessions] persist failed',
        error instanceof Error ? error.message : String(error),
      );
    });
  return persistChain;
}

function schedulePersist(): void {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => void flushPersist(), PERSIST_DEBOUNCE_MS);
  persistTimer.unref();
}

loadSessions();

function sweepStaleSessions(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;
  for (const [key, meta] of sessions) {
    if (meta.lastAt < cutoff) {
      sessions.delete(key);
      removed += 1;
    }
  }
  if (removed) schedulePersist();
}

sweepStaleSessions();
setInterval(sweepStaleSessions, 60 * 60_000).unref();
process.once('beforeExit', () => void flushPersist());

function historyFor(key: SessionKey): StoredMessage[] {
  const meta = sessions.get(key);
  if (!meta) return [];
  const now = Date.now();
  const due = meta.turns >= MAX_TURNS || now - meta.startedAt > MAX_AGE_MS;
  if (due && now - meta.lastAt >= QUIET_GAP_MS) {
    console.log(
      `[thread ${key}] OpenAI history rotated (turns=${meta.turns}, ageH=${(
        (now - meta.startedAt) /
        3600_000
      ).toFixed(1)})`,
    );
    sessions.delete(key);
    schedulePersist();
    return [];
  }
  return meta.messages;
}

/** Small read-only history view used by the semantic ingress router. */
export function routingHistoryFor(
  chatId: number,
  userId: number,
): StoredMessage[] {
  return historyFor(sessionKey(chatId, userId)).slice(-8).map((message) => ({
    ...message,
  }));
}

function saveTurn(key: SessionKey, user: string, assistant: string): void {
  const now = Date.now();
  const existing = sessions.get(key) ?? {
    startedAt: now,
    lastAt: now,
    turns: 0,
    messages: [],
  };
  existing.lastAt = now;
  existing.turns += 1;
  existing.messages.push(
    { role: 'user', content: user.slice(0, 5000) },
    { role: 'assistant', content: assistant.slice(0, 5000) },
  );
  existing.messages = existing.messages.slice(-MAX_HISTORY_MESSAGES);
  sessions.set(key, existing);
  schedulePersist();
}

/** One user remains ordered; different users in the same company group may run concurrently. */
const chains = new Map<SessionKey, Promise<void>>();
const pendingByUser = new Map<SessionKey, number>();
let pendingTurns = 0;

export type TurnContent = string | Array<Record<string, unknown>>;

export interface TurnStats {
  durationMs: number;
  numTurns: number;
  usage: Record<string, unknown> | null;
  isError: boolean;
  queueWaitMs?: number;
  totalMs?: number;
  sendMs?: number;
  errMsg?: string;
}

export function queueSnapshot(): {
  total: number;
  users: number;
  maxConcurrent: number;
} {
  return {
    total: pendingTurns,
    users: pendingByUser.size,
    maxConcurrent: maxConcurrentTurns(),
  };
}

function tryAdmit(key: SessionKey): boolean {
  const userPending = pendingByUser.get(key) ?? 0;
  if (pendingTurns >= MAX_PENDING_TURNS || userPending >= MAX_PENDING_PER_USER) {
    incrementCounter('turn_rejected_total');
    return false;
  }
  pendingTurns += 1;
  pendingByUser.set(key, userPending + 1);
  return true;
}

function releaseAdmission(key: SessionKey): void {
  pendingTurns = Math.max(0, pendingTurns - 1);
  const remaining = Math.max(0, (pendingByUser.get(key) ?? 1) - 1);
  if (remaining) pendingByUser.set(key, remaining);
  else pendingByUser.delete(key);
}

export function enqueueTurn(
  chatId: number,
  userId: number,
  carrierId: string,
  role: GatewayRole,
  route: AiRouteDecision,
  userPrompt: TurnContent,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): void {
  const key = sessionKey(chatId, userId);
  if (!tryAdmit(key)) {
    const error = new Error('turn queue capacity exceeded');
    onStats?.({
      durationMs: 0,
      numTurns: 0,
      usage: null,
      isError: true,
      errMsg: error.message,
    });
    void onReply(
      "⚠️ Hozir so‘rovlar ko‘p — avvalgi savolingiz javobini kuting va birozdan keyin qayta urinib ko‘ring. / High demand — please wait for your earlier request and try again shortly.",
    ).catch(() => undefined);
    return;
  }

  const lifecycle = turnEnqueued();
  const measuredReply = lifecycle.wrapReply(onReply);
  const measuredStats = lifecycle.wrapStats(onStats);
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .then(() =>
      runTurn(
        chatId,
        key,
        carrierId,
        role,
        route,
        userPrompt,
        lifecycle,
        measuredReply,
        measuredStats,
      ),
    )
    .catch(async (error) => {
      console.error(`[thread ${key}] OpenAI turn failed`, error);
      try {
        await measuredReply(
          "⚠️ Hozir javob bera olmadim — birozdan keyin qayta urinib ko‘ring. / Couldn't answer just now — please try again shortly.",
        );
      } catch {
        // Telegram failed too; keep the queue draining.
      }
      measuredStats({
        durationMs: 0,
        numTurns: 0,
        usage: null,
        isError: true,
        errMsg: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      lifecycle.settle();
      releaseAdmission(key);
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

async function runTurn(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  role: GatewayRole,
  route: AiRouteDecision,
  userPrompt: TurnContent,
  lifecycle: TurnLifecycle,
  onReply: (text: string) => Promise<void>,
  onStats?: (stats: TurnStats) => void,
): Promise<void> {
  await acquireTurnSlot();
  lifecycle.started();
  const stopTyping = startTypingKeepAlive(chatId);
  try {
    const prompt = typeof userPrompt === 'string' ? userPrompt : JSON.stringify(userPrompt);
    const outcome = await runModelLoop(
      chatId,
      key,
      carrierId,
      role,
      route,
      prompt,
    );
    const text = outcome.finalText.trim();
    if (text && text !== 'SILENT') await onReply(text.slice(0, 4000));
    saveTurn(key, prompt, text || 'SILENT');
    onStats?.(outcome.stats);
  } finally {
    stopTyping();
    releaseTurnSlot();
  }
}

interface UsageTotals extends Record<string, unknown> {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  openai_calls: number;
}

async function runModelLoop(
  chatId: number,
  key: SessionKey,
  carrierId: string,
  role: GatewayRole,
  route: AiRouteDecision,
  prompt: string,
): Promise<{ finalText: string; stats: TurnStats }> {
  const startedAt = Date.now();
  if (route.kind === 'greeting') {
    incrementCounter('greeting_fast_path_total');
    return zeroTokenOutcome(startedAt, greetingText(route.language));
  }
  if (route.kind === 'capability') {
    incrementCounter('capability_fast_path_total');
    return zeroTokenOutcome(
      startedAt,
      capabilitySummaryText(role, route.language),
    );
  }
  const askerId = verifiedAskerId(prompt);
  const history = historyFor(key);
  const serviceManifests = [
    ...buildOctaneTools(chatId, carrierId, askerId),
    ...buildTelegramTools(chatId, askerId),
  ];
  const plan = selectAiToolPlan(
    serviceManifests,
    route,
    role,
  );
  if (plan.unavailableService) {
    incrementCounter('service_disabled_total');
    return zeroTokenOutcome(
      startedAt,
      serviceUnavailableText(plan.unavailableService, route.language),
    );
  }
  if (plan.roleDeniedTool) {
    incrementCounter('role_tool_denied_total');
    return zeroTokenOutcome(startedAt, roleDeniedText(role, route.language));
  }
  const deniedRequiredTool = plan.requiredSequence.find(
    (toolName) => !isToolAllowedForRole(toolName, role),
  );
  if (deniedRequiredTool) {
    incrementCounter('role_tool_denied_total');
    return zeroTokenOutcome(startedAt, roleDeniedText(role, route.language));
  }
  const memoryScope = { chatId, carrierId, telegramUserId: askerId };
  const memory = role !== 'guest' && isServiceEnabled('memory')
    ? await recallSupportMemory(memoryScope, prompt)
    : '';
  const manifests = filterToolsForRole(plan.tools, role);
  const requiredSequence = plan.requiredSequence.filter((toolName) =>
    manifests.some((manifest) => manifest.name === toolName),
  );
  const messages: ModelMessage[] = [
    {
      role: 'system',
      content: systemPrompt(
        role,
        manifests.map((manifest) => manifest.name),
      ),
    },
    ...(memory
      ? [{ role: 'system' as const, content: memory }]
      : []),
    ...history.map(
      (message): ModelMessage => ({ role: message.role, content: message.content }),
    ),
    { role: 'user', content: prompt },
  ];
  const usage: UsageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    openai_calls: 0,
  };

  let finalText = '';
  let modelSteps = 0;
  for (; modelSteps < MAX_MODEL_STEPS; modelSteps += 1) {
    const response = await completeModel(
      messages,
      manifests,
      safetyIdentifierForChat(chatId),
      requiredSequence[0],
    );
    accumulateUsage(usage, response);
    const toolCalls = response.toolCalls;
    messages.push({
      role: 'assistant',
      content: response.text || null,
      ...(toolCalls.length ? { toolCalls } : {}),
    });

    if (!toolCalls.length) {
      if (requiredSequence.length) {
        throw new Error(
          `Model did not call required tool "${requiredSequence[0]}"`,
        );
      }
      finalText = response.text;
      break;
    }

    for (const call of toolCalls) {
      const parsed = parseToolArguments(call.arguments);
      const auditContext = { chatId, carrierId, role };
      let result: string;
      if (parsed.ok) {
        result = await toolDispatcher(
          manifests,
          call.name,
          parsed.value,
          auditContext,
        );
      } else {
        // Dispatch an empty object solely so the rejected model call is still authorized,
        // validated, and audit-logged. Empty input cannot pass any write-tool schema.
        await toolDispatcher(manifests, call.name, {}, auditContext);
        result = `error: invalid JSON arguments for ${call.name}: ${parsed.message}`;
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: result });

      if (call.name === requiredSequence[0]) requiredSequence.shift();
      if (toolFailed(result)) {
        // Do not continue a forced multi-tool workflow after its prerequisite failed.
        requiredSequence.length = 0;
      } else if (
        call.name === 'telegram_read_image' &&
        manifests.some((manifest) => manifest.name === 'octane_card_status') &&
        /\b\d{6}\b/.test(result)
      ) {
        // A readable card photo is not the answer: force the live status lookup next.
        requiredSequence.unshift('octane_card_status');
      }
    }
  }

  if (!finalText && modelSteps >= MAX_MODEL_STEPS) {
    throw new Error(`Model exceeded the ${MAX_MODEL_STEPS}-step tool limit`);
  }
  if (role !== 'guest' && isServiceEnabled('memory') && finalText) {
    enqueueSupportMemoryCommit(memoryScope, prompt, finalText);
  }

  return {
    finalText,
    stats: {
      durationMs: Date.now() - startedAt,
      numTurns: modelSteps + 1,
      usage,
      isError: false,
    },
  };
}

/** The prompt envelope is built from Telegram's verified sender, not user-controlled text. */
export function verifiedAskerId(prompt: string): number {
  const match = prompt.match(/^\[(?:msg \d+ from|button tap from) .+ \(id (\d+)\)\]:/);
  const id = Number(match?.[1] ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Turn is missing a verified Telegram sender id');
  }
  return id;
}

function toolFailed(result: string): boolean {
  return result.startsWith('error:') || /"error"\s*:\s*true/.test(result);
}

interface ParsedArguments {
  ok: true;
  value: Record<string, unknown>;
}

interface InvalidArguments {
  ok: false;
  message: string;
}

/** Repair common model wrappers around otherwise-valid function arguments. */
export function parseToolArguments(raw: string): ParsedArguments | InvalidArguments {
  const cleaned = raw
    .trim()
    .replace(/^<\|python_tag\|>/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  const candidates = [
    cleaned,
    objectStart >= 0 && objectEnd > objectStart
      ? cleaned.slice(objectStart, objectEnd + 1)
      : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ok: true, value: { ...value } };
      }
    } catch {
      // Try the extracted object candidate.
    }
  }
  return { ok: false, message: 'expected one JSON object' };
}

function accumulateUsage(
  target: UsageTotals,
  source: ModelCompletion,
): void {
  target.input_tokens += source.usage.inputTokens;
  target.output_tokens += source.usage.outputTokens;
  target.cache_read_input_tokens += source.usage.cacheReadInputTokens;
  target.cache_creation_input_tokens += source.usage.cacheWriteInputTokens;
  target.openai_calls += 1;
}
