import { z } from 'zod';
import { dispatchTool } from '../../chat/toolDispatcher.js';
import { ToolError } from '../../../lib/errors.js';
import type { ToolManifest } from '../types.js';

const taskSchema = z.object({
  id: z.string().describe('Unique identifier for this task.'),
  toolName: z.string().describe('Name of the tool to execute (e.g., zoho_crm.create).'),
  arguments: z.record(z.unknown()).describe('Arguments to pass to the tool. Can include ${task_id.result.path} templates.'),
  dependsOn: z.array(z.string()).optional().describe('List of task IDs that must complete before this one.'),
});

const inputSchema = z.object({
  tasks: z.array(taskSchema).min(1).describe('Array of tasks forming a directed acyclic graph.'),
});

const outputSchema = z.object({
  results: z.record(z.unknown()).describe('Map of task IDs to their execution results or errors.'),
  status: z.enum(['success', 'partial_success', 'failed']),
});

/** Resolves dot-notation paths like 'result.data.0.id' against an object */
function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/** Looks up one `task_id.some.path` template against the results context. */
function resolveTemplate(path: string, context: Record<string, unknown>): unknown {
  const [taskId = '', ...rest] = path.split('.');
  if (!taskId || context[taskId] === undefined) return undefined;
  return resolvePath(context[taskId], rest.join('.'));
}

/** Recursively string-interpolates ${task_id.path} templates in arguments */
function interpolateArguments(args: unknown, context: Record<string, unknown>): unknown {
  if (typeof args === 'string') {
    // The entire argument is one template → preserve the resolved value's native type
    // (number, object, array), not its string rendering.
    const whole = /^\$\{([^}]+)\}$/.exec(args);
    if (whole) {
      const val = resolveTemplate(whole[1] ?? '', context);
      return val === undefined ? args : val;
    }
    return args.replace(/\$\{([^}]+)\}/g, (match, path: string) => {
      const val = resolveTemplate(path, context);
      return val === undefined ? match : String(val);
    });
  } else if (Array.isArray(args)) {
    return args.map((item) => interpolateArguments(item, context));
  } else if (args !== null && typeof args === 'object') {
    const newArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      newArgs[k] = interpolateArguments(v, context);
    }
    return newArgs;
  }
  return args;
}

export const dagExecutorTool: ToolManifest<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: 'orchestration.plan_and_execute',
  description:
    'Execute a directed acyclic graph (DAG) of tool calls. Tasks can depend on one another, ' +
    'and execute in parallel where possible. You can interpolate outputs from previous tasks into arguments ' +
    'using the syntax ${task_id.result.path}. The graph execution will attempt best-effort execution if a node fails.',
  inputSchema,
  outputSchema,
  riskClass: 'write', // High privilege tool since it wraps other tools
  allowedAudiences: ['internal'],
  requiredScopes: [], // Individual tools re-check scopes during dispatchTool
  rateLimit: { perMinute: 20 },
  async handler(input, ctx) {
    const tasks = input.tasks;
    const resultsContext: Record<string, unknown> = {};
    const pendingTasks = new Set(tasks.map(t => t.id));
    const runningTasks = new Set<string>();
    const completedTasks = new Set<string>();
    const failedTasks = new Set<string>();
    
    // Validate cycle (basic check)
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    
    // Execution Loop
    while (pendingTasks.size > 0 || runningTasks.size > 0) {
      const readyToRun = Array.from(pendingTasks).filter(id => {
        const t = taskMap.get(id);
        if (!t?.dependsOn || t.dependsOn.length === 0) return true;
        // Ready if all dependencies are completed (and not failed)
        // If a dependency failed, this task cannot run.
        return t.dependsOn.every(depId => completedTasks.has(depId));
      });

      // Check for blocked tasks due to failed dependencies
      for (const id of pendingTasks) {
        const t = taskMap.get(id);
        if (t?.dependsOn?.some(depId => failedTasks.has(depId))) {
          pendingTasks.delete(id);
          failedTasks.add(id);
          resultsContext[id] = { error: 'Dependency failed' };
        }
      }

      if (readyToRun.length === 0 && runningTasks.size === 0 && pendingTasks.size > 0) {
        throw new ToolError('DAG execution stalled due to circular dependencies or unresolved graph state.');
      }

      // Launch ready tasks
      const batchPromises = readyToRun.map(async (id) => {
        pendingTasks.delete(id);
        runningTasks.add(id);
        
        const task = taskMap.get(id)!;
        
        try {
          const interpolatedArgs = interpolateArguments(task.arguments, resultsContext);
          
          // Re-dispatch through standard pipeline (RBAC checked automatically)
          const result = await dispatchTool(task.toolName, interpolatedArgs, ctx, {
             // Mark as sub-dispatch so it doesn't wait for approvals if viaAgent
             viaAgent: false,
          });
          
          resultsContext[id] = { result };
          completedTasks.add(id);
        } catch (err) {
          resultsContext[id] = { error: err instanceof Error ? err.message : 'Unknown error' };
          failedTasks.add(id);
        } finally {
          runningTasks.delete(id);
        }
      });
      
      if (batchPromises.length > 0) {
        await Promise.all(batchPromises);
      }
    }
    
    return {
      results: resultsContext,
      status: failedTasks.size === 0 ? 'success' : (completedTasks.size > 0 ? 'partial_success' : 'failed'),
    };
  },
};
