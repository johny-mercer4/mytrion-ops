import { readFileSync } from 'node:fs';

let cached: string | null = null;

/** The Octane support persona — same content family as v1's project.md.octane. */
export function systemPrompt(): string {
  if (cached == null) cached = readFileSync('prompts/octane.md', 'utf8');
  return cached;
}
