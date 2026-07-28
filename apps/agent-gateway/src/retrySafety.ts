/**
 * State-changing tools that must never be blindly replayed after a partial attempt.
 * Keep this list aligned with the support-bot write manifests until gateway tools move behind the
 * central ToolManifest/dispatcher path.
 */
export const WRITE_RISK_TOOLS = new Set([
  'mcp__octane__octane_money_code',
  'mcp__octane__octane_manual_code',
  'mcp__octane__octane_override',
  'mcp__octane__octane_card_action',
  'mcp__octane__octane_card_limits',
  'mcp__octane__octane_card_info',
  'mcp__octane__octane_service_request',
]);

export const CONTINUE_AFTER_WRITE_PROMPT =
  '[system: the previous attempt was interrupted AFTER one or more actions already executed — see the ' +
  'transcript above. Do NOT repeat any completed action (money code, manual code, override, card ' +
  'action, card limit/info change, service request). Report the result of what already ran to the user, in their language.]';

/** Preserve whether a streamed attempt emitted a write tool before the iterator itself threw. */
export class QueryStreamError extends Error {
  constructor(
    cause: unknown,
    public readonly usedWriteTool: boolean,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'QueryStreamError';
    incrementCounter('provider_stream_throw_total');
  }
}
import { incrementCounter } from './metrics.js';
