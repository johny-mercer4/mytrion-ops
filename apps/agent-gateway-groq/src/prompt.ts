import { readFileSync } from 'node:fs';
import { servicePromptPolicy } from './serviceRegistry.js';
import {
  rolePromptPolicy,
  skillInstructionsFor,
  type GatewayRole,
} from './skillRegistry.js';

let cached: string | null = null;

/** Compact policy; tool descriptions carry operation-specific details. */
export function systemPrompt(
  role: GatewayRole,
  toolNames: readonly string[] = [],
): string {
  cached ??= readFileSync('prompts/octane-openai.md', 'utf8');
  const skills = skillInstructionsFor(role, toolNames);
  return [
    cached.trim(),
    servicePromptPolicy(),
    rolePromptPolicy(role),
    ...(skills ? [skills] : []),
  ].join('\n\n');
}
