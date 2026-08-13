/**
 * Per-stage pipeline view from a credit_platform `requests.result`: lifecycle from
 * `manual_review.stage_flow`, each stage's own report from `step_results`, plus a stopped-by reason.
 */
import {
  STAGE_CATALOG,
  normalizeStageFlowStatus,
  normalizeStageStatus,
  type PipelineStage,
  type PipelineStageId,
} from './types.js';

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const txt = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const STAGE_MAP: Record<PipelineStageId, { flowKey: string; serviceId: string }> = {
  'stop-factor-pre': { flowKey: 'stop_factor_pre', serviceId: 'stop-factor-pre' },
  fmcsa: { flowKey: 'fmcsa', serviceId: 'fmcsa' },
  plaid: { flowKey: 'plaid_bs', serviceId: 'plaid' },
  highway: { flowKey: 'highway', serviceId: 'highway' },
  creditsafe: { flowKey: 'creditsafe', serviceId: 'creditsafe' },
  isoftpull: { flowKey: 'isoftpull', serviceId: 'isoftpull' },
  blacklist: { flowKey: 'blacklist', serviceId: 'blacklist' },
  antifraud: { flowKey: 'antifraud', serviceId: 'antifraud' },
  crosscheck: { flowKey: 'crosscheck', serviceId: 'crosscheck' },
  'stop-factor-after': { flowKey: 'stop_factor_after', serviceId: 'stop-factor-after' },
};

function flattenStep(blob: Rec): Rec {
  return {
    ...rec(blob),
    ...rec(blob.rawResponse),
    ...rec(blob.data),
    ...rec(blob.result),
    ...rec(rec(blob.manual_data).bank_statement_parse),
    ...rec(blob.manual_data),
  };
}

function firstText(src: Rec, keys: string[]): string {
  for (const k of keys) {
    const v = txt(src[k]);
    if (v) return v;
  }
  return '';
}
function firstNum(src: Rec, keys: string[]): number | undefined {
  for (const k of keys) {
    const n = num(src[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function relatedFor(stageId: PipelineStageId, blob: Rec): Array<{ label: string; value: string }> {
  const s = flattenStep(blob);
  const out: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | number | undefined): void => {
    const v = txt(value);
    if (v) out.push({ label, value: v });
  };
  switch (stageId) {
    case 'stop-factor-pre':
    case 'stop-factor-after': {
      push('Decision', firstText(s, ['decision']));
      push('Flagged', firstNum(s, ['flagged_count', 'triggered']));
      break;
    }
    case 'blacklist': {
      const matches = firstNum(s, ['matched_count']);
      const hasMatch = s.has_match === true || (matches ?? 0) > 0;
      push('Match', hasMatch ? 'Yes' : 'No');
      push('Matches', matches);
      push('Severity', firstText(s, ['severity_level', 'severity']));
      break;
    }
    case 'fmcsa': {
      push('Legal name', firstText(s, ['legal_name']));
      push('USDOT status', firstText(s, ['usdot_status']));
      push('Authority', firstText(s, ['operating_authority_status']));
      push('Safety rating', firstText(s, ['safety_rating']));
      push('Power units', firstNum(s, ['power_units']));
      push('Out of service', firstText(s, ['out_of_service_status']));
      break;
    }
    case 'plaid': {
      push('Avg weekly income', firstNum(s, ['avg_weekly_income']));
      push('Days negative', firstNum(s, ['days_negative_balance']));
      break;
    }
    case 'highway': {
      push('Score', firstNum(s, ['score', 'risk_score']));
      push('Verdict', firstText(s, ['verdict', 'decision']));
      break;
    }
    case 'creditsafe': {
      push('Credit score', firstNum(s, ['credit_score']));
      push('Risk', firstText(s, ['risk_band', 'international_rating']));
      push('Days beyond terms', firstNum(s, ['days_beyond_terms']));
      break;
    }
    case 'isoftpull': {
      push('Credit score', firstNum(s, ['credit_score']));
      push('Bureau', firstText(s, ['bureau', 'provider_code']));
      break;
    }
    case 'antifraud': {
      push('Signals', firstNum(s, ['total_signals']));
      push('Risk', firstText(s, ['risk_band']));
      break;
    }
    case 'crosscheck': {
      push('Matches', firstNum(s, ['matches_count']));
      push('Confidence', firstText(s, ['match_confidence']));
      break;
    }
  }
  return out.slice(0, 6);
}

/** Returns null when the request carries no decision-desk stage data (caller then falls back). */
export function mapStagesFromResult(result: Rec, postStopFactor: Rec): PipelineStage[] | null {
  const mr = rec(result.manual_review);
  const flowStages = rec(rec(mr.stage_flow).stages);
  const stepResults = rec(result.step_results);
  const stageStops = rec(mr.stage_stops);
  if (!Object.keys(flowStages).length && !Object.keys(stepResults).length) return null;

  const rejectedAtStage = txt(mr.rejected_at_stage);
  const stopReason =
    txt(result.decision_reason) ||
    txt(rec(result.summary).decision_reason) ||
    txt(postStopFactor.reason) ||
    txt(postStopFactor.rule_id);

  return STAGE_CATALOG.map((stage): PipelineStage => {
    const { flowKey, serviceId } = STAGE_MAP[stage.id];
    const fs = rec(flowStages[flowKey]);
    const step = rec(stepResults[serviceId]);
    const hasStep = Object.keys(step).length > 0;
    const hasFlow = Object.keys(fs).length > 0;
    const flowStatus = txt(fs.status);
    const stepStatus = txt(fs.step_status) || txt(step.status);

    let status = flowStatus
      ? normalizeStageFlowStatus(flowStatus)
      : hasStep
        ? normalizeStageStatus(stepStatus)
        : 'not_started';
    const used = hasFlow || status !== 'not_started' || hasStep;
    const related = hasStep ? relatedFor(stage.id, step) : [];

    const stops = Array.isArray(stageStops[flowKey]) ? (stageStops[flowKey] as Rec[]) : [];
    const rejectionNames = [
      ...new Set(
        stops
          .filter((x) => txt(rec(x).category) === 'rejection')
          .map((x) => txt(rec(x).name))
          .filter(Boolean),
      ),
    ];

    let stoppedBy: string | undefined;
    if (rejectionNames.length) {
      stoppedBy = rejectionNames.join('; ');
      status = 'failed';
    } else if (rejectedAtStage && rejectedAtStage === flowKey) {
      stoppedBy = stopReason || 'Stopped at this stage';
      status = 'failed';
    } else if (txt(fs.error)) {
      stoppedBy = txt(fs.error).slice(0, 180);
    } else if (/FAIL|REVIEW|ERROR|NOT_FOUND|UNAVAILABLE/i.test(stepStatus)) {
      stoppedBy = stepStatus;
    }

    const detail = stoppedBy || (related[0] ? `${related[0].label}: ${related[0].value}` : undefined);
    return {
      ...stage,
      status,
      used,
      ...(detail ? { detail } : {}),
      ...(related.length ? { related } : {}),
      ...(stoppedBy ? { stoppedBy } : {}),
    };
  });
}
