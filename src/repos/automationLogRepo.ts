import { db } from '../db/client.js';
import { automationLogs, type AutomationLog, type NewAutomationLog } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface NewAutomationLogInput {
  automationType: string;
  agentName?: string | undefined;
  triggerTime?: string | undefined;
  triggerDate?: string | undefined;
}

export const automationLogRepo = {
  /** Insert one automation log row (tenant from ctx). Returns the created row. */
  async insert(ctx: TenantContext, input: NewAutomationLogInput): Promise<AutomationLog> {
    const values: NewAutomationLog = {
      tenantId: ctx.tenantId,
      automationType: input.automationType,
    };
    if (input.agentName !== undefined) values.agentName = input.agentName;
    if (input.triggerTime !== undefined) values.triggerTime = input.triggerTime;
    if (input.triggerDate !== undefined) values.triggerDate = input.triggerDate;
    const rows = await db.insert(automationLogs).values(values).returning();
    return firstOrThrow(rows, 'Failed to insert automation log');
  },
};
