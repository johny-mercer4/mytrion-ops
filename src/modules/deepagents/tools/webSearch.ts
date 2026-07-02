/**
 * Web search tool for the web-search-agent subagent. Uses OpenAI's built-in `web_search` tool via
 * the Responses API (the existing OpenAI key — no Tavily / separate provider). Wrapped so that a
 * model/account that doesn't support web search degrades to a clear message instead of throwing and
 * taking down the run.
 */
import { tool } from '@langchain/core/tools';
import * as z from 'zod/v4'; // see rag.ts — LangChain v1 tool() wants the zod v4 entrypoint
import type OpenAI from 'openai';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getOpenAI } from '../../llm/openaiClient.js';
import { wrapUntrusted } from '../../security/untrusted.js';

// The Responses web-search built-in tool. Typed locally so the literal matches the SDK union.
const WEB_SEARCH_TOOL: OpenAI.Responses.Tool = { type: 'web_search_preview' };

export const webSearchTool = tool(
  async ({ query }: { query: string }) => {
    try {
      const res = await getOpenAI().responses.create({
        model: env.DEEP_WEB_SEARCH_MODEL,
        tools: [WEB_SEARCH_TOOL],
        input: query,
      });
      const text = res.output_text?.trim();
      // Web content is a trust boundary: wrapped so injected instructions stay inert.
      return text && text.length > 0
        ? wrapUntrusted('web', text)
        : 'Web search returned no usable result.';
    } catch (err) {
      logger.warn({ err }, 'deepagents web search failed');
      const reason = err instanceof Error ? err.message : 'unknown error';
      return `Web search is currently unavailable (${reason}).`;
    }
  },
  {
    name: 'internet_search',
    description:
      'Search the public web for current or external information using OpenAI web search. Use for ' +
      'recent events, external facts, or anything not in the internal Octane knowledge base.',
    schema: z.object({
      query: z.string().min(1).max(1000).describe('The web search query'),
    }),
  },
);
