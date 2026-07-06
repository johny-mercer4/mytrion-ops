/**
 * Behavioral golden-task schema + loader for scripts/evalLive.ts. Tasks live in
 * tests/fixtures/behavior-tasks.json (same fixture style as retrieval-corpus.json) and are
 * zod-validated on load so a malformed task fails fast, not mid-run.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { AGENT_KEYS } from '../../src/modules/agents/types.js';
import { systemContext } from '../../src/modules/auth/authService.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const CATEGORIES = [
  'routing',
  'greeting',
  'refusal',
  'grounding',
  'tool-selection',
  'delegation',
  'rbac',
] as const;
export type TaskCategory = (typeof CATEGORIES)[number];

const agentKey = z.enum(AGENT_KEYS);

const expectSchema = z
  .object({
    /** agentPath[0] must equal this; 'none' asserts zero delegation. */
    routedAgent: z.union([agentKey, z.literal('none')]).optional(),
    routedOneOf: z.array(agentKey).min(1).optional(),
    mustCallTool: z.array(z.string().min(1)).optional(),
    mustNotCallTool: z.array(z.string().min(1)).optional(),
    maxToolCalls: z.number().int().min(0).optional(),
    refusalExpected: z.boolean().optional(),
    mustCite: z.boolean().optional(),
    /** Corpus doc KEYS (retrieval-corpus.json) given to the judge as ground truth. */
    referenceDocs: z.array(z.string().min(1)).optional(),
    notDocumentedExpected: z.boolean().optional(),
  })
  .strict();

const taskSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    caller: z
      .object({
        departments: z.array(z.string()),
        allDepartmentAccess: z.boolean(),
        userName: z.string().optional(),
      })
      .strict(),
    /** null = orchestrator; an agent key = direct-to-child. */
    agent: agentKey.nullable(),
    turns: z.array(z.string().min(1)).min(1),
    expect: expectSchema,
    judgeRubric: z.string().optional(),
    requires: z.array(z.enum(['servercrm'])).default([]),
  })
  .strict();

const fileSchema = z.object({ tasks: z.array(taskSchema).min(1) });

export type BehaviorTask = z.infer<typeof taskSchema>;
export type TaskExpectation = z.infer<typeof expectSchema>;

export function loadBehaviorTasks(): BehaviorTask[] {
  const raw = readFileSync(
    new URL('../../tests/fixtures/behavior-tasks.json', import.meta.url),
    'utf-8',
  );
  const parsed = fileSchema.parse(JSON.parse(raw));
  const ids = new Set<string>();
  for (const task of parsed.tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate behavior task id '${task.id}'`);
    ids.add(task.id);
  }
  return parsed.tasks;
}

/** Caller context for a task — the evalRetrieval ctxFor pattern (system identity + overrides). */
export function taskContext(task: BehaviorTask): TenantContext {
  const ctx: TenantContext = {
    ...systemContext(`eval-${task.id}`),
    departments: task.caller.departments,
    allDepartmentAccess: task.caller.allDepartmentAccess,
    userId: `zoho:eval-${task.id}`,
  };
  if (task.caller.userName) ctx.userName = task.caller.userName;
  return ctx;
}
