/**
 * Pure verification-mono Orchestration mapping — slug, normalize, defaults, condition-logic
 * check, and strategy revision rows. Same behaviour as credit_platform admin_config.py.
 */
import type { DecisionStrategyRecord, DecisionStrategyWrite } from './creditPlatformConfig.js';

export const DECISION_STRATEGIES_STATE_KEY = 'decision_strategies_json';
export const DECISION_STRATEGIES_REVISIONS_STATE_KEY = 'decision_strategies_revisions_json';
export const CONFIG_VERSION_STATE_KEY = 'config_version';

export type StrategyRevisionAction = 'created' | 'updated' | 'deleted' | string;

export interface StrategyRevision {
  strategy_id: string;
  title: string;
  version: number;
  action: string;
  actor: string;
  created_at: string;
  lifecycle: string;
  enabled: boolean;
  priority: number;
  version_note: string;
  changed_fields: string[];
  source_version: number | null;
  snapshot: DecisionStrategyRecord;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function slugDecisionStrategyId(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80);
}

function safeNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return Math.max(0, fallback);
  return Math.max(0, Math.trunc(n));
}

function normalizeLifecycle(value: unknown): string {
  const lifecycle = cleanText(value).toLowerCase();
  return lifecycle === 'draft' || lifecycle === 'published' || lifecycle === 'archived'
    ? lifecycle
    : 'draft';
}

