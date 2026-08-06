/**
 * The structured result every child agent returns to the orchestrator (deepagents
 * `responseFormat`). The parent's context grows by one compact JSON per delegation — never a
 * child transcript. `escalate` is how a child asks the orchestrator to re-delegate; the
 * orchestrator can only re-delegate among the caller's RBAC-filtered agents, so escalation
 * can never widen access.
 */
// zod v4 entrypoint — LangChain v1 structured output accepts it natively (see tools/rag note).
import * as z from 'zod/v4';

export const agentResultSchema = z.object({
  answer: z
    .string()
    .describe('The substantive, self-contained result of the task — what the user needs.'),
  citations: z
    .array(
      z.object({
        docId: z.string().describe('Knowledge-base document id the claim is grounded in'),
        note: z.string().optional().describe('What this source supports'),
      }),
    )
    .default([])
    .describe('Knowledge-base documents the answer is grounded in (empty if none used).'),
  claims: z
    .array(
      z.object({
        text: z.string().max(2000),
        evidenceIds: z.array(z.string().max(160)).max(12).default([]),
      }),
    )
    .max(40)
    .default([])
    .describe('Factual claims and the retrieved evidence identifiers supporting each claim.'),
  toolFacts: z
    .array(
      z.object({
        key: z.string().max(120),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        source: z.string().max(160),
        fetchedAt: z.string().max(80),
        expiresAt: z.string().max(80).optional(),
      }),
    )
    .max(30)
    .default([]),
  unresolved: z.array(z.string().max(1000)).max(20).default([]),
  toolsUsed: z.array(z.string()).default([]).describe('Names of tools actually called.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How confident you are that the answer is complete and correct.'),
  escalate: z
    .object({
      toAgent: z.string().describe('Agent key better suited to (part of) this task'),
      reason: z.string().describe('Why this should be escalated'),
    })
    .nullable()
    .default(null)
    .describe('Set ONLY when the task is outside your scope and another agent should take it.'),
});

export type AgentResult = z.infer<typeof agentResultSchema>;
/** Versioned child-to-parent contract; AgentResult remains as a compatibility alias. */
export type SubAgentResultV1 = AgentResult;
