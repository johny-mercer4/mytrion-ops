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

export function gatewaySessionKeyHash(
  environment: string,
  botIdentity: string,
  chatId: number,
  telegramUserId: number,
): string {
  return sha256(
    JSON.stringify({ environment, botIdentity, chatId, telegramUserId }),
  );
}

export function gatewayOperationKey(input: {
  environment: string;
  botIdentity: string;
  turnId: string;
  writeOccurrence: number;
  tenantId: string;
  carrierId: string;
  telegramUserId: number;
  operationType: string;
  arguments: Record<string, unknown>;
}): string {
  return sha256(
    JSON.stringify({
      ...input,
      arguments: canonicalize(input.arguments),
    }),
  );
}
