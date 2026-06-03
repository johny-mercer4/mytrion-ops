export function now(): Date {
  return new Date();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parse a short duration string ('15m', '30d', '3600s', '24h') into seconds.
 * Throws on malformed input. Plain integers are treated as seconds.
 */
export function parseDurationToSeconds(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+)\s*([smhd])$/.exec(trimmed);
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const unit = match[2] ?? '';
  const multiplier = DURATION_UNITS[unit];
  if (multiplier === undefined) throw new Error(`Invalid duration unit: ${input}`);
  return Number(match[1]) * multiplier;
}
