/**
 * Executes an APPROVED write proposal. The execution runs under the PROPOSER's snapshotted
 * context (never the approver's — approval is a gate, not an authority transfer), and access
 * is re-checked at execution time so policy drift between proposal and approval is caught.
 */
import { errorMessage } from '../../lib/errors.js';
import type { Approval } from '../../db/schema/index.js';
import { approvalRepo } from '../../repos/approvalRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { dispatchTool } from '../chat/toolDispatcher.js';
import { payloadToContext, tenantContextSchema } from '../jobs/catalog.js';

export interface ApprovalExecutionResult {
  status: 'executed' | 'failed';
  result?: unknown;
  error?: string;
}

export async function executeApproval(
  adminCtx: TenantContext,
  approval: Approval,
): Promise<ApprovalExecutionResult> {
  const proposerCtx = payloadToContext(tenantContextSchema.parse(approval.ctxSnapshot));
  try {
    // dispatchTool re-runs checkAccess with the proposer's context; viaAgent is NOT set, so
    // the (already-approved) call executes. Attribution keeps the original agent/run.
    const result = await dispatchTool(approval.toolName, approval.arguments, proposerCtx, {
      ...(approval.conversationId ? { conversationId: approval.conversationId } : {}),
      ...(approval.actingAgent ? { actingAgent: approval.actingAgent } : {}),
      ...(approval.agentRunId ? { agentRunId: approval.agentRunId } : {}),
    });
    await approvalRepo.markOutcome(adminCtx, approval.id, 'executed', {
      result: typeof result === 'object' && result !== null ? result : { value: result },
    });
    await auditFromContext(adminCtx, {
      action: 'tool.approval_executed',
      status: 'ok',
      toolName: approval.toolName,
      detail: { approvalId: approval.id, approvedBy: adminCtx.userName ?? adminCtx.userId },
    });
    return { status: 'executed', result };
  } catch (err) {
    const message = errorMessage(err);
    await approvalRepo.markOutcome(adminCtx, approval.id, 'failed', { error: message });
    await auditFromContext(adminCtx, {
      action: 'tool.approval_executed',
      status: 'error',
      toolName: approval.toolName,
      detail: { approvalId: approval.id, error: message },
    });
    return { status: 'failed', error: message };
  }
}
