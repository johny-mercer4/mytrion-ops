/** The prompt envelope is built from Telegram's verified sender, not user-controlled text. */
export function verifiedAskerId(prompt: string): number {
  const match = prompt.match(/^\[(?:msg \d+ from|button tap from) .+ \(id (\d+)\)\]:/);
  const id = Number(match?.[1] ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Turn is missing a verified Telegram sender id');
  }
  return id;
}

export function toolFailed(result: string): boolean {
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
    objectStart >= 0 && objectEnd > objectStart ? cleaned.slice(objectStart, objectEnd + 1) : '',
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
