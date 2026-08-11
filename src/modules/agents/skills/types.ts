/**
 * AgentSkill — an authored, versioned procedural capability assigned to an agent by manifest.
 *
 * NOT the same thing as `skillCache.ts`. That distills tool trajectories automatically and offers
 * them back as untrusted *suggestions*; nobody writes or reviews them. These are hand-authored,
 * live in git, and change by PR — the same review discipline as prompts and tool manifests.
 *
 * PROGRESSIVE DISCLOSURE is the whole design constraint. A skill's `whenToUse` is always in the
 * agent's system prompt; its `body` is only fetched when the agent calls `skill.read`. That split
 * exists because prompt weight is not free here: binding all 83 discovered Zoho MCP tools once cost
 * 71,130 input tokens per call and burned the org's per-minute quota in about 1.4 questions
 * (see mcpTools.ts). A skill library that injected every body would repeat that mistake with prose.
 *
 * Everything here is a byte-stable const so the cached prompt prefix still hits: `whenToUse` enters
 * the system prompt, and the index is derived from the manifest's static skill list.
 */

export interface AgentSkill {
  /** Stable kebab-case id. Referenced from AgentManifest.skills and by the skill.read tool. */
  name: string;
  /**
   * ≤2 sentences, ALWAYS present in the agent's system prompt. This is the only thing the model
   * sees before deciding whether to spend a tool call on the body, so it must be written in the
   * words a worker would actually use — not in terms of the system's internals.
   */
  whenToUse: string;
  /**
   * The full procedure, fetched on demand. Written for the agent, not the end user: concrete steps,
   * the exact tools to call and in what order, the traps, and what NOT to do.
   */
  body: string;
  /**
   * Registry tool names this body tells the agent to call. Validated in tests against the real tool
   * registry, because a skill naming a tool that no longer exists is silent capability rot — the
   * same drift `warnOnMissingAllowlistedTools` exists to catch for MCP allowlists.
   *
   * A skill may legitimately reference a tool the CALLER cannot use (RBAC narrows per request); the
   * body must therefore say what to do when a tool comes back denied, never assume availability.
   */
  usesTools?: readonly string[];
}

/** Skill names are the assignment unit on a manifest. */
export type SkillName = string;
