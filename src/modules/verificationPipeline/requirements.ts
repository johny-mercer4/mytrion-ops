import type {
  PipelineRequirement,
  PipelineRequirementField,
  PipelineRequirementFieldType,
} from './types.js';

export interface RequirementEventInput {
  id: number | string;
  status: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

const FIELD_TYPES = new Set<PipelineRequirementFieldType>([
  'text',
  'number',
  'email',
  'date',
  'textarea',
  'select',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function labelFromId(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldFrom(value: unknown, index: number): PipelineRequirementField | null {
  if (typeof value === 'string') {
    const id = slug(value);
    return id ? { id, label: labelFromId(id), type: 'text', required: true } : null;
  }
  const item = record(value);
  if (!item) return null;
  const rawId = text(item.id) || text(item.key) || text(item.name) || `field_${index + 1}`;
  const id = slug(rawId);
  if (!id) return null;
  const rawType = text(item.type).toLowerCase() as PipelineRequirementFieldType;
  const options = Array.isArray(item.options)
    ? item.options.map(text).filter(Boolean).slice(0, 50)
    : undefined;
  const type = FIELD_TYPES.has(rawType) ? rawType : options?.length ? 'select' : 'text';
  return {
    id,
    label: text(item.label) || labelFromId(id),
    type,
    required: item.required !== false,
    ...(text(item.placeholder) ? { placeholder: text(item.placeholder) } : {}),
    ...(options?.length ? { options } : {}),
  };
}

function fieldList(payload: Record<string, unknown>): PipelineRequirementField[] {
  const nested = record(payload.sales_request) ?? record(payload.requirement) ?? payload;
  const raw = nested.required_fields ?? nested.requiredFields ?? nested.fields ?? nested.inputs;
  const out = Array.isArray(raw)
    ? raw.map(fieldFrom).filter((field): field is PipelineRequirementField => field !== null)
    : [];
  const seen = new Set<string>();
  return out.filter((field) => (seen.has(field.id) ? false : (seen.add(field.id), true))).slice(0, 20);
}

function inferredFields(title: string): PipelineRequirementField[] {
  const lower = title.toLowerCase();
  const fields: PipelineRequirementField[] = [];
  if (/\bmc\b|motor carrier/.test(lower)) {
    fields.push({ id: 'mc_number', label: 'MC number', type: 'text', required: true });
  }
  if (/\bdot\b|usdot/.test(lower)) {
    fields.push({ id: 'dot_number', label: 'DOT number', type: 'text', required: true });
  }
  return fields;
}

/** Convert payload-driven Verification action events into safe, deterministic Sales forms. */
export function extractSalesRequirements(events: RequirementEventInput[]): PipelineRequirement[] {
  const requirements: PipelineRequirement[] = [];
  for (const event of events) {
    const payload = event.payload ?? {};
    const nested = record(payload.sales_request) ?? record(payload.requirement) ?? payload;
    const status = (event.status ?? '').toUpperCase();
    const title = event.title.trim();
    const searchable = `${title} ${text(nested.message)} ${text(nested.detail)}`.toLowerCase();
    const audience = (
      text(nested.audience) ||
      text(nested.target_department) ||
      text(nested.targetDepartment) ||
      text(nested.assignee)
    ).toLowerCase();
    const explicitFields = fieldList(payload);
    const attachmentRequired =
      nested.attachment_required === true ||
      nested.attachmentRequired === true ||
      nested.requires_attachment === true ||
      /\b(upload|attach|document|bank statement|pdf)\b/.test(searchable);
    const actionStatus = [
      'ACTION_REQUIRED',
      'NEEDS_INPUT',
      'WAITING_ON_SALES',
      'MISSING',
      'BLOCKED',
      'REQUESTED',
    ].includes(status);
    const actionTitle = /\b(need(?:ed|s)?|required|missing|please provide|send us|upload)\b/.test(searchable);
    const forSales = !audience || /sales|agent|owner/.test(audience);
    if (!forSales || (!actionStatus && !actionTitle && explicitFields.length === 0)) continue;
    if (['RESOLVED', 'COMPLETED', 'CLOSED'].includes(status)) continue;

    let fields = explicitFields.length ? explicitFields : inferredFields(searchable);
    if (fields.length === 0 && !attachmentRequired) {
      fields = [{ id: 'response', label: 'Response', type: 'textarea', required: true }];
    }
    const eventId = String(event.id);
    requirements.push({
      id: `verification-${eventId}`,
      eventId,
      title: title || 'Verification needs information',
      detail: text(nested.instructions) || text(nested.message) || text(nested.detail) || text(nested.reason) || null,
      createdAt: event.createdAt,
      fields,
      attachmentRequired,
      attachmentLabel: text(nested.attachment_label) || text(nested.attachmentLabel) || null,
    });
  }
  return requirements;
}