function normalizeStringList(value: unknown, lower: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    let item = cleanText(raw);
    if (lower) item = item.toLowerCase();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

export function defaultDecisionStrategies(): DecisionStrategyRecord[] {
  return [
    {
      id: 'standard-approval',
      title: 'Standard approval',
      enabled: true,
      lifecycle: 'published',
      version: 1,
      priority: 10,
      summary:
        'Approve when core identity, FMCSA, cashflow, and credit checks agree and no hard-stop rules trigger.',
      outcome: 'Approve with selected offer preset and explicit limit/billing-cycle decision.',
      data_sources: ['zoho', 'fmcsa', 'plaid', 'creditsafe', 'isoftpull'],
      stage_scope: ['fmcsa', 'plaid_bs', 'creditsafe', 'isoftpull', 'crosscheck'],
      decision_actions: ['approve'],
      combined_fields: [
        { label: 'Legal business name', source: 'zoho', path: 'applicant.Name', required: true, merge_key: '', weight: 0, notes: '' },
        { label: 'FMCSA USDOT status', source: 'fmcsa', path: 'result.step_results.fmcsa.result.usdot_status', required: true, merge_key: '', weight: 0, notes: '' },
        { label: 'Net cash flow', source: 'plaid', path: 'result.step_results.plaid.result.net_cash_flow', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'CreditSafe credit score', source: 'creditsafe', path: 'result.step_results.creditsafe.result.creditScore', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'Bureau credit score (lowest of 3)', source: 'isoftpull', path: 'isoftpull.credit_score', required: false, merge_key: '', weight: 0, notes: '' },
      ],
      rule_bindings: [
        { category: 'APPROVE', stage: 'decision', purpose: 'positive pass checks' },
        { category: 'REVIEW', stage: 'decision', purpose: 'analyst attention' },
        { category: 'REJECT', stage: 'decision', purpose: 'hard stop' },
      ],
      conditions: [
        { path: 'stage.status', operator: 'in', value: ['ran', 'approved'] },
        { path: 'stage_details.stage.error', operator: 'not_exists' },
      ],
      logic: '',
      meta: { system_default: true, version_note: 'Initial default strategy' },
    },
    {
      id: 'manual-review',
      title: 'Manual review',
      enabled: true,
      lifecycle: 'published',
      version: 1,
      priority: 20,
      summary: 'Use when client data is incomplete, inconsistent across sources, or needs senior validation.',
      outcome: 'Keep in review, document the mismatch, and route to the correct reviewer role.',
      data_sources: ['zoho', 'fmcsa', 'plaid', 'creditsafe', 'isoftpull', 'manual'],
      stage_scope: ['plaid_bs', 'highway', 'creditsafe', 'isoftpull', 'crosscheck'],
      decision_actions: ['review'],
      combined_fields: [
        { label: 'Client identity mismatch', source: 'crosscheck', path: 'result.step_results.crosscheck.triggered', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'Net cash flow', source: 'bank_statement', path: 'result.step_results.plaid.result.net_cash_flow', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'iSoftPull report status', source: 'isoftpull', path: 'result.step_results.isoftpull.result.report_status', required: false, merge_key: '', weight: 0, notes: '' },
      ],
      rule_bindings: [{ category: 'REVIEW', stage: 'decision', purpose: 'manual validation' }],
      conditions: [
        { path: 'stage.status', operator: 'in', value: ['failed', 'ran'] },
        { path: 'stage_details.stage.error', operator: 'exists' },
      ],
      logic: '',
      meta: { system_default: true, version_note: 'Initial default strategy' },
    },
    {
      id: 'hard-stop',
      title: 'Hard stop',
      enabled: true,
      lifecycle: 'published',
      version: 1,
      priority: 30,
      summary: 'Reject or hold when a non-negotiable risk signal is present.',
      outcome: 'Reject or block approval until the hard-stop source is resolved.',
      data_sources: ['blacklist', 'antifraud', 'fmcsa', 'creditsafe', 'isoftpull'],
      stage_scope: ['stop_factor_pre', 'blacklist', 'antifraud', 'stop_factor_after'],
      decision_actions: ['reject', 'hold'],
      combined_fields: [
        { label: 'Blacklist match', source: 'blacklist', path: 'result.step_results.blacklist.has_match', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'Fraud signal count', source: 'antifraud', path: 'result.step_results.antifraud.total_signals', required: false, merge_key: '', weight: 0, notes: '' },
        { label: 'CreditSafe compliance alerts', source: 'creditsafe', path: 'result.step_results.creditsafe.result.compliance_alert_count', required: false, merge_key: '', weight: 0, notes: '' },
      ],
      rule_bindings: [{ category: 'REJECT', stage: 'decision', purpose: 'blocking rule' }],
      conditions: [
        { path: 'stage.status', operator: 'in', value: ['failed', 'ran', 'approved'] },
        { path: 'result.step_results.blacklist.has_match', operator: 'truthy' },
      ],
      logic: '',
      meta: { system_default: true, version_note: 'Initial default strategy' },
    },
  ];
}

export function normalizeDecisionStrategyList(value: unknown): DecisionStrategyRecord[] {
  const items = Array.isArray(value) ? value : [];
  const normalized: DecisionStrategyRecord[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const source = asRecord(item);
    const strategyId = slugDecisionStrategyId(source.id || source.title || `strategy-${index + 1}`);
    if (!strategyId || seen.has(strategyId)) return;
    const title = cleanText(source.title) || strategyId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const combinedFields: DecisionStrategyRecord['combined_fields'] = [];
    const rawFields = Array.isArray(source.combined_fields) ? source.combined_fields : [];
    rawFields.forEach((rawField, fieldIndex) => {
      const field = asRecord(rawField);
      const path = cleanText(field.path).slice(0, 240);
      if (!path) return;
      combinedFields.push({
        label: (cleanText(field.label) || path || `field ${fieldIndex + 1}`).slice(0, 120),
        source: cleanText(field.source).toLowerCase(),
        path,
        required: Boolean(field.required),
        merge_key: cleanText(field.merge_key).slice(0, 80),
        weight: safeNonNegativeInt(field.weight, 0),
        notes: cleanText(field.notes).slice(0, 240),
      });
    });
    normalized.push({
      id: strategyId,
      title: title.slice(0, 120),
      enabled: source.enabled === undefined ? true : Boolean(source.enabled),
      lifecycle: normalizeLifecycle('lifecycle' in source ? source.lifecycle : 'published'),
      version: Math.max(1, safeNonNegativeInt(source.version, 1)),
      priority: safeNonNegativeInt(source.priority, (index + 1) * 10),
      summary: cleanText(source.summary).slice(0, 1000),
      outcome: cleanText(source.outcome).slice(0, 1000),
      data_sources: normalizeStringList(source.data_sources, true),
      stage_scope: normalizeStringList(source.stage_scope, true),
      decision_actions: normalizeStringList(source.decision_actions, true),
      combined_fields: combinedFields,
      rule_bindings: Array.isArray(source.rule_bindings)
        ? source.rule_bindings.filter((row): row is DecisionStrategyRecord['rule_bindings'][number] => {
            const rec = asRecord(row);
            return Boolean(cleanText(rec.category));
          }).map((row) => {
            const rec = asRecord(row);
            return {
              category: cleanText(rec.category),
              stage: cleanText(rec.stage) || 'decision',
              purpose: cleanText(rec.purpose),
            };
          })
        : [],
      conditions: Array.isArray(source.conditions)
        ? source.conditions.filter((row): row is DecisionStrategyRecord['conditions'][number] => {
            return Boolean(cleanText(asRecord(row).path));
          }).map((row) => {
            const rec = asRecord(row);
            return { path: cleanText(rec.path), operator: cleanText(rec.operator) || 'eq', value: rec.value };
          })
        : [],
      logic: cleanText(source.logic).slice(0, 500),
      meta: asRecord(source.meta),
    });
    seen.add(strategyId);
  });
  const list = normalized.length > 0 ? normalized : defaultDecisionStrategies();
  return list.slice().sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

type LogicKind = 'INT' | 'AND' | 'OR' | 'NOT' | 'LP' | 'RP';

function tokenizeConditionLogic(expression: string): Array<[LogicKind, number | string]> {
  const tokens: Array<[LogicKind, number | string]> = [];
  let i = 0;
  const s = expression;
  while (i < s.length) {
    const ch = s[i] ?? '';
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push(['LP', '(']);
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push(['RP', ')']);
      i += 1;
      continue;
    }
    if (ch === '&') {
      if (s[i + 1] === '&') {
        tokens.push(['AND', '&&']);
        i += 2;
        continue;
      }
      throw new Error(`unexpected '&' at position ${i}`);
    }
    if (ch === '|') {
      if (s[i + 1] === '|') {
        tokens.push(['OR', '||']);
        i += 2;
        continue;
      }
      throw new Error(`unexpected '|' at position ${i}`);
    }
    if (ch === '!') {
      tokens.push(['NOT', '!']);
      i += 1;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j] ?? '')) j += 1;
      tokens.push(['INT', Number(s.slice(i, j))]);
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j] ?? '')) j += 1;
      const word = s.slice(i, j).toUpperCase();
      if (word === 'AND' || word === 'OR' || word === 'NOT') tokens.push([word, word]);
      else throw new Error(`unknown word '${s.slice(i, j)}'`);
      i = j;
      continue;
    }
    throw new Error(`unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/** Empty string if `logic` is blank or a well-formed 1-based expression; else a human error. */
export function validateConditionLogic(logic: unknown, numConditions: number): string {
  const text = cleanText(logic);
  if (!text) return '';
  let tokens: Array<[LogicKind, number | string]>;
  try {
    tokens = tokenizeConditionLogic(text);
  } catch (err) {
    return `invalid logic: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (tokens.length === 0) return 'empty logic expression';
  let pos = 0;
  const peek = (): [LogicKind, number | string] | [null, null] => tokens[pos] ?? [null, null];
  const parseOr = (): boolean => {
    let val = parseAnd();
    while (peek()[0] === 'OR') {
      pos += 1;
      val = parseAnd() || val;
    }
    return val;
  };
  const parseAnd = (): boolean => {
    let val = parseNot();
    while (peek()[0] === 'AND') {
      pos += 1;
      val = parseNot() && val;
    }
    return val;
  };
  const parseNot = (): boolean => {
    if (peek()[0] === 'NOT') {
      pos += 1;
      return !parseNot();
    }
    return parseAtom();
  };
  const parseAtom = (): boolean => {
    const [kind, value] = peek();
    if (kind === 'LP') {
      pos += 1;
      const val = parseOr();
      if (peek()[0] !== 'RP') throw new Error("expected ')'");
      pos += 1;
      return val;
    }
    if (kind === 'INT') {
      pos += 1;
      const index = typeof value === 'number' ? value : Number(value);
      if (index < 1 || index > numConditions) {
        throw new Error(`condition index ${index} out of range (1..${numConditions})`);
      }
      return false;
    }
    throw new Error(`unexpected token ${kind}`);
  };
  try {
    parseOr();
    if (pos !== tokens.length) return 'trailing tokens after expression';
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const REVISION_COMPARE_KEYS = [
  'title',
  'enabled',
  'lifecycle',
  'priority',
  'summary',
  'outcome',
  'data_sources',
  'stage_scope',
  'decision_actions',
  'combined_fields',
  'rule_bindings',
  'conditions',
  'logic',
  'meta',
] as const;

function changedFields(previous: DecisionStrategyRecord | null, current: DecisionStrategyRecord): string[] {
  if (!previous) return [];
  return REVISION_COMPARE_KEYS.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]));
}

