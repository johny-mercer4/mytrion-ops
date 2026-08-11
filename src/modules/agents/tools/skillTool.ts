/**
 * `skill.read` — the on-demand half of progressive disclosure. Built per agent as a closure over
 * that agent's assigned skill names, exactly like `buildScopedRagTool` closes over its RAG scope.
 *
 * WHY THIS IS NOT A REGISTRY TOOL (hard rule 3/4 says every tool implements ToolManifest and
 * dispatches through toolDispatcher, which re-checks RBAC): those rules exist because tools reach
 * DATA, and the dispatcher is where tenant/department isolation is re-verified per call. This tool
 * reaches no data at all — it returns a static string compiled into the binary. Its only access
 * decision is "is this skill assigned to this agent", which is a reviewed manifest constant, and it
 * is enforced below by construction: the closure cannot name a skill the manifest did not assign.
 * `buildScopedRagTool` set the same precedent for agent-scoped, non-registry tools.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
// zod v4 entrypoint — matches scopedRag.ts; classic v3 clashes with exactOptionalPropertyTypes.
import * as z from 'zod/v4';
import { getAgentContext } from '../context.js';
import { assignedSkillNames, getSkill, skillsFor } from '../skills/registry.js';
import type { SkillName } from '../skills/types.js';

export function buildSkillTool(assigned: readonly SkillName[] | undefined): StructuredTool | null {
  const allowed = assignedSkillNames(assigned);
  if (allowed.size === 0) return null;
  const names = [...allowed];

  return tool(
    async ({ name }: { name: string }) => {
      const run = getAgentContext();
      // A skill read is a real step in the turn's reasoning, so it counts against the same tool-call
      // budget as anything else — otherwise a model could loop on reads for free.
      run?.budget?.countToolCall();

      const requested = name.trim();
      if (!allowed.has(requested)) {
        return (
          `No skill named "${requested}" is available to you. ` +
          `Available skills: ${names.join(', ')}. ` +
          'Use one of those exact names, or proceed without a skill.'
        );
      }
      const skill = getSkill(requested);
      if (!skill) {
        return `Skill "${requested}" is assigned but its body is missing. Proceed without it and do not invent the procedure.`;
      }
      run?.inspect?.({
        stage: 'tool',
        status: 'complete',
        label: `Read skill: ${skill.name}`,
        details: { skill: skill.name, chars: skill.body.length },
      });
      // Deliberately NOT wrapped as untrusted: unlike retrieved passages or memory, this text is
      // authored in-repo and reviewed in a PR. It is instructions, and it is meant to be followed.
      return `<Skill name="${skill.name}" trust="authored">\n${skill.body}\n</Skill>`;
    },
    {
      name: 'skill.read',
      description:
        'Read one of YOUR assigned procedural skills by exact name. Call this before acting when a ' +
        `skill in your SKILLS list matches the request. Available: ${names.join(', ')}.`,
      schema: z.object({
        name: z.string().min(1).max(120).describe(`Exact skill name. One of: ${names.join(', ')}`),
      }),
    },
  ) as unknown as StructuredTool; // zod v4 tool() generics vs StructuredTool — same cast as scopedRag
}

/** Skills assigned to an agent, for tests and for boot-time reporting. */
export function assignedSkills(assigned: readonly SkillName[] | undefined) {
  return skillsFor(assigned);
}
