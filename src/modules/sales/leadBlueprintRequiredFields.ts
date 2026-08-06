/**
 * Known Zoho Lead Blueprint transition requirements that agents must fill before Save.
 * Zoho sometimes omits `fields[]` metadata (or returns picklists without options); we still
 * enforce these three stage contracts so Status cannot move without the dependent value.
 */
import type { BlueprintTransition, BlueprintTransitionField } from '../../integrations/zohoCrmRecords.js';
import {
  LEAD_NOT_INTERESTED_REASONS,
  LEAD_UNQUALIFIED_REASONS,
} from './leadStatusValues.js';

type FieldSpec = Omit<BlueprintTransitionField, 'value' | 'readOnly'>;

function pickOpts(values: readonly string[]): Array<{ label: string; value: string }> {
  return values.map((value) => ({ label: value, value }));
}

/** Stage → required transition data fields (Zoho API names). */
const REQUIRED_BY_STATUS: Record<string, FieldSpec[]> = {
  'Application Filled': [
    {
      apiName: 'Application_ID',
      label: 'Application ID',
      dataType: 'text',
      mandatory: true,
      options: [],
    },
  ],
  'Not Interested': [
    {
      apiName: 'Not_Interested_Reason',
      label: 'Not Interested Reason',
      dataType: 'picklist',
      mandatory: true,
      options: pickOpts(LEAD_NOT_INTERESTED_REASONS),
    },
  ],
  Unqualified: [
    {
      apiName: 'Unqualified_Reason',
      label: 'Unqualified Reason',
      dataType: 'picklist',
      mandatory: true,
      options: pickOpts(LEAD_UNQUALIFIED_REASONS),
    },
  ],
};

function labelMatches(field: BlueprintTransitionField, apiName: string, label: string): boolean {
  if (field.apiName === apiName) return true;
  const needle = label.toLowerCase().replace(/\s+/g, '');
  const hay = field.label.toLowerCase().replace(/\s+/g, '');
  return hay === needle || hay.includes(needle);
}

/**
 * Merge Zoho's live transition fields with the known required set for `nextValue`.
 * Existing Zoho rows win on apiName/type/value; we force `mandatory` and backfill empty picklists.
 */
export function enrichLeadBlueprintFields(
  nextValue: string,
  fields: BlueprintTransitionField[],
): BlueprintTransitionField[] {
  const specs = REQUIRED_BY_STATUS[nextValue];
  if (!specs) return fields;

  const out: BlueprintTransitionField[] = fields.map((field) => ({
    ...field,
    options: [...field.options],
  }));

  for (const spec of specs) {
    const idx = out.findIndex((field) => labelMatches(field, spec.apiName, spec.label));
    if (idx >= 0) {
      const existing = out[idx]!;
      const usePicklist = spec.dataType === 'picklist' || existing.options.length > 0 || existing.dataType === 'picklist';
      out[idx] = {
        ...existing,
        mandatory: true,
        // Prefer Zoho's apiName when matched by label only.
        apiName: existing.apiName || spec.apiName,
        options: existing.options.length > 0 ? existing.options : spec.options,
        dataType: usePicklist ? 'picklist' : (existing.dataType || spec.dataType),
      };
      continue;
    }
    out.push({
      apiName: spec.apiName,
      label: spec.label,
      dataType: spec.dataType,
      mandatory: true,
      readOnly: false,
      value: null,
      options: spec.options,
    });
  }
  return out;
}

/** Enrich every transition on a Blueprint details payload (GET + execute paths). */
export function enrichLeadBlueprintTransitions(
  transitions: BlueprintTransition[],
): BlueprintTransition[] {
  return transitions.map((transition) => ({
    ...transition,
    fields: enrichLeadBlueprintFields(transition.nextValue, transition.fields),
  }));
}
