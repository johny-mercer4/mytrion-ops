/**
 * Runtime Lead Blueprint transitions. Zoho decides which transitions are valid for each record;
 * callers submit an id from that live response rather than writing the Blueprint field directly.
 */
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError } from '../../lib/errors.js';
import {
  enrichLeadBlueprintFields,
  enrichLeadBlueprintTransitions,
} from './leadBlueprintRequiredFields.js';

export type BlueprintInputValue = string | number | boolean | null;

export { enrichLeadBlueprintFields, enrichLeadBlueprintTransitions };

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export async function executeLeadBlueprintTransition(
  leadId: string,
  transitionId: string,
  data: Record<string, BlueprintInputValue>,
): Promise<{ currentValue: string; nextValue: string; transitionName: string }> {
  const blueprint = await zohoCrmRecords.getBlueprintDetails('Leads', leadId);
  if (!blueprint) {
    throw new AppError('This lead is not in an active Zoho Blueprint.', {
      statusCode: 409,
      code: 'BLUEPRINT_NOT_ACTIVE',
      expose: true,
    });
  }

  const transition = blueprint.transitions.find((candidate) => candidate.id === transitionId);
  if (!transition || transition.type !== 'manual' || !transition.criteriaMatched) {
    throw new AppError('That Blueprint transition is no longer available for this lead. Refresh and try again.', {
      statusCode: 409,
      code: 'BLUEPRINT_TRANSITION_STALE',
      expose: true,
    });
  }

  // Known stage contracts (Application ID / reason picklists) even when Zoho omits field metadata.
  const fields = enrichLeadBlueprintFields(transition.nextValue, transition.fields);

  const writableFields = new Set(
    fields.filter((field) => !field.readOnly && field.apiName).map((field) => field.apiName),
  );
  const unknownField = Object.keys(data).find((apiName) => !writableFields.has(apiName));
  if (unknownField) {
    throw new AppError(`Field "${unknownField}" is not accepted by this Blueprint transition.`, {
      statusCode: 400,
      code: 'BLUEPRINT_FIELD_INVALID',
      expose: true,
    });
  }

  const missing = fields.find(
    (field) => field.mandatory && !field.readOnly && !hasValue(data[field.apiName]) && !hasValue(field.value),
  );
  if (missing) {
    throw new AppError(`Blueprint field "${missing.label}" is required.`, {
      statusCode: 400,
      code: 'BLUEPRINT_FIELD_REQUIRED',
      expose: true,
    });
  }

  await zohoCrmRecords.executeBlueprintTransition('Leads', leadId, transition.id, data);
  return {
    currentValue: blueprint.process.currentValue,
    nextValue: transition.nextValue,
    transitionName: transition.name,
  };
}
