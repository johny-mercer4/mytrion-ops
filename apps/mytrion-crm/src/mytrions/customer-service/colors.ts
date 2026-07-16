/**
 * CS-only picklist color system — verbatim port of the widget's csGetPicklistColor
 * (zoho-octane applications-panel.js). Pattern: translucent fill + vivid mid-tone
 * foreground. Three-tier resolution: direct → normalized → hash fallback, so no
 * value ever degrades to washed-out gray.
 */
import type { CSSProperties } from 'react';

export interface TagColor {
  bg: string;
  text: string;
  border: string;
}

function tag(hex: string, bgA = 0.13, brA = 0.32): TagColor {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    bg: `rgba(${r}, ${g}, ${b}, ${bgA})`,
    text: hex,
    border: `rgba(${r}, ${g}, ${b}, ${brA})`,
  };
}

/* 600-level hues — saturated enough to read as dots/text on white */
const HUE = {
  slate: '#64748B', sky: '#0284C7', cyan: '#0891B2', teal: '#0D9488',
  indigo: '#4F46E5', violet: '#7C3AED', fuchsia: '#C026D3', pink: '#DB2777',
  rose: '#E11D48', red: '#DC2626', orange: '#EA580C', amber: '#D97706',
  yellow: '#CA8A04', emerald: '#059669', green: '#16A34A',
} as const;

const DEFAULT_TAG: TagColor = tag('#2563EB');

const PICKLIST_COLORS: Record<string, TagColor> = {
  'Interested':           tag(HUE.slate),
  'Application':          tag(HUE.sky),
  'Application Sent':     tag(HUE.sky),
  'Application Filled':   tag(HUE.indigo),

  'Vendor Validation':    tag(HUE.amber),
  'CS Validation':        tag(HUE.yellow),
  'EFS Processing':       tag(HUE.orange),
  'Due Dilligence':       tag(HUE.amber),
  'Due Diligence':        tag(HUE.amber),
  'Adjudication':         tag(HUE.violet),
  'Credit Follow-up':     tag(HUE.rose),
  'Credit Follow-Up':     tag(HUE.rose),
  'Credit Followup':      tag(HUE.rose),

  'Cards Sent':           tag(HUE.violet),
  'Cards Activated':      tag(HUE.fuchsia),
  'Card Funded':          tag(HUE.pink),
  'Card Swiped':          tag(HUE.teal),

  'Billing Form Sent':    tag(HUE.cyan),
  'Billing Form Filled':  tag(HUE.emerald),

  'Closed Won':           tag(HUE.green, 0.18, 0.42),
  'Closed Lost':          tag(HUE.red, 0.18, 0.42),

  'Yes':       tag(HUE.emerald),
  'No':        tag(HUE.red),
  'Open':      tag(HUE.sky),
  'Closed':    tag(HUE.slate),
  'Approved':  tag(HUE.emerald, 0.18, 0.42),
  'Declined':  tag(HUE.red, 0.18, 0.42),

  'Prepay':    tag(HUE.sky),
  'Deposit':   tag(HUE.amber),
  'LOC':       tag(HUE.violet),

  'LLC':                          tag(HUE.sky),
  'Corporation':                  tag(HUE.indigo),
  'Sole Proprietorship':          tag(HUE.amber),
  'Non-Profit':                   tag(HUE.emerald),
  'Non-profit':                   tag(HUE.emerald),
  'Partnership':                  tag(HUE.pink),
  'Natural Person':               tag(HUE.violet),
  'Unincorporated Association':   tag(HUE.teal),
  'Investment Company/Adviser':   tag(HUE.orange),
  'Limited Liability Company':    tag(HUE.sky),

  '1 Billing Cycle':       tag(HUE.sky),
  '2 Billing Cycle':       tag(HUE.violet),
  'Thursday - Wednesday':  tag(HUE.amber),

  /* WEX Application Status values */
  'Saved-Complete':                     tag(HUE.cyan),
  'Additional Authentication Required': tag(HUE.cyan),
  'Pending Decision':                   tag(HUE.amber),
  'Decisioned':                         tag(HUE.slate),
  'Pending Setup Data':                 tag(HUE.yellow),
  'Pending Setup-Generic':              tag(HUE.yellow),
  'Deposit Counter Offer Sent':         tag(HUE.amber),
  'BOCDD-Needed':                       tag(HUE.slate),
  'Saved-Incomplete':                   tag(HUE.slate),
  'App-Incomplete':                     tag(HUE.slate),
  'Disqualified':                       tag(HUE.red),
  'Closed/Fraud':                       tag(HUE.red),
  'Closed/Lost':                        tag(HUE.red),
  'Cards Produced':                     tag(HUE.slate),
};

const HASH_PALETTES: TagColor[] = [
  tag(HUE.sky), tag(HUE.violet), tag(HUE.amber),
  tag(HUE.teal), tag(HUE.pink), tag(HUE.emerald),
  tag(HUE.orange), tag(HUE.indigo), tag(HUE.cyan),
  tag(HUE.rose), tag(HUE.fuchsia), tag(HUE.yellow),
];

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_/]+/g, ' ');
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function csGetPicklistColor(value: string | null | undefined): TagColor {
  if (value === null || value === undefined || value === '') return DEFAULT_TAG;
  const direct = PICKLIST_COLORS[value];
  if (direct) return direct;

  const norm = normalizeKey(value);
  for (const key of Object.keys(PICKLIST_COLORS)) {
    if (normalizeKey(key) === norm) return PICKLIST_COLORS[key] ?? DEFAULT_TAG;
  }
  return HASH_PALETTES[hashString(norm) % HASH_PALETTES.length] ?? DEFAULT_TAG;
}

/** Filled badge style (widget badgeStyle) — translucent bg + vivid text + border. */
export function badgeStyle(value: string | null | undefined): CSSProperties {
  const c = csGetPicklistColor(value);
  return { background: c.bg, color: c.text, border: `1px solid ${c.border}` };
}

/** Status-dot color for the open-table design (widget dotStyle) — reuses the picklist hue. */
export function dotStyle(value: string | null | undefined): CSSProperties {
  return { background: csGetPicklistColor(value).text };
}
