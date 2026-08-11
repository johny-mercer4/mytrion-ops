import type { AgentSkill } from '../types.js';

/**
 * How caller identity reaches a specialist. The failure this prevents is subtle and expensive: a
 * brief that omits WHO is asking produces an answer scoped to nobody, and a brief that pastes
 * identity XML produces an answer the server then refuses.
 */
export const ORCHESTRATOR_CONTEXT_SKILL: AgentSkill = {
  name: 'orchestrator-context',
  whenToUse:
    'Before writing any task brief — especially when the request says "my", "me", or "our", names a ' +
    'client, or covers a date range.',
  body: `# Passing context to a specialist

A specialist sees **only your brief**. Not the conversation, not the user's name, not the previous
specialist's answer. Everything it needs must be in the brief or it will ask for it, guess, or fail.

## What the server already handles — do not duplicate it

The server builds a trusted <TurnContext> for every child containing the caller's identity: name,
Zoho user id, profile, role, departments. Every tool wrapper re-derives the caller's scope from the
session server-side.

So:

- **Never copy, edit, or re-state identity or scope XML into a brief.** It is already there, and a
  hand-written copy is not authority — the server ignores it. Two identities in one prompt is how a
  specialist ends up reasoning about the wrong person.
- **Never put a user id in a brief to grant access.** Access is decided by the session. If the
  server denies a tool, report the denial; do not try to route around it with an id.
- **Context role/department fields are descriptive.** They tell the specialist who it is serving.
  They do not widen what it may do.

## What YOU must put in the brief

Everything the server does not know because it is specific to this request:

1. **The exact question**, self-contained. Not "check that for them" — the specialist has no "that".
2. **Identifiers you have already resolved**: carrier_id, deal id, card number, application id,
   ticket id. If a previous specialist resolved one, pass it forward explicitly.
3. **The date range**, resolved to concrete dates. "Last month" means nothing without today's date;
   the specialist may compute a different boundary than you intended.
4. **Constraints** the user stated: only active cards, exclude prepay, top 5 only.
5. **What has already been established**, so the specialist does not redo it. Prefer pointing at
   <Blackboard> / blackboard.read over pasting a large tool dump.

## Resolving "me" and "my"

These are the most common words in real requests and the easiest to get wrong.

- "my clients", "my gallons", "my pipeline" → the caller's OWN book. The specialist's tools are
  owner-scoped server-side from the session, so the correct brief says *"the caller's own …"* and
  supplies no user id at all.
- Do **not** translate "my" into a name or id you saw in context. If the caller is Bob and you write
  "Bob's clients", you have converted a server-enforced scope into a free-text filter the specialist
  may apply differently, or fail on if two people share a first name.
- An administrator asking about **someone else's** book is different: that needs the target person
  named explicitly, and only some tools accept it. Say who, and let the specialist refuse if it
  cannot.

## Sequencing

When specialist B needs specialist A's output, wait for A, then put A's concrete result into B's
brief. Do not run them in parallel and hope. When the tasks are genuinely independent — a CRM record
from sales and an invoice from billing — call the task tool multiple times in one step so they run
concurrently.`,
};
