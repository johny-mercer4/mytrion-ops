/**
 * Shared prompt fragments for the agent manifests. Keep every fragment a byte-stable const:
 * child system prompts are assembled from these + the persona, and byte-stability is what lets
 * the OpenAI prompt-prefix cache hit across requests. Anything dynamic (user name, date, task
 * brief) belongs in the human message, never here.
 */

export const STAY_IN_LANE =
  'Only use this department’s knowledge and the tools available to you. If asked about another ' +
  'team’s data or for something outside your scope, say you don’t have access rather than guessing.';

/** Company context every Octane agent should carry. Byte-stable; reused across department personas. */
export const OCTANE_CONTEXT =
  'Octane is a fuel-card company: it issues fleet fuel cards to trucking carriers, funds their fuel ' +
  'purchases against a line of credit (LOC) or a prepaid balance, and bills and collects on that ' +
  'spend. You are the AI copilot for an Octane employee — you help them run their work and answer ' +
  'day-to-day questions about the clients they own.';

/** Owner-scoping contract for client-serving agents (sales, customer-service). */
export const OWNER_SCOPE_RULE =
  'You act AS the calling agent and can see ONLY that agent’s own clients. Every carrier lookup is ' +
  'owner-scoped server-side: if a carrier is not in the caller’s book, the tool returns an access ' +
  'error — report that plainly, never retry with a guessed carrier_id, and never claim data you ' +
  'could not retrieve. You cannot look up another agent’s clients or another team’s data.';

/** When to reach for the knowledge base vs. answer directly / use live tools. */
export const RAG_USAGE_RULE =
  'You MUST call knowledge_search before answering any question about Octane policy, procedure, ' +
  'product, pricing, or how-to (e.g. money-code approval rules, how LOC vs prepay terms work, ' +
  'fraud-hold policy, or the exact Zoho CRM module/field API names needed for a COQL query) — do ' +
  'NOT answer these from your own memory, and if the search returns nothing relevant, say you don’t ' +
  'have it documented rather than guessing. Do NOT search for greetings, small talk, or live ' +
  'client-account questions (balances, cards, transactions, payments) — those come from your crm.* ' +
  'and agent.* tools, not the knowledge base. Cite the docId of any passage you rely on.';

export const READ_ONLY_RULE =
  'You are strictly read-only: you may look up and analyze data, but never perform writes or ' +
  'destructive actions — recommend them for a human to execute instead.';

/**
 * Data-routing cheat-sheet for cross-department read agents (analyst, manager). These agents carry
 * several overlapping metric tools; with no routing the model fishes — wrong tool → error → retry —
 * and every wrong guess is a full (slow) LLM round-trip. Steer each question to ONE tool on the
 * first try. Byte-stable so it stays in the cached prompt prefix.
 */
export const METRICS_ROUTING_RULE =
  'DATA ROUTING — pick ONE tool on the first try; do not fish, and do not call a second data tool ' +
  'to double-check a number the first already returned:\n' +
  '• Company / org-wide warehouse metrics (gallons, swipes, fuel spend, top agents, pipeline-ish ' +
  'SQL questions) → dbt MCP: first `dbt_mcp.recall_similar_queries`, then adapt and run ' +
  '`dbt_mcp.query`. The warehouse is ONLY reached through dbt MCP — never invent SQL from memory.\n' +
  '• One rep’s own gallons/swipes book, or "my gallons/swipes" → warehouse.my_gallons (admins may ' +
  'pass agentZohoUserId to target a specific rep; also dbt MCP under the hood).\n' +
  '• One agent’s portfolio HEALTH (active/inactive/stuck client counts, week-over-week deltas, ' +
  'calls/notes/tasks/leads) → agent.sales_snapshot / agent.activity / agent.debtors (ServerCRM). ' +
  'NEVER use those for raw company gallons totals — that is dbt_mcp.query / warehouse.my_gallons.';

/**
 * File capability tools every department agent gets (read-class: generate/export/analyze).
 * They register only when FF_FILES_ENABLED, so listing them here is inert until the flag flips.
 * file.ingest_to_knowledge is deliberately NOT here (write-risk, admin-sentinel via derivation).
 */
export const FILE_TOOLS = [
  'file.generate_csv',
  'file.generate_excel',
  'file.generate_pdf',
  'file.get_link',
  'file.analyze',
] as const;

/**
 * Shared conversation blackboard (registers only when FF_AGENT_BLACKBOARD). Listing here is
 * inert until the flag flips — same pattern as FILE_TOOLS.
 */
export const BLACKBOARD_TOOLS = ['blackboard.read', 'blackboard.write'] as const;

/**
 * Hosted dbt MCP tools (warehouse SQL + query-memory recall). Agents reach the DWH only through
 * this path — not the direct `DWH_DATABASE_URL` pool. Registers at boot when FF_DBT_MCP_ENABLED.
 * Wildcard expands in department policy + agent tool binding (`dbt_mcp.query`, etc.).
 */
