/**
 * JSON-safe leftover columns from a vendor row.
 *
 * Typed summaries (QCMobile verdicts, Socrata dockets) drop keys on purpose so a credit
 * check cannot read a string amount as a boolean. Data Center still has to show what the
 * register sent — this is that remainder, not a second parse.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = jsonValue(item);
      return next === undefined ? null : next;
    });
  }
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = jsonValue(item);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
}

/** Every own key the vendor sent, or undefined when the value is not a plain object. */
export function jsonFields(value: unknown): Record<string, JsonValue> | undefined {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}
