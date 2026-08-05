/** Live, record-specific Zoho Blueprint editor used inside the Lead detail sheet. */
import { useEffect, useMemo, useState } from 'react';
import {
  getLeadBlueprint,
  type LeadBlueprint,
  type LeadBlueprintField,
  type LeadBlueprintTransition,
} from '@/api/dataCenter';
import { getImpersonation } from '@/api/impersonation';
import { s } from './dc';
import { Icon } from './icons';
import { statusMeta } from './leadStatusFlow';

export interface LeadBlueprintSelection {
  transitionId: string;
  nextValue: string;
  data: Record<string, string | number | boolean | null>;
  valid: boolean;
}

const COMPLEX_TYPES = new Set([
  'lookup',
  'multiselectlookup',
  'multiuserlookup',
  'subform',
  'widget',
  'fileupload',
  'imageupload',
]);

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function selectionFor(
  transition: LeadBlueprintTransition,
  data: Record<string, string | number | boolean | null>,
): LeadBlueprintSelection {
  const valid = transition.fields.every((field) => {
    if (!field.mandatory || field.readOnly) return true;
    if (COMPLEX_TYPES.has(field.dataType)) return hasValue(field.value);
    return hasValue(data[field.apiName]) || hasValue(field.value);
  });
  return { transitionId: transition.id, nextValue: transition.nextValue, data, valid };
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: LeadBlueprintField;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const shown = value ?? (typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean'
    ? field.value
    : '');
  if (COMPLEX_TYPES.has(field.dataType)) {
    return field.mandatory && !hasValue(field.value) ? (
      <div style={s('font-size:12px;color:var(--danger)')}>{field.label} must be completed in Zoho CRM.</div>
    ) : null;
  }
  if (field.options.length > 0) {
    return (
      <label style={s('display:block')}>
        <span style={s('font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase')}>
          {field.label}{field.mandatory ? ' · Required' : ''}
        </span>
        <select
          aria-label={field.label}
          value={String(shown)}
          onChange={(event) => onChange(event.currentTarget.value)}
          style={s('width:100%;height:36px;margin-top:5px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text)')}
        >
          <option value="">Select…</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.dataType === 'boolean') {
    return (
      <label style={s('display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2)')}>
        <input type="checkbox" checked={shown === true} onChange={(event) => onChange(event.currentTarget.checked)} />
        {field.label}{field.mandatory ? ' · Required' : ''}
      </label>
    );
  }
  const numeric = ['integer', 'bigint', 'long', 'double', 'currency', 'percent'].includes(field.dataType);
  return (
    <label style={s('display:block')}>
      <span style={s('font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase')}>
        {field.label}{field.mandatory ? ' · Required' : ''}
      </span>
      <input
        aria-label={field.label}
        type={numeric ? 'number' : field.dataType === 'date' ? 'date' : 'text'}
        value={String(shown)}
        onChange={(event) => onChange(numeric && event.currentTarget.value !== '' ? Number(event.currentTarget.value) : event.currentTarget.value)}
        style={s('width:100%;height:36px;margin-top:5px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text)')}
      />
    </label>
  );
}

export function LeadBlueprintEditor({
  leadId,
  onChange,
}: {
  leadId: string;
  onChange: (selection: LeadBlueprintSelection | null) => void;
}) {
  const [blueprint, setBlueprint] = useState<LeadBlueprint | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState<Record<string, string | number | boolean | null>>({});

  useEffect(() => {
    let active = true;
    setError(false);
    getLeadBlueprint(leadId, getImpersonation()?.zohoUserId)
      .then((value) => active && setBlueprint(value))
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [leadId]);

  const transitions = useMemo(
    () => blueprint?.transitions.filter((transition) => transition.type === 'manual' && transition.criteriaMatched) ?? [],
    [blueprint],
  );
  const selected = transitions.find((transition) => transition.id === selectedId) ?? null;

  const pick = (transition: LeadBlueprintTransition): void => {
    setSelectedId(transition.id);
    setData({});
    onChange(selectionFor(transition, {}));
  };
  const setField = (field: string, value: string | number | boolean | null): void => {
    if (!selected) return;
    const next = { ...data, [field]: value };
    setData(next);
    onChange(selectionFor(selected, next));
  };

  if (error) return <div style={s('font-size:13px;color:var(--danger)')}>Couldn’t load Zoho Blueprint transitions.</div>;
  if (blueprint === undefined) return <div style={s('font-size:13px;color:var(--muted)')}>Loading Blueprint…</div>;
  if (blueprint === null) return <div style={s('font-size:13px;color:var(--muted)')}>This lead is not in an active Zoho Blueprint.</div>;

  return (
    <div>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px')}>
        <span style={s('font-size:12px;color:var(--muted)')}>{blueprint.process.name || 'Zoho Blueprint'}</span>
        <span style={s('font-size:12px;font-weight:800;color:var(--accent)')}>{blueprint.process.currentValue}</span>
      </div>
      {transitions.length === 0 ? (
        <div style={s('font-size:13px;color:var(--muted)')}>No manual transition is available from this stage.</div>
      ) : (
        <div role="radiogroup" aria-label="Available Blueprint transitions" style={s('display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px')}>
          {transitions.map((transition) => {
            const active = transition.id === selectedId;
            const meta = statusMeta(transition.nextValue);
            return (
              <button
                key={transition.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pick(transition)}
                style={s(`display:flex;align-items:center;gap:8px;padding:10px;border-radius:var(--radius-md);border:1px solid ${active ? meta.color : 'var(--border)'};background:${active ? `color-mix(in srgb,${meta.color} 12%,var(--alt))` : 'var(--alt)'};color:${active ? meta.color : 'var(--text)'};font-size:13px;font-weight:700;cursor:pointer;text-align:left`)}
              >
                <Icon name={meta.icon} size={14} />
                <span>{transition.nextValue || transition.name}</span>
              </button>
            );
          })}
        </div>
      )}
      {selected && selected.fields.some((field) => !field.readOnly) && (
        <div style={s('display:flex;flex-direction:column;gap:9px;margin-top:12px')}>
          {selected.fields.filter((field) => !field.readOnly).map((field) => (
            <FieldInput key={`${field.apiName}-${field.label}`} field={field} value={data[field.apiName]} onChange={(value) => setField(field.apiName, value)} />
          ))}
        </div>
      )}
    </div>
  );
}
