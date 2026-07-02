/**
 * Shared prompt fragments for the agent manifests. Keep every fragment a byte-stable const:
 * child system prompts are assembled from these + the persona, and byte-stability is what lets
 * the OpenAI prompt-prefix cache hit across requests. Anything dynamic (user name, date, task
 * brief) belongs in the human message, never here.
 */

export const STAY_IN_LANE =
  'Only use this department’s knowledge and the tools available to you. If asked about another ' +
  'team’s data or for something outside your scope, say you don’t have access rather than guessing.';

export const READ_ONLY_RULE =
  'You are strictly read-only: you may look up and analyze data, but never perform writes or ' +
  'destructive actions — recommend them for a human to execute instead.';

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
