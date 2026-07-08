/**
 * Generative-UI elicitation. When an agent needs the user to choose among specific options it
 * can't disambiguate (which client, which card, which date range), it calls ui.request_choice
 * with a structured option list instead of guessing or asking in free text. The run's stream
 * adapter surfaces the options to the frontend as an `elicitation` event + on the turn result,
 * so the widget renders a picklist; the user's selection returns as the next chat turn.
 *
 * This is a PRESENTATION tool: no backend side effect (riskClass 'read'). The handler just
 * validates and acknowledges so the model stops and waits for the user's pick.
 */
import { z } from 'zod';
import type { ToolManifest } from '../types.js';

// Coerce a model-supplied scalar to a string (models emit carrier ids as numbers, etc.).
const scalar = z.union([z.string(), z.number()]).transform((v) => String(v));

// Schemas here are deliberately LENIENT — the model fills these freely, LangChain validates tool
// input BEFORE our handler, and zod-to-json-schema emits additionalProperties:false + strict types
// by default (which aborts the run on any extra key or number-vs-string). passthrough() + scalar
// coercion + no min-length make the elicitation robust to normal model output.
const optionSchema = z
  .object({
    label: scalar.describe('What the user sees, e.g. the company name'),
    value: scalar.describe('The value returned when picked, e.g. the carrier_id'),
    hint: scalar.optional().describe('Optional secondary line, e.g. payment terms / status'),
  })
  .passthrough();

const inputSchema = z
  .object({
    prompt: z.string().max(500).optional().describe('Short question shown above the choices, e.g. "Which client?"'),
    field: z.string().max(80).optional().describe('What is being collected, e.g. "carrier_id" or "card_number"'),
    options: z.array(optionSchema).max(50).default([]),
    multiSelect: z.boolean().default(false),
  })
  .passthrough();

const outputSchema = z.object({
  presented: z.boolean(),
  field: z.string(),
  count: z.number(),
  message: z.string().optional(),
  // When populated, the agent tool wrapper surfaces this to the frontend as a picker.
  elicitation: z
    .object({
      prompt: z.string(),
      field: z.string(),
      multiSelect: z.boolean(),
      options: z.array(z.object({ label: z.string(), value: z.string(), hint: z.string().optional() })),
    })
    .optional(),
});

export const uiRequestChoiceTool: ToolManifest<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: 'ui.request_choice',
  description:
    'Ask the user to pick from a specific list of options (rendered as a picklist in the UI). Use when you need them to choose a client, card, invoice, date range, etc. — never guess. You MUST populate `options` with real choices FIRST (e.g. call crm.list_my_clients and map each client to {label: company name, value: carrier_id}); never call this with an empty options list. After calling it, briefly tell the user to make a selection and STOP; their choice arrives as the next message.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  async handler(input) {
    const field = input.field ?? 'selection';
    if (input.options.length === 0) {
      // Self-correcting nudge instead of a hard failure — the model called this before fetching data.
      return {
        presented: false,
        field,
        count: 0,
        message:
          'No options were provided. Fetch the choices first (e.g. crm.list_my_clients for a ' +
          'client picker), then call ui.request_choice again with each item as {label, value}.',
      };
    }
    // The agent tool wrapper reads `elicitation` and surfaces it to the frontend as a picker.
    const options = input.options.map((o) => ({
      label: o.label,
      value: o.value,
      ...(o.hint !== undefined ? { hint: o.hint } : {}),
    }));
    return {
      presented: true,
      field,
      count: options.length,
      elicitation: { prompt: input.prompt ?? 'Please choose an option.', field, multiSelect: input.multiSelect, options },
    };
  },
};
