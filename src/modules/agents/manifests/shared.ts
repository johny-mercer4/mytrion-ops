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
