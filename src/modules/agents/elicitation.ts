/**
 * Generative-UI elicitation types + normalization. A tool that needs the user to choose from
 * options returns an `elicitation` field in its output; the per-agent tool wrapper stashes it
 * into the run's ElicitationHolder, and orchestratorService surfaces it on the turn result +
 * an `elicitation` SSE event. The frontend renders a picker; the user's pick returns as the
 * next chat turn.
 *
 * Options are built SERVER-SIDE (e.g. crm.pick_my_client) — the model never hand-copies a big
 * option array, which keeps this robust to model output and avoids tool-input validation churn.
 */
export interface ElicitationChoice {
  label: string;
  value: string;
  hint?: string;
}

export interface Elicitation {
  prompt: string;
  field: string;
  multiSelect: boolean;
  options: ElicitationChoice[];
}

export interface ElicitationHolder {
  elicitation?: Elicitation;
}

const scalar = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;

/** Validate/normalize an arbitrary object into an Elicitation, or undefined if it has no options. */
export function coerceElicitation(raw: unknown): Elicitation | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const rawOptions = Array.isArray(r['options']) ? (r['options'] as unknown[]) : [];
  const options: ElicitationChoice[] = rawOptions
    .map((o) => {
      if (typeof o !== 'object' || o === null) return null;
      const or = o as Record<string, unknown>;
      const label = scalar(or['label']);
      const value = scalar(or['value']);
      if (label === undefined || value === undefined) return null;
      const hint = scalar(or['hint']);
      return { label, value, ...(hint !== undefined ? { hint } : {}) };
    })
    .filter((o): o is ElicitationChoice => o !== null);
  if (options.length === 0) return undefined;
  return {
    prompt: typeof r['prompt'] === 'string' ? r['prompt'] : 'Please choose an option.',
    field: typeof r['field'] === 'string' ? r['field'] : 'selection',
    multiSelect: r['multiSelect'] === true,
    options,
  };
}
