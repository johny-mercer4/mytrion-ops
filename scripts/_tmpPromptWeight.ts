/**
 * Where does an answer-role call's input budget actually go?
 * Measured 12,744 avg input tokens/call on the bench; this decomposes it.
 */
import { ALL_AGENT_MANIFESTS } from '../src/modules/agents/manifests/index.js';
import { childSystemPrompt, ORCHESTRATOR_SYSTEM_PROMPT } from '../src/modules/agents/prompts.js';
import { toolRegistry } from '../src/modules/tools/index.js';
import { formatSkillIndex } from '../src/modules/agents/skills/registry.js';

const tok = (s: string): number => Math.ceil(s.length / 4); // ~4 chars/token, good enough for shares

const sales = ALL_AGENT_MANIFESTS.find((m) => m.key === 'sales')!;

const persona = sales.persona;
const fullSystem = childSystemPrompt(sales);
const skillIndex = formatSkillIndex(sales.skills);
const sharedRules = fullSystem.length - persona.length - skillIndex.length;

console.log('=== SALES agent system prompt ===');
console.log(`  persona            ${String(tok(persona)).padStart(6)} tok`);
console.log(`  shared rules       ${String(Math.ceil(sharedRules / 4)).padStart(6)} tok`);
console.log(`  skill index        ${String(tok(skillIndex)).padStart(6)} tok`);
console.log(`  TOTAL system       ${String(tok(fullSystem)).padStart(6)} tok`);

console.log('\n=== ORCHESTRATOR system prompt ===');
console.log(`  TOTAL              ${String(tok(ORCHESTRATOR_SYSTEM_PROMPT)).padStart(6)} tok`);

// Tool schemas: what the model is charged for every call that binds them.
console.log('\n=== Tool schemas bound to SALES (registered ones only) ===');
const registered = toolRegistry.all();
const salesToolNames = new Set(sales.tools);
let schemaTotal = 0;
const rows: Array<{ name: string; tokens: number }> = [];
for (const tool of registered) {
  const listed =
    salesToolNames.has(tool.name) ||
    [...salesToolNames].some((t) => t.endsWith('.*') && tool.name.startsWith(t.slice(0, -1)));
  if (!listed) continue;
  const schema = JSON.stringify(tool.rawParameters ?? {});
  const size = tok(`${tool.name}${tool.description}${schema}`);
  schemaTotal += size;
  rows.push({ name: tool.name, tokens: size });
}
rows.sort((a, b) => b.tokens - a.tokens);
for (const r of rows.slice(0, 12)) console.log(`  ${r.name.padEnd(28)} ${String(r.tokens).padStart(6)} tok`);
console.log(`  ---\n  ${String(rows.length).padStart(2)} registered tools  ${String(schemaTotal).padStart(6)} tok`);

console.log('\n=== NOT loaded locally but bound in PROD ===');
const wildcards = sales.tools.filter((t) => t.endsWith('.*'));
const namedMcp = sales.tools.filter((t) => t.startsWith('zoho_mcp.'));
console.log(`  wildcards: ${wildcards.join(', ') || '(none)'}`);
console.log(`  named Zoho MCP: ${namedMcp.length} tools`);
console.log('  -> dbt MCP + Zoho MCP schemas are ABSENT from the local measurement.');
