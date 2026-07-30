import { readFileSync } from 'node:fs';

let cached: string | null = null;

/** Compact policy; tool descriptions carry operation-specific details. */
export function systemPrompt(): string {
  cached ??= readFileSync('prompts/octane-openai.md', 'utf8');
  return cached;
}
