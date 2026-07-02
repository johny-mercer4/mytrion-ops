/**
 * Scheduled department automations. Each handler: scoped system context → agent_tasks row
 * (kind 'automation.*', requester 'system:scheduler') → direct-to-child agent run with a
 * canned prompt → automation_logs continuity row → optional Telegram summary (through the
 * dispatcher, like every other tool call).
 */
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { agentTaskRepo } from '../../../repos/agentTaskRepo.js';
import { automationLogRepo } from '../../../repos/automationLogRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { runAgentTurn } from '../../agents/orchestratorService.js';
import type { AgentKey } from '../../agents/types.js';
import { dispatchTool } from '../../chat/toolDispatcher.js';
import { buildSystemContext, SCHEDULER_USER_ID } from '../systemContext.js';

interface AutomationSpec {
  queue: string;
  agent: AgentKey;
  departments: string[];
  prompt: string;
  /** Send the answer to the main Telegram chat when the toolkit is enabled. */
  notify: boolean;
}

export const AUTOMATIONS: AutomationSpec[] = [
  {
    queue: 'automation.collection.debtor-sweep',
    agent: 'collection',
    departments: ['collection'],
    prompt:
      'Daily debtor sweep: pull the current debtor list, summarize total outstanding debt, the ' +
      'number of debtors, hard debtors (60+ days), and the top 5 debtors by amount with how many ' +
      'days overdue each is. Finish with the 3 accounts that most urgently need follow-up today.',
    notify: true,
  },
  {
    queue: 'automation.retention.weekly-scan',
    agent: 'retention',
    departments: ['retention'],
    prompt:
      'Weekly retention scan: using the knowledge base and available CRM data, summarize churn ' +
      'risk signals to watch this week and list the standard re-engagement actions for dormant ' +
      'clients. Note anything the retention team should prioritize.',
    notify: true,
  },
  {
    queue: 'automation.verification.recheck-reminders',
    agent: 'verification',
    departments: ['verification'],
    prompt:
      'Daily verification recheck: summarize the standing re-verification policy for active ' +
      'clients and list the verification checks due today per the monthly re-verification cycle. ' +
      'Flag anything blocking applications from proceeding.',
    notify: false,
  },
];

async function notifyTelegram(ctx: TenantContext, title: string, answer: string): Promise<void> {
  if (!env.FF_TELEGRAM_ENABLED) return;
  try {
    // Trusted automation code path (not a model decision) — still dispatched + audited.
    // Telegram sends are admin-sentinel tools, so the notify context is explicitly elevated.
    const notifyCtx = { ...ctx, allDepartmentAccess: true };
    const text = `${title}\n\n${answer}`.slice(0, 4000);
    await dispatchTool('telegram.send_message', { text }, notifyCtx);
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'automation telegram notify failed');
  }
}

export function makeAutomationHandler(spec: AutomationSpec): () => Promise<void> {
  return async () => {
    const ctx = buildSystemContext(spec.departments);
    const task = await agentTaskRepo.create(ctx, {
      userId: SCHEDULER_USER_ID,
      kind: spec.queue,
      queue: spec.queue,
      status: 'running',
      request: { agent: spec.agent, prompt: spec.prompt },
      startedAt: new Date(),
    });
    try {
      const result = await runAgentTurn(spec.prompt, ctx, { agent: spec.agent });
      await agentTaskRepo.complete(ctx, task.id, {
        answer: result.message,
        conversationId: result.conversationId,
        usage: result.usage,
      });
      await automationLogRepo.insert(ctx, { automationType: spec.queue, agentName: spec.agent });
      await notifyTelegram(ctx, `🤖 ${spec.queue}`, result.message);
    } catch (err) {
      const message = errorMessage(err);
      await agentTaskRepo.fail(ctx, task.id, message);
      logger.warn({ queue: spec.queue, err: message }, 'automation failed');
      throw err;
    }
  };
}
