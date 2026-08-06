import type { SSEStream } from '../chat/streaming.js';
import type { TenantContext } from '../../types/tenantContext.js';

export type TurnTraceStage =
  | 'route'
  | 'model'
  | 'plan'
  | 'agent'
  | 'rag'
  | 'tool'
  | 'verification'
  | 'complete'
  | 'error';

export type TurnTraceDetail = string | number | boolean | null;

export interface TurnTraceInput {
  stage: TurnTraceStage;
  status: 'pending' | 'running' | 'complete' | 'error';
  label: string;
  agent?: string;
  model?: string;
  modelRole?: string;
  provider?: string;
  route?: string;
  ragUsed?: boolean;
  ragGrade?: string;
  confidence?: number;
  passages?: number;
  durationMs?: number;
  details?: Record<string, TurnTraceDetail>;
}

export type TurnTraceEmitter = (event: TurnTraceInput) => void;

/** Detailed runtime traces are an admin diagnostic surface, never ordinary chat output. */
export function createTurnTraceEmitter(
  ctx: TenantContext,
  sse: SSEStream | undefined,
  runId: string,
): TurnTraceEmitter | undefined {
  if (!sse || !(ctx.role === 'admin' || ctx.allDepartmentAccess || ctx.bypassRbac)) return undefined;
  return (event) => {
    sse.send('trace', {
      ...event,
      runId,
      at: new Date().toISOString(),
    });
  };
}
