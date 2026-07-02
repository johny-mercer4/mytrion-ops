/**
 * Minimal in-memory sliding-window rate limiter (per key). No Redis by design — a single
 * instance limiting its own outbound Composio calls is exactly the blast radius we want.
 */
const windows = new Map<string, number[]>();

export function takeToken(key: string, perMinute: number, now: () => number = Date.now): boolean {
  const cutoff = now() - 60_000;
  const stamps = (windows.get(key) ?? []).filter((t) => t > cutoff);
  if (stamps.length >= perMinute) {
    windows.set(key, stamps);
    return false;
  }
  stamps.push(now());
  windows.set(key, stamps);
  return true;
}

export function resetRateBucketsForTests(): void {
  windows.clear();
}
