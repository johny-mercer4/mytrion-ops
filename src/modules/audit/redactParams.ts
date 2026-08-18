/** Mask a full card number in audited touchpoint params while retaining the last four digits. */
export function redactAuditParams(params: unknown): unknown {
  if (typeof params !== 'object' || params === null) return params;
  const out: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  if (typeof out.cardNumber === 'string' && out.cardNumber.length > 4) {
    out.cardNumber = `•••• ${out.cardNumber.slice(-4)}`;
  }
  return out;
}