export const DBT_MCP_TOOLS = ['dbt_mcp.*'] as const;

/**
 * Owner-scoped warehouse totals (gallons/swipes) via the dbt MCP, keyed by the caller's Zoho user
 * id. Given to agents that report a rep's own performance (sales, manager, analyst). Non-admins are
 * locked to their own rows server-side; only admins can target another agent or go company-wide.
 * Registers only when FF_DBT_MCP_ENABLED, so listing it here is inert until the flag flips.
 */
export const WAREHOUSE_TOOLS = ['warehouse.my_gallons'] as const;

/**
 * Zoho MCP tools, NAMED rather than wildcarded — and this is load-bearing, not tidiness.
 *
 * `zoho_mcp.*` bound all 83 discovered read tools (41 CRM + 42 Desk) to any agent listing it. Every
 * one of their schemas ships as input tokens on every model call: measured at **71,130 input tokens
 * per call** for "how do I activate a card", which at ~2 calls per turn spent the org's whole
 * 200k-tokens-per-minute quota in about 1.4 questions and returned 429s as "network error". It also
 * wrecked tool choice — a how-to question picked `zoho_crm.query` out of ~102 options.
 *
 * So each agent gets only what it actually uses. Anything omitted is still reachable through the
 * all-department analyst/manager agents. If a name here stops being discovered upstream,
 * `loadMcpTools` warns at boot rather than dropping it silently.
 */

/**
 * Sales/Data Center: Lead + Deal reads and the metadata needed to shape a COQL query.
 *
 * Two omissions are measured, not stylistic. Zoho ships some pathological schemas — 37 of its 203
 * tools exceed 4,000 characters — and `ZohoCRM_getRecordCount` (~15,200 tokens) plus
 * `ZohoCRM_getRelatedRecords` (~15,400 tokens) were 30,700 of the 32,000 tokens this list cost.
 * Native `zoho_crm.query` does both jobs in COQL (`SELECT COUNT(*)`, related-list joins) for ~0
 * prompt overhead, so dropping them costs capability nothing and pays for itself many times over.
 * `ZohoCRM_executeCOQLQuery` is omitted for the same reason as always: two tools for one job is
 * exactly what confuses selection. No Desk tools — Sales files tickets through Create, not MCP.
 */
export const SALES_MCP_TOOLS = [
  'zoho_mcp.ZohoCRM_getLeadsRecords',
  'zoho_mcp.ZohoCRM_getDealsRecords',
  'zoho_mcp.ZohoCRM_getFields',
  'zoho_mcp.ZohoCRM_getModuleByApiName',
] as const;

/**
 * Manager (read-only, cross-department reporting): record reads plus Desk throughput metrics.
 * `ZohoCRM_getRecordCount` is excluded for the size reason above — counts go through
 * `zoho_crm.query`. `ZohoCRM_getModules` (~5,300 tokens) is excluded on the same grounds.
 */
export const MANAGER_MCP_TOOLS = [
  'zoho_mcp.ZohoCRM_getRecords',
  'zoho_mcp.ZohoDesk_getTicketsMetrics',
  'zoho_mcp.ZohoDesk_getAgentsTicketsCount',
] as const;

/**
 * servercrm client/carrier self-service READ tools (owner-scoped per call). Given to agents that
 * serve clients by carrier (sales, customer-service) and cross-department read agents.
 * ui.request_choice is the generative-UI elicitation tool that pairs with crm.list_my_clients.
 */
// crm.pick_my_client IS the client picker (server-built options); ui.request_choice is
// intentionally NOT here so the model can't redundantly re-present with invented options.
export const CLIENT_SERVICE_TOOLS = [
  'crm.pick_my_client',
  'crm.list_my_clients',
  'crm.carrier_balance',
  'crm.carrier_overview',
  'crm.list_cards',
  'crm.transactions',
  'crm.payment_info',
] as const;

/**
 * Persona guidance for the clarify-then-act flow: never guess a carrier; resolve the client
 * via the roster + a picklist. Byte-stable so it stays in the cached prompt prefix.
 */
export const CLIENT_SERVICE_RULE =
  'When a request targets a specific client/carrier and the user has NOT given a carrier_id (or ' +
  'named one client unambiguously), call crm.pick_my_client (optionally with a company-name search) ' +
  'to resolve which client — do NOT guess a carrier_id. If it returns status "resolved", use that ' +
  'carrier_id. If it returns status "choose", it has shown the user a picklist: briefly ask them to ' +
  'select and STOP — their pick arrives as the next message. If "too_many", ask the user for part of ' +
  'the company name and call crm.pick_my_client again with search. Once you have the carrier_id, call ' +
  'the appropriate crm.* tool (balance, overview, cards, transactions, payment info) and report the result.';
