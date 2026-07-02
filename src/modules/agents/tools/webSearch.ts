/**
 * Web search tool for agents whose manifest sets `webSearch: true` (e.g. marketing). Uses
 * OpenAI's built-in `web_search` via the Responses API (the existing OpenAI key — no separate
 * provider). Degrades to a clear message instead of throwing and taking down the run. Output
 * is a trust boundary → wrapped as UNTRUSTED.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
import * as z from 'zod/v4'; // see scopedRag.ts — LangChain v1 tool() wants the zod v4 entrypoint
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
      return text && text.length > 0
        ? wrapUntrusted('web', text)
        : 'Web search returned no usable result.';
    } catch (err) {
      logger.warn({ err }, 'agent web search failed');
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
) as unknown as StructuredTool; // zod v4 tool() generics vs StructuredTool: same-package cast, safe at runtime
