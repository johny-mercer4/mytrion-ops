export type GatewayOverloadKind =
  | 'capacity'
  | 'stale'
  | 'rate_limit'
  | 'provider_429'
  | 'circuit_open';

export const HIGH_DEMAND_TEXT =
  '⚠️ Hozir so‘rovlar ko‘p. Iltimos, birozdan keyin qayta urinib ko‘ring. ' +
  '/ High demand right now. Please try again shortly.';

export class GatewayOverloadError extends Error {
  readonly kind: GatewayOverloadKind;
  readonly retryAfterMs?: number;

  constructor(kind: GatewayOverloadKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'GatewayOverloadError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isGatewayOverloadError(error: unknown): error is GatewayOverloadError {
  return error instanceof GatewayOverloadError;
}
