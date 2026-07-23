/**
 * Procedural skill cache (FF_AGENT_SKILL_CACHE): distill winning tool trajectories and
 * suggest them on similar future asks. Skills NEVER auto-execute — the model still calls
 * real tools through dispatchTool + RBAC.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { agentSkillRepo } from '../../repos/agentSkillRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { embedQuery, embedTexts } from '../knowledge/embedder.js';
import { getOpenAI, models } from '../llm/openaiClient.js';
import { wrapUntrusted } from '../security/untrusted.js';
import { toolRegistry } from '../tools/index.js';

export interface SkillStep {
  tool: string;
  /** Arg keys only — never raw secret/PII values. */
  argKeys: string[];
}

export interface SkillTrajectory {
  steps: SkillStep[];
  notes?: string;
}

const ID_LIKE =
  /\b(\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{0,3}\d{4,})\b/gi;

/** Redact obvious IDs/tokens from free text for storage. */
export function redactSkillText(text: string): string {
  return text
    .replace(ID_LIKE, '<ID>')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '<EMAIL>')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '<PHONE>')
    .slice(0, 500);
}

export function skeletonFromToolCalls(
  toolCalls: Array<{ name: string; args?: unknown }>,
): SkillStep[] {
  const steps: SkillStep[] = [];
  for (const tc of toolCalls) {
    const name = tc.name.replace(/__/g, '.');
    if (name === 'task' || name === 'write_todos' || name.startsWith('blackboard.')) continue;
    const args =
      tc.args && typeof tc.args === 'object' && !Array.isArray(tc.args)
        ? Object.keys(tc.args as Record<string, unknown>).slice(0, 12)
        : [];
    steps.push({ tool: name, argKeys: args });
  }
  return steps.slice(0, 12);
}

function callerCanUseTools(ctx: TenantContext, tools: string[]): boolean {
  const allowed = new Set(toolRegistry.listForContext(ctx).map((t) => t.name));
  return tools.every((t) => allowed.has(t) || t.includes('*'));
}

/** Recall top skill hint for the brief, or '' when none/disabled. Never throws. */
export async function recallSkillHint(
  ctx: TenantContext,
  agentKey: string,
  query: string,
): Promise<string> {
  if (!env.FF_AGENT_SKILL_CACHE) return '';
  try {
    const embedding = await embedQuery(query);
    const rows = await agentSkillRepo.search(ctx, agentKey, embedding, 3);
    const hit = rows.find(
      (r) =>
        r.score >= env.AGENT_SKILL_SIMILARITY_THRESHOLD &&
        callerCanUseTools(ctx, r.toolsUsed ?? []),
    );
    if (!hit) return '';
    const traj = hit.trajectoryJson as SkillTrajectory;
    const steps = (traj?.steps ?? [])
      .map((s) => `${s.tool}(${s.argKeys.join(', ')})`)
      .join(' → ');
    const body =
      `pattern: ${hit.queryPattern}\n` +
      `suggested_tools: ${steps || (hit.toolsUsed ?? []).join(', ')}\n` +
      'NOTE: This is a SUGGESTION only. You MUST still call real tools via the tool interface; ' +
      'never invent results. Re-check RBAC if a tool fails.';
    return `\n\n<CachedSkill>\n${wrapUntrusted('memory', body)}\n</CachedSkill>`;
  } catch (err) {
    logger.warn({ err, agentKey }, 'skill recall failed (ignored)');
    return '';
  }
}

/** End-of-turn capture. Best-effort — never throws. */
export async function captureSkill(
  ctx: TenantContext,
  agentKey: string,
  question: string,
  answer: string,
  toolCalls: Array<{ name: string; status: string; args?: unknown }>,
): Promise<void> {
  if (!env.FF_AGENT_SKILL_CACHE) return;
  const okTools = toolCalls.filter((t) => t.status === 'ok');
  if (okTools.length < 2) return;
  if (/budget|RBAC|denied|failed/i.test(answer.slice(0, 400))) return;

  try {
    const steps = skeletonFromToolCalls(okTools);
    if (steps.length < 2) return;

    const res = await getOpenAI().chat.completions.create({
      model: env.RAG_PLANNER_MODEL || models.default,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Distill a reusable procedural skill pattern from a successful agent turn. ' +
            'Return JSON: {"pattern": string, "notes": string}. ' +
            'pattern = short natural-language description of the problem class (no PII/IDs). ' +
            'Skip if the turn is greeting-only or too specific to one customer.',
        },
        {
          role: 'user',
          content:
            `Q: ${redactSkillText(question)}\nA: ${redactSkillText(answer)}\n` +
            `Tools: ${steps.map((s) => s.tool).join(', ')}`,
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as {
      pattern?: unknown;
      notes?: unknown;
    };
    if (typeof parsed.pattern !== 'string' || parsed.pattern.trim().length < 8) return;

    const pattern = redactSkillText(parsed.pattern.trim());
    const [embedding] = await embedTexts([pattern]);
    if (!embedding) return;

    const department = ctx.departments[0] ?? null;
    const trajectory: SkillTrajectory = {
      steps,
      ...(typeof parsed.notes === 'string' ? { notes: redactSkillText(parsed.notes) } : {}),
    };

    await agentSkillRepo.insert(ctx, {
      agentKey,
      departmentAccess: department,
      queryPattern: pattern.slice(0, 500),
      trajectoryJson: trajectory,
      toolsUsed: steps.map((s) => s.tool),
      schemaVersion: '1',
      embedding,
    });
    await agentSkillRepo.evictBeyondCap(ctx, agentKey, department, env.AGENT_SKILL_MAX_PER_KEY);
  } catch (err) {
    logger.warn({ err, agentKey }, 'skill capture failed (ignored)');
  }
}
