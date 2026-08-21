/** User-attributed Lead status edits, including Zoho Blueprint-controlled transitions. */
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import {
  executeBlueprintTransitionAsUser,
  updateRecordAsUser,
  zohoActorId,
} from '../../integrations/zohoUserAuth.js';
import { AppError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { enrichLeadBlueprintFields } from './leadBlueprintRequiredFields.js';

const TRANSITION_KEYS = ['Unqualified_Reason', 'Not_Interested_Reason', 'Application_ID'];

function crmReadError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('Zoho CRM request failed', {
    statusCode: 502,
    code: 'ZOHO_CRM_ERROR',
    cause: err,
    expose: true,
  });
}

/**
 * Persist non-status fields first, then move Status through the current Blueprint transition (or a
 * normal update when no Blueprint is active). Every mutation uses the real actor's OAuth token.
 */
export async function applyLeadUpdateWithStatus(
  ctx: TenantContext,
  id: string,
  resolved: Record<string, unknown>,
): Promise<string[]> {
  const actorId = zohoActorId(ctx);
  const targetStatus = String(resolved.Status ?? '');
  const transitionData: Record<string, unknown> = {};
  for (const key of TRANSITION_KEYS) {
    if (key in resolved) transitionData[key] = resolved[key];
  }
  const rest = Object.fromEntries(
    Object.entries(resolved).filter(([key]) => key !== 'Status' && !TRANSITION_KEYS.includes(key)),
  );
  const written: string[] = [];

  if (Object.keys(rest).length > 0) {
    await updateRecordAsUser(ctx.tenantId, actorId, 'Leads', id, rest);
    written.push(...Object.keys(rest));
  }

  let blueprint: Awaited<ReturnType<typeof zohoCrmRecords.getBlueprintDetails>>;
  try {
    blueprint = await zohoCrmRecords.getBlueprintDetails('Leads', id);
  } catch (err) {
    throw crmReadError(err);
  }
  if (blueprint === null) {
    await updateRecordAsUser(ctx.tenantId, actorId, 'Leads', id, {
      Status: targetStatus,
      ...transitionData,
    });
  } else {
    const transitions = blueprint.transitions.filter(
      (transition) => transition.type === 'manual' && transition.criteriaMatched,
    );
    const match = transitions.find((transition) => transition.nextValue === targetStatus);
    if (!match) {
      const allowed = transitions
        .map((transition) => transition.nextValue)
        .filter((value) => value && value !== '-None-')
        .join(', ');
      throw new AppError(
        `"${targetStatus}" isn't an available status transition for this lead right now (Zoho Blueprint). Allowed: ${allowed}.`,
        { statusCode: 422, code: 'BLUEPRINT_TRANSITION_INVALID', expose: true },
      );
    }
    const fields = enrichLeadBlueprintFields(match.nextValue, match.fields);
    const missing = fields.find((field) => {
      if (!field.mandatory || field.readOnly) return false;
      const supplied = transitionData[field.apiName];
      return (
        (supplied === undefined || supplied === null || supplied === '') &&
        (field.value === undefined || field.value === null || field.value === '')
      );
    });
    if (missing) {
      throw new AppError(`Blueprint field "${missing.label}" is required.`, {
        statusCode: 400,
        code: 'BLUEPRINT_FIELD_REQUIRED',
        expose: true,
      });
    }
    await executeBlueprintTransitionAsUser(
      ctx.tenantId,
      actorId,
      'Leads',
      id,
      match.id,
      transitionData,
    );
  }
  written.push('Status', ...Object.keys(transitionData));
  return written;
}