export function appendDecisionStrategyRevision(
  revisions: StrategyRevision[],
  strategy: DecisionStrategyRecord,
  action: StrategyRevisionAction,
  actor: string,
  previous: DecisionStrategyRecord | null = null,
  sourceVersion: number | null = null,
): StrategyRevision[] {
  const meta = asRecord(strategy.meta);
  const next: StrategyRevision[] = [
    ...revisions,
    {
      strategy_id: strategy.id,
      title: strategy.title,
      version: strategy.version,
      action: cleanText(action) || 'updated',
      actor: cleanText(actor).toLowerCase() || 'system',
      created_at: new Date().toISOString(),
      lifecycle: strategy.lifecycle,
      enabled: Boolean(strategy.enabled),
      priority: strategy.priority,
      version_note: cleanText(meta.version_note ?? meta.change_note).slice(0, 240),
      changed_fields: changedFields(previous, strategy),
      source_version: sourceVersion,
      snapshot: strategy,
    },
  ];
  return next.slice(-250);
}

export function mergeStrategyWrite(
  input: DecisionStrategyWrite,
  existing?: DecisionStrategyRecord,
): Record<string, unknown> {
  return {
    ...existing,
    ...input,
    id: input.id || existing?.id,
    meta: input.meta ?? existing?.meta ?? {},
    combined_fields: input.combined_fields,
    rule_bindings: input.rule_bindings,
    conditions: input.conditions,
  };
}
