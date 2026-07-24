import { z } from 'zod';
import { callMcpTool } from '../../../integrations/zohoMcp.js';
import { retrieve } from '../../knowledge/retriever.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  module: z.string().describe('The target module (e.g., Leads, Contacts, Accounts).'),
  keyword: z.string().describe("The user's natural language search term (e.g., email, name, phone)."),
  intent: z.string().describe('What the agent is trying to find.'),
});

const outputSchema = z.object({
  contextUsed: z.string(),
  results: z.array(z.record(z.unknown())),
  count: z.number(),
});

export const zohoCrmSearchTool: ToolManifest<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: 'zoho_crm.search',
  description:
    'Speculative execution search for Zoho CRM. Automatically understands context (via RAG) for module fields ' +
    'and runs parallel searches across likely fields (Name, Email, Phone) to find records matching a keyword.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_crm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    // 1. RAG-Powered Context Fetching
    const ragQuery = `${input.module} exact API field names for Email, Phone, Name`;
    const passages = await retrieve(ctx, ragQuery, 2);
    
    // We pass the context back so the LLM knows what fields were discovered/assumed.
    const contextUsed = passages.map(p => p.content).join('\\n');
    
    // Fallback/standard fields (nameField is module-dependent below; the others never change)
    const emailField = 'Email';
    let nameField = 'Last_Name';
    const phoneField = 'Phone';
    
    // Some modules use "Account_Name", "Deal_Name", "Contact_Name".
    if (input.module.toLowerCase() === 'accounts') nameField = 'Account_Name';
    if (input.module.toLowerCase() === 'deals') nameField = 'Deal_Name';

    // Escape keyword to prevent COQL injection
    const keyword = input.keyword.replace(/'/g, "''");

    // 2. Parallel Speculative Execution
    // We use Promise.allSettled so if a module lacks 'Email', it doesn't fail the whole search.
    const queries = [
      `select id, ${nameField} from ${input.module} where ${emailField} = '${keyword}'`,
      `select id, ${nameField} from ${input.module} where ${nameField} like '${keyword}%'`,
      `select id, ${nameField} from ${input.module} where ${phoneField} like '%${keyword}%'`,
    ];
    
    const results = await Promise.allSettled(
      queries.map(async (q) => {
        // Same untyped COQL envelope as zoho_crm_query: bare array or { data } wrapper.
        const res = (await callMcpTool('coql', { select_query: q }, ctx)) as
          | { data?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>
          | null;
        return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      })
    );
    
    // 3. Result Aggregation
    const merged = new Map<string, Record<string, unknown>>();
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        for (const row of res.value) {
          if (row.id) {
            merged.set(String(row.id), row);
          }
        }
      }
    }
    
    const finalRows = Array.from(merged.values());
    
    return {
      contextUsed: contextUsed.slice(0, 500) + '...', // return a snippet of RAG to prove it worked
      results: finalRows,
      count: finalRows.length,
    };
  },
};
