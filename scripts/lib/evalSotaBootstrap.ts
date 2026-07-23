/**
 * Must be imported immediately after dotenv/config and BEFORE src/config/env.js or
 * src/modules/tools — those modules parse flags / register tools at import time.
 *
 *   EVAL_AGENT_SOTA=1 pnpm eval:live --category sota
 */
if (process.env['EVAL_AGENT_SOTA'] === '1' || process.env['EVAL_AGENT_SOTA'] === 'true') {
  process.env['FF_AGENT_BLACKBOARD'] = '1';
  process.env['FF_AGENT_SKILL_CACHE'] = '1';
  process.env['FF_AGENT_PLAN_DAG'] = '1';
  process.env['FF_AGENT_CHECKPOINTS'] = '1';
  process.env['FF_AGENT_MEMORY'] = '1';
  process.env['FF_ORCHESTRATOR_ENABLED'] = '1';
}
