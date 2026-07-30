import { createHash } from 'node:crypto';

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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash validated arguments without depending on caller key order. */
export function supportBotRequestHash(
  operationType: string,
  validatedArguments: Record<string, unknown>,
): string {
  return sha256(
    JSON.stringify({
      operationType,
      arguments: canonicalize(validatedArguments),
    }),
  );
}

/** Hash the raw session identity so Redis/Postgres keys contain no Telegram IDs. */
export function supportBotSessionKeyHash(
  environment: string,
  botIdentity: string,
  chatId: string,
  telegramUserId: string,
): string {
  return sha256(
    JSON.stringify({ environment, botIdentity, chatId, telegramUserId }),
  );
}

/** Stable operation key. Occurrence is persisted by the gateway and never model-controlled. */
export function supportBotIdempotencyKey(input: {
  environment: string;
  botIdentity: string;
  turnId: string;
  writeOccurrence: number;
  tenantId: string;
  carrierId: string;
  telegramUserId: string;
  operationType: string;
  requestHash: string;
}): string {
  return sha256(JSON.stringify(input));
}
