/**
 * The orchestrator's view of its own fleet — "how many agents do I have, and what does each own".
 *
 * This is RUNTIME context, not a skill, and the distinction is load-bearing. The roster is
 * RBAC-filtered per caller (`agentRegistry.listForContext`), so a sales rep's orchestrator genuinely
 * contains fewer agents than an admin's. Baking a fleet list into the byte-stable system prompt
 * would therefore be a lie for most callers — and worse, it would advertise specialists the caller
 * cannot reach, which is how the model ends up naming a specialist that is not in its tool list.
 *
 * So the fleet is projected into the turn brief (the human message) alongside identity, and the
 * *reasoning* about how to use it lives in the orchestrator's routing skill.
 */
import { xmlAttr, xmlElement } from './contextXml.js';
import type { AgentManifest } from './types.js';

const MAX_DESCRIPTION_CHARS = 400;

/**
 * Compact XML roster of the specialists THIS caller may reach. Returns '' for an empty fleet so the
 * brief does not carry an empty block — an orchestrator with no specialists should say it cannot
 * help, not reason about an empty list.
 */
export function formatAgentFleetXml(manifests: readonly AgentManifest[]): string {
  if (manifests.length === 0) return '';
  const rows = manifests
    .map((m) => {
      const departments = m.departments.length > 0 ? m.departments.join(', ') : 'admin-only';
      return (
        `  <Agent key="${xmlAttr(m.key)}" label="${xmlAttr(m.label)}" departments="${xmlAttr(departments)}"` +
        `${m.readOnly ? ' readOnly="true"' : ''}>\n` +
        `${xmlElement('Owns', m.description, { indent: 4, maxChars: MAX_DESCRIPTION_CHARS })}\n` +
        `  </Agent>`
      );
    })
    .join('\n');

  return (
    `<AgentFleet count="${manifests.length}" trust="server-authenticated">\n` +
    `${rows}\n` +
    '  <Note>This is the COMPLETE list of specialists available for this caller, already filtered by ' +
    'their access. Never name a specialist that is not listed here. If none fits, say plainly that it ' +
    'needs access you do not have.</Note>\n' +
    '</AgentFleet>'
  );
}
