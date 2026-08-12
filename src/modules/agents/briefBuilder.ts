/**
 * The turn brief — everything dynamic the orchestrator/child needs, packed into the HUMAN
 * message so the system prompts stay byte-stable (prompt-prefix caching). Includes a compact
 * summary of the last few turns when the thread is not checkpointer-backed.
 */
import { env } from '../../config/env.js';
import { messageStore } from '../chat/messageStore.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { xmlElement } from './contextXml.js';
import { formatTurnContextXml, type TurnContextV1 } from './turnContext.js';

// Char heuristics on purpose (not tiktoken): every dynamic block here is hard-capped and
// one-directional, so real token counting would add WASM init + per-call cost with no
// enforcement gain at these sizes. Revisit only if history budgets grow substantially.
const MAX_HISTORY_CHARS = 3600; // ≈900 tokens — cheap mechanical trim, no extra LLM call
const RECENT_TURNS = 3;

function compact(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** Mechanically-compressed recent history (user/assistant only — tool noise dropped). */
export async function recentHistorySummary(
  ctx: TenantContext,
  conversationId: string,
): Promise<string> {
  const history = await messageStore.loadHistory(ctx, conversationId);
  const turns: string[] = [];
  for (const msg of history) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text) continue;
    turns.push(`${msg.role}: ${compact(text, 600)}`);
  }
  const recent = turns.slice(-RECENT_TURNS * 2);
  const joined = recent.join('\n');
  return joined.length > MAX_HISTORY_CHARS ? joined.slice(-MAX_HISTORY_CHARS) : joined;
}

export interface TurnBriefInput {
  message: string;
  userName?: string | undefined;
  zohoUserId?: string | undefined;
  profile?: string | undefined;
  role?: string | undefined;
  departments: string[];
  historySummary?: string | undefined;
  clientContext?: {
    profile: string;
    carrierId?: string;
    applicationId?: string;
    cardId?: string;
    parentUserId?: string;
  };
  /** Compact blackboard XML when FF_AGENT_BLACKBOARD. */
  blackboardXml?: string | undefined;
  /** Cached skill hint block when FF_AGENT_SKILL_CACHE. */
  cachedSkillXml?: string | undefined;
  /** Pre-built ExecutionPlan XML when FF_AGENT_PLAN_DAG. */
  executionPlanXml?: string | undefined;
  /** Goal re-anchoring reminder (every Nth turn). */
  goalRecite?: string | undefined;
  /** Extra orchestration hint for plan execution. */
  planHint?: string | undefined;
  /** Canonical v1 context. When present it replaces legacy EnvironmentalContext construction. */
  turnContext?: TurnContextV1 | undefined;
  /**
   * The specialists THIS caller may reach (orchestrator turns only). Runtime, not prompt-static,
   * because the roster is RBAC-filtered per caller — see fleet.ts.
   */
  agentFleetXml?: string | undefined;
}

/** The human message for a turn: identity/date context + optional history + the request. */
export function buildTurnBrief(input: TurnBriefInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];

  if (input.turnContext) {
    parts.push(formatTurnContextXml(input.turnContext));
  } else {
    parts.push('<EnvironmentalContext trust="server-authenticated">');
    parts.push(xmlElement('Date', today, { indent: 2 }));

    if (input.userName || input.zohoUserId || input.profile || input.role || input.departments.length > 0) {
      parts.push('  <UserIdentity>');
      if (input.userName) parts.push(xmlElement('Name', input.userName, { indent: 4, maxChars: 200 }));
      if (input.zohoUserId) parts.push(xmlElement('ZohoUserId', input.zohoUserId, { indent: 4, maxChars: 200 }));
      if (input.profile) parts.push(xmlElement('Profile', input.profile, { indent: 4, maxChars: 200 }));
      if (input.role) parts.push(xmlElement('Role', input.role, { indent: 4, maxChars: 100 }));
      if (input.departments.length > 0) parts.push(xmlElement('Departments', input.departments.join(', '), { indent: 4, maxChars: 1_000 }));
      parts.push('  </UserIdentity>');
    }

    if (input.clientContext) {
      parts.push('  <ClientIdentity>');
      parts.push(xmlElement('Profile', input.clientContext.profile, { indent: 4, maxChars: 200 }));
      if (input.clientContext.carrierId) parts.push(xmlElement('CarrierId', input.clientContext.carrierId, { indent: 4, maxChars: 200 }));
      if (input.clientContext.applicationId) parts.push(xmlElement('ApplicationId', input.clientContext.applicationId, { indent: 4, maxChars: 200 }));
      if (input.clientContext.cardId) parts.push(xmlElement('CardId', input.clientContext.cardId, { indent: 4, maxChars: 200 }));
      if (input.clientContext.parentUserId) parts.push(xmlElement('ParentUserId', input.clientContext.parentUserId, { indent: 4, maxChars: 200 }));
      parts.push('  </ClientIdentity>');
    }

    parts.push('</EnvironmentalContext>');
  }

  if (input.goalRecite) {
    parts.push('<GoalReminder>');
    parts.push(xmlElement('Text', input.goalRecite, { indent: 2, maxChars: 1_000 }));
    parts.push('</GoalReminder>');
  }

  // Before the blackboard and the plan: the orchestrator has to know who it can delegate to
  // before it reasons about what to delegate.
  if (input.agentFleetXml) parts.push(input.agentFleetXml);

  if (input.blackboardXml) parts.push(input.blackboardXml);
  if (input.executionPlanXml) {
    parts.push(input.executionPlanXml);
    if (input.planHint) parts.push(xmlElement('PlanHint', input.planHint, { maxChars: 2_000 }));
  }
  if (input.cachedSkillXml) parts.push(input.cachedSkillXml);

  if (input.historySummary) {
    parts.push('<RecentHistory>');
    parts.push(xmlElement('History', input.historySummary, { indent: 2, maxChars: MAX_HISTORY_CHARS, attrs: { trust: 'conversation' } }));
    parts.push('</RecentHistory>');
  }

  parts.push('<UserRequest>');
  parts.push(xmlElement('ResolvedAsk', input.message, { indent: 2, maxChars: 8_000, attrs: { trust: 'conversation' } }));
  parts.push('</UserRequest>');

  return parts.join('\n');
}

/** True when this user-turn index should re-anchor the overarching goal. */
export function shouldReciteGoal(messageCount: number): boolean {
  const every = env.AGENT_GOAL_RECITE_EVERY;
  if (every <= 0) return false;
  const userTurns = Math.floor(messageCount / 2) + 1; // about to append this turn
  return userTurns > 1 && userTurns % every === 0;
}
