import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { backendErrorInfo, supportBotHeaders } from './octaneClient.js';

export const CONFIRMABLE_TOOL_NAMES = [
  'octane_money_code',
  'octane_card_action',
  'octane_card_limits',
  'octane_card_info',
  'octane_service_request',
  'octane_override',
] as const;

export type ConfirmableToolName = (typeof CONFIRMABLE_TOOL_NAMES)[number];

function isConfirmableToolName(value: unknown): value is ConfirmableToolName {
  return (
    typeof value === 'string' &&
    (CONFIRMABLE_TOOL_NAMES as readonly string[]).includes(value)
  );
}

export interface ConfirmedAction {
  confirmationId: string;
  toolName: ConfirmableToolName;
  arguments: Record<string, unknown>;
  argumentsHash: string;
  turnId: string;
}

export function newConfirmationToken(): string {
  return randomBytes(16).toString('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function confirmationArgumentsHash(
  toolName: ConfirmableToolName,
  argumentsValue: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ operationType: toolName, arguments: canonicalize(argumentsValue) }))
    .digest('hex');
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.octaneBase}/v1${path}`, {
    method: 'POST',
    headers: supportBotHeaders(true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(backendErrorInfo(payload, response.status).message);
  }
  return payload;
}

export async function createConfirmation(input: {
  token: string;
  carrierId: string;
  chatId: number;
  telegramUserId: number;
  messageId: number;
  toolName: ConfirmableToolName;
  arguments: Record<string, unknown>;
}): Promise<void> {
  await post('/support-bot/confirmations', input);
}

export async function resolveConfirmation(input: {
  token: string;
  carrierId: string;
  chatId: number;
  telegramUserId: number;
  messageId: number;
  updateId: number;
  decision: 'confirm' | 'cancel';
}): Promise<ConfirmedAction | null> {
  const payload = await post('/support-bot/confirmations/resolve', input);
  if (payload['confirmed'] !== true) return null;
  const toolName = payload['toolName'];
  const argumentsValue = payload['arguments'];
  if (
    typeof payload['confirmationId'] !== 'string' ||
    !isConfirmableToolName(toolName) ||
    !argumentsValue ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue) ||
    typeof payload['argumentsHash'] !== 'string' ||
    typeof payload['turnId'] !== 'string'
  ) {
    throw new Error('Backend returned a malformed confirmed action');
  }
  return {
    confirmationId: payload['confirmationId'],
    toolName,
    arguments: { ...argumentsValue },
    argumentsHash: payload['argumentsHash'],
    turnId: payload['turnId'],
  };
}

export function parseConfirmationCallback(
  data: string | undefined,
): { decision: 'confirm' | 'cancel'; token: string } | null {
  const match = data?.match(/^([cx]):([a-f0-9]{32})$/u);
  if (!match) return null;
  const token = match[2];
  if (!token) return null;
  return { decision: match[1] === 'c' ? 'confirm' : 'cancel', token };
}
