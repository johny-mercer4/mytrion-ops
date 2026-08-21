/**
 * Highway.com carrier-page parser — HTML upload only.
 *
 * Ported from verification-mono `highway_html_parser.py` (identity / labels / fleet / OOS /
 * insurance / authority). No highway.com scrape and no vendor key. PDF text extract is not
 * ported (that path needed poppler); an uploaded PDF is flagged so the analyst saves HTML.
 */
export type HighwayParsedFields = Record<string, string | number | boolean | HighwayAuthorityRow[]>;

export interface HighwayParseResult {
  available: true;
  error: null;
  parser: 'highway_html_v2';
  pdfNoText: boolean;
  blockCount: number;
  fields: HighwayParsedFields;
}

export interface HighwayAuthorityRow {
  authority_type: string;
  original_action: string;
  action_date: string;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function digits(text: string): string {
  return text.replace(/[^\d]/g, '');
}

function tryFloat(text: string): number | null {
  const n = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function tryInt(text: string): number | null {
  const n = tryFloat(text);
  return n === null ? null : Math.trunc(n);
}

function extractBlocks(html: string): string[] {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ');
  const broken = stripped.replace(/<(?:tr|td|th|div|p|li|h[1-4]|br|span)\b[^>]*>/gi, '\n');
  const text = broken.replace(/<[^>]+>/g, ' ');
  return text
    .split(/\n+/)
    .map(clean)
    .filter((block) => block !== '');
}

function isHelpText(block: string): boolean {
  if (block.length > 90) return true;
  const low = block.toLowerCase();
  return (
    low.includes('learn more') ||
    low.includes('reflect fmcsa') ||
    low.includes('matching government records') ||
    low.includes('carriers with a') ||
    low.includes('credentials are valid') ||
    low.includes('coverage means') ||
    low.includes('published a notice') ||
    low.includes('requires all') ||
    low.includes('is a measure of') ||
    low.includes('known accuracy issues') ||
    low.includes('here are the insurance')
  );
}

const LABEL_BLOCKS = new Set([
  'dot status',
  'usdot status',
  'safety rating',
  'tin',
  'assessment',
  'operating status',
  'bonded',
  'cargo carried',
  'classification',
  'fleet size',
  'mcsip step',
  'certifications',
  'eld',
  'phone #',
  'email',
  'contact',
  'operating authority types',
  'average fleet age',
  'insurer name',
  'policy number',
  'effective date',
  'expiration date',
  'address',
  'authority',
  'authority number',
  'status',
  'insights',
  'network',
  'activity',
  'overview',
  'insurance',
  'safety',
  'inspections',
  'crashes',
  'operations',
  'equipment',
]);

const BADGE_WORDS = new Set([
  'partial pass',
  'pass',
  'fail',
  'verified',
  'unverified',
  'pending',
  'review',
  'connected',
  'not connected',
  'registered',
  'dashboard',
  'partial',
  'n/a',
  'none',
]);

const ID_BLOCK = /^(?:MC|USDOT|DOT)\s*[-#]?\s*\d{4,8}\b/i;
const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const PCT = /^\d{1,3}(?:\.\d+)?%$/;

function looksLikeCarrierName(value: string): boolean {
  if (!(value.length >= 3 && value.length <= 70)) return false;
  if (BADGE_WORDS.has(value.toLowerCase())) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  const low = value.toLowerCase();
  return !(
    low.includes('carrier is registered') ||
    low.includes('saved searches') ||
    low.includes('my carriers') ||
    low.includes('connections') ||
    low.includes('tax ident') ||
    low.includes('legal name') ||
    low.includes('verified tin') ||
    low.includes('observed equipment') ||
    low.includes('learn more')
  );
}

function setField(result: HighwayParsedFields, key: string, value: string | number | boolean | null | undefined): void {
  if (value === null || value === undefined || value === '') return;
  if (!(key in result)) result[key] = value;
}

function valueAfter(
  blocks: string[],
  index: number,
  window = 4,
  accept?: (value: string) => boolean,
): string | null {
  for (let j = index + 1; j < Math.min(index + 1 + window, blocks.length); j += 1) {
    const candidate = clean(blocks[j] ?? '');
    if (!candidate || isHelpText(candidate)) continue;
    if (LABEL_BLOCKS.has(candidate.toLowerCase())) continue;
    if (accept && !accept(candidate)) continue;
    return candidate;
  }
  return null;
}

function firstIndex(blocks: string[], label: string, start = 0): number {
  const target = label.toLowerCase();
  for (let i = start; i < blocks.length; i += 1) {
    if (clean(blocks[i] ?? '').toLowerCase() === target) return i;
  }
  return -1;
}

function findPattern(blocks: string[], pattern: RegExp): string | null {
  for (const block of blocks) {
    const match = pattern.exec(block);
    if (match) return clean(match[1] ?? match[0] ?? '');
  }
  return null;
}

function carrierNameBeforeIds(blocks: string[]): string | null {
  for (let i = 0; i < blocks.length; i += 1) {
    if (!ID_BLOCK.test(clean(blocks[i] ?? ''))) continue;
    for (let j = i - 1; j >= Math.max(0, i - 5); j -= 1) {
      const cand = clean(blocks[j] ?? '');
      if (looksLikeCarrierName(cand)) return cand;
    }
    return null;
  }
  return null;
}

function parseEquipment(blocks: string[], result: HighwayParsedFields): void {
  const specs: Array<[RegExp, string, string, string]> = [
    [/^(\d{1,4})\s+Power Units?$/i, 'total_power_units', 'fleet_age_power_units_yrs', 'percentile_power_units'],
    [/^(\d{1,4})\s+Trailers?$/i, 'total_trailers', 'fleet_age_trailers_yrs', 'percentile_trailers'],
    [/^(\d{1,4})\s+Reefers?$/i, 'total_reefer', 'fleet_age_reefer_yrs', 'percentile_reefer'],
  ];
  const ageRe = /^(?:(\d{1,3})\s*\+?\s*yrs?\s+old|less than\s+(\d{1,3})\s*yrs?\s+old)$/i;
  const pctRe = /^(Top|Bottom)\s+\d{1,3}%$/i;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = clean(blocks[i] ?? '');
    for (const [rx, countKey, ageKey, pctKey] of specs) {
      const match = rx.exec(block);
      if (!match) continue;
      setField(result, countKey, Number(match[1]));
      for (let j = i + 1; j < Math.min(i + 4, blocks.length); j += 1) {
        const nxt = clean(blocks[j] ?? '');
        const age = ageRe.exec(nxt);
        if (age && !(ageKey in result)) {
          result[ageKey] = Number(age[1] ?? age[2] ?? 0);
          continue;
        }
        if (nxt.toLowerCase().startsWith('less than') && !(ageKey in result)) {
          result[ageKey] = 0;
          continue;
        }
        if (pctRe.test(nxt) && !(pctKey in result)) {
          result[pctKey] = nxt;
          break;
        }
      }
    }
  }
}

function parseOos(blocks: string[], result: HighwayParsedFields): void {
  const start = firstIndex(blocks, 'out of service rates');
  if (start < 0) return;
  const window = blocks.slice(start, start + 40);
  const rows: Record<string, [string | null, string, string]> = {
    driver: ['driver_oos_count', 'driver_inspections', 'driver_oos_pct'],
    hazmat: [null, 'hazmat_inspections', 'hazmat_oos_pct'],
    vehicle: ['vehicle_oos_count', 'vehicle_inspections', 'vehicle_oos_pct'],
  };
  for (let i = 0; i < window.length; i += 1) {
    const key = clean(window[i] ?? '').toLowerCase();
    const spec = rows[key];
    if (!spec) continue;
    const values: string[] = [];
    for (let j = i + 1; j < Math.min(i + 6, window.length); j += 1) {
      const nxt = clean(window[j] ?? '');
      if (/^\d+$/.test(nxt) || PCT.test(nxt)) values.push(nxt);
      else if (values.length > 0) break;
      if (values.length >= 4) break;
    }
    if (values.length < 3) continue;
    if (spec[0]) setField(result, spec[0], tryInt(values[0] ?? ''));
    setField(result, spec[1], tryInt(values[1] ?? ''));
    setField(result, spec[2], tryFloat(values[2] ?? ''));
  }
}

const POLICY_TYPES: Record<string, [string, string, string, string, string, string]> = {
  auto: ['auto_insurer', 'auto_policy', 'auto_effective', 'auto_expiration', 'auto_limit', 'auto_policy_status'],
  cargo: ['cargo_insurer', 'cargo_policy', 'cargo_effective', 'cargo_expiration', 'cargo_limit', 'cargo_policy_status'],
  'trailer interchange': [
    'trailer_insurer',
    'trailer_policy',
    'trailer_effective',
    'trailer_expiration',
    'trailer_limit',
    'trailer_policy_status',
  ],
};

function parseInsurance(blocks: string[], result: HighwayParsedFields): void {
  let start = firstIndex(blocks, 'certificate of insurance');
  if (start < 0) start = firstIndex(blocks, 'insurance');
  if (start < 0) return;
  const window = blocks.slice(start, start + 120);
  let i = 0;
  while (i < window.length) {
    const policyType = clean(window[i] ?? '').toLowerCase();
    const keys = POLICY_TYPES[policyType];
    if (!keys) {
      i += 1;
      continue;
    }
    const [insurerKey, policyKey, effKey, expKey, limitKey, statusKey] = keys;
    const end = Math.min(i + 18, window.length);
    let j = i + 1;
    while (j < end) {
      const block = clean(window[j] ?? '');
      const low = block.toLowerCase();
      if (low in POLICY_TYPES && low !== policyType) break;
      if (['active', 'expired', 'cancelled', 'pending'].includes(low) && !(statusKey in result)) {
        result[statusKey] = block.toUpperCase();
      } else if (low === 'insurer name') setField(result, insurerKey, valueAfter(window, j, 2));
      else if (low === 'policy number') setField(result, policyKey, valueAfter(window, j, 2));
      else if (low === 'effective date') {
        setField(result, effKey, valueAfter(window, j, 2, (v) => DATE.test(v)));
      } else if (low === 'expiration date' || low === 'expiry date') {
        setField(result, expKey, valueAfter(window, j, 2, (v) => DATE.test(v)));
      } else if (block.includes('$') && !(limitKey in result)) {
        const amount = tryFloat(block);
        if (amount !== null && amount >= 1000) result[limitKey] = Math.trunc(amount);
      }
      j += 1;
    }
    i = j > i + 1 ? j : i + 1;
  }
}

function parseAuthority(blocks: string[], result: HighwayParsedFields): void {
  const header = firstIndex(blocks, 'authority type');
  if (header < 0) return;
  const window = blocks.slice(header, header + 30);
  const history: HighwayAuthorityRow[] = [];
  let i = 1;
  while (i < window.length - 2) {
    const candidate = clean(window[i] ?? '');
    const action = clean(window[i + 1] ?? '');
    const date = clean(window[i + 2] ?? '');
    if (
      /^[A-Z][A-Z /()&-]{6,60}$/.test(candidate) &&
      ['GRANTED', 'REVOKED', 'DISMISSED', 'REINSTATED', 'WITHDRAWN'].includes(action.toUpperCase()) &&
      DATE.test(date)
    ) {
      history.push({
        authority_type: candidate,
        original_action: action.toUpperCase(),
        action_date: date,
      });
      i += 3;
      continue;
    }
    i += 1;
  }
  if (history.length > 0) result.authority_history = history;
}

function parseDispatch(blocks: string[], result: HighwayParsedFields): void {
  const start = firstIndex(blocks, 'dispatch contact');
  if (start < 0) return;
  const address: string[] = [];
  for (let j = start + 1; j < Math.min(start + 8, blocks.length); j += 1) {
    const block = clean(blocks[j] ?? '');
    if (!block || isHelpText(block)) continue;
    if (LABEL_BLOCKS.has(block.toLowerCase())) break;
    if (PHONE.test(block) && block.length <= 20) setField(result, 'dispatch_phone', block);
    else if (EMAIL.test(block)) setField(result, 'dispatch_email', block);
    else if (/^\d+\s+[A-Z0-9 .,'-]+$/i.test(block) || /^[A-Z ]+,\s*[A-Z]{2}[, ]+\d{5}/i.test(block)) {
      address.push(block);
    }
  }
  if (address.length > 0) setField(result, 'physical_address', address.slice(0, 2).join(', '));
}

export function parseHighwayUpload(bytes: Uint8Array): HighwayParseResult {
  const pdf = bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (pdf) {
    return {
      available: true,
      error: null,
      parser: 'highway_html_v2',
      pdfNoText: true,
      blockCount: 0,
      fields: { _parser: 'highway_html_v2', _pdf_no_text: true, _block_count: 0 },
    };
  }

  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const blocks = extractBlocks(html);
  const fields: HighwayParsedFields = {};

  let carrierName = carrierNameBeforeIds(blocks);
  if (!carrierName) {
    for (let i = 0; i < blocks.length; i += 1) {
      const low = clean(blocks[i] ?? '').toLowerCase();
      if (low === 'carrier name' || low === 'legal name' || low === 'company name') {
        const value = valueAfter(blocks, i, 3, looksLikeCarrierName);
        if (value) {
          carrierName = value;
          break;
        }
      }
    }
  }
  setField(fields, 'carrier_name', carrierName);

  const mc = findPattern(blocks, /MC[- #]*(\d{4,7})/i);
  if (mc) fields.mc_number = digits(mc) || mc;
  const dot = findPattern(blocks, /(?:USDOT|DOT)[- #]*(\d{5,8})/i);
  if (dot) fields.dot_number = digits(dot) || dot;

  const hwId = /\/carriers\/(\d{5,9})/.exec(html) ?? /Carrier Detail[_:\s]+(\d{5,9})/.exec(html);
  if (hwId?.[1]) fields.highway_carrier_id = hwId[1];

  const labeled: Array<[readonly string[], string, ((v: string) => boolean) | null, (v: string) => string]> = [
    [['dot status', 'usdot status'], 'dot_status', null, (v) => v.toUpperCase()],
    [['safety rating'], 'safety_rating', null, (v) => v.toUpperCase()],
    [['tin'], 'tin_status', (v) => ['verified', 'not verified', 'unverified'].includes(v.toLowerCase()), (v) => v.toUpperCase()],
    [
      ['assessment'],
      'assessment_status',
      (v) => ['pass', 'partial pass', 'fail', 'conditional pass'].includes(v.toLowerCase()),
      (v) => v.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
    ],
    [['operating status'], 'operating_status', null, (v) => v],
    [['bonded'], 'bonded', (v) => ['yes', 'no'].includes(v.toLowerCase()), (v) => v],
    [['cargo carried'], 'cargo_carried', null, (v) => v],
    [['classification'], 'classification', null, (v) => v],
    [['fleet size'], 'fleet_size', null, (v) => v],
    [['mcsip step'], 'mcsip_step', null, (v) => v],
    [['certifications'], 'certifications_status', null, (v) => v],
    [['eld'], 'eld_provider', (v) => v.length <= 30, (v) => v],
    [['operating authority types'], 'licensed_capabilities', null, (v) => v],
  ];
  for (let i = 0; i < blocks.length; i += 1) {
    const label = clean(blocks[i] ?? '').toLowerCase();
    for (const [labels, key, accept, transform] of labeled) {
      if (labels.includes(label) && !(key in fields)) {
        const value = valueAfter(blocks, i, 4, accept ?? undefined);
        if (value !== null) fields[key] = transform(value);
      }
    }
  }
  if (typeof fields.certifications_status === 'string') {
    fields.certifications_status = fields.certifications_status.toUpperCase();
  }

  parseDispatch(blocks, fields);
  parseEquipment(blocks, fields);
  parseOos(blocks, fields);
  parseInsurance(blocks, fields);
  parseAuthority(blocks, fields);

  fields._parser = 'highway_html_v2';
  fields._block_count = blocks.length;
  return {
    available: true,
    error: null,
    parser: 'highway_html_v2',
    pdfNoText: false,
    blockCount: blocks.length,
    fields,
  };
}
