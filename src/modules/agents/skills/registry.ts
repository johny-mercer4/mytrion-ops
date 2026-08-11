/**
 * The authored skill registry: name → AgentSkill, plus the byte-stable index projection that goes
 * into an agent's system prompt.
 *
 * Assignment is by manifest (`AgentManifest.skills`), so which skills an agent can read is a
 * reviewed, static decision rather than anything the model or the caller can influence at runtime.
 */
import type { AgentSkill, SkillName } from './types.js';

import { ORCHESTRATOR_FLEET_SKILL } from './orchestrator/fleet.js';
import { ORCHESTRATOR_ROUTING_SKILL } from './orchestrator/routing.js';
import { ORCHESTRATOR_CONTEXT_SKILL } from './orchestrator/context.js';
import { SALES_CLIENT_BOOK_SKILL } from './sales/clientBook.js';
import { SALES_CYCLE_SKILL } from './sales/cycle.js';
import { SALES_PROGRESS_SKILL } from './sales/progress.js';
import { SALES_RETENTION_INVOICES_SKILL } from './sales/retentionInvoices.js';

/** Every authored skill. Adding one here is what makes it assignable from a manifest. */
export const ALL_SKILLS: readonly AgentSkill[] = [
  ORCHESTRATOR_FLEET_SKILL,
  ORCHESTRATOR_ROUTING_SKILL,
  ORCHESTRATOR_CONTEXT_SKILL,
  SALES_CLIENT_BOOK_SKILL,
  SALES_CYCLE_SKILL,
  SALES_PROGRESS_SKILL,
  SALES_RETENTION_INVOICES_SKILL,
];

const BY_NAME: ReadonlyMap<string, AgentSkill> = new Map(ALL_SKILLS.map((s) => [s.name, s]));

export function getSkill(name: string): AgentSkill | undefined {
  return BY_NAME.get(name);
}

/**
 * Resolve assigned names to skills, dropping unknown ones.
 *
 * Dropping rather than throwing is deliberate: a manifest naming a deleted skill must not take the
 * agent down mid-request. `skillRegistry.test.ts` fails the build on an unknown name instead, so the
 * mistake is caught in CI where it is cheap.
 */
export function skillsFor(names: readonly SkillName[] | undefined): AgentSkill[] {
  if (!names || names.length === 0) return [];
  const seen = new Set<string>();
  const out: AgentSkill[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const skill = BY_NAME.get(name);
    if (skill) out.push(skill);
  }
  return out;
}

/**
 * The always-present half of progressive disclosure: names + when to use them, and nothing else.
 * Byte-stable for a given manifest, so it lives in the system prompt without breaking prefix caching.
 * Returns '' when the agent has no skills, so the prompt gains no empty scaffolding.
 */
export function formatSkillIndex(names: readonly SkillName[] | undefined): string {
  const skills = skillsFor(names);
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}: ${s.whenToUse}`).join('\n');
  return (
    '\n\nSKILLS — procedures written for you, fetched on demand with the `skill.read` tool.\n' +
    'Each line is a name and when it applies. When one matches the request, call `skill.read` with ' +
    'that name BEFORE acting, and follow it. It is authoritative for how the work is done here and ' +
    'outranks your own assumptions; it never overrides a server RBAC denial or a tool result.\n' +
    'Do not guess a skill name that is not on this list, and do not read one that does not apply.\n' +
    lines
  );
}

/** Names assigned to an agent, for the skill.read allowlist. */
export function assignedSkillNames(names: readonly SkillName[] | undefined): Set<string> {
  return new Set(skillsFor(names).map((s) => s.name));
}
