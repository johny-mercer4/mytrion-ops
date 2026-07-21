/**
 * Applications panel — table column definitions + cell renderers, a 1:1 port of the
 * widget's tableColumns computed + the per-cell <template> branches (applications-panel.js).
 * Columns whose CRM field the live view-model doesn't carry (Oldest_Open_Date,
 * Billing_Form_Y_N, Verification_Notes, Tracking_Number) render '—'.
 */
import type { CSSProperties, ReactElement } from 'react';

import type { OnboardingField } from '@/api/cs';
import { dotStyle } from './colors';
import { type Application, fullName } from './data';

export type SubTab = 'apps' | 'clients';

export type ColKey =
  | 'id'
  | 'app_id'
  | 'name'
  | 'picklist'
  | 'stage'
  | 'wex_status'
  | 'contact'
  | 'generic'
  | 'phone'
  | 'address'
  | 'date'
  | 'agent'
  | 'notes'
  | 'boolean'
  | 'check'
  | 'verified';

export interface AppColumn {
  key: ColKey;
  label: string;
  field?: string;
  thStyle?: CSSProperties;
}

const CENTER = 'center' as const;

/** Widget: onboarding tick-box field → optimistic view-model prop. */
export const CHECK_PROP: Record<OnboardingField, 'ta' | 'efs' | 'lmt' | 'mob' | 'chn'> = {
  Email_to_TA: 'ta',
  TA_EFS_Added: 'efs',
  Limits_added: 'lmt',
  Mobile_Driver_App: 'mob',
  Chain_policy: 'chn',
};

export function isOnboardingField(field: string | undefined): field is OnboardingField {
  return field !== undefined && field in CHECK_PROP;
}

const CLIENT_COLUMNS: AppColumn[] = [
  { key: 'app_id', label: 'App ID', thStyle: { minWidth: 90 } },
  { key: 'name', label: 'Company', thStyle: { minWidth: 180 } },
  { key: 'id', label: 'Carrier ID', thStyle: { minWidth: 110 } },
  { key: 'picklist', label: 'Business Type', field: 'Type_of_Business', thStyle: { minWidth: 150 } },
  { key: 'stage', label: 'Stage', thStyle: { minWidth: 150 } },
  { key: 'wex_status', label: 'WEX Status', thStyle: { minWidth: 160 } },
  { key: 'contact', label: 'Contact', thStyle: { minWidth: 140 } },
  { key: 'generic', label: 'MC', field: 'emc', thStyle: { minWidth: 100 } },
  { key: 'generic', label: 'DOT', field: 'DOT', thStyle: { minWidth: 100 } },
  { key: 'phone', label: 'Phone', thStyle: { minWidth: 130 } },
  { key: 'generic', label: 'Email', field: 'Email', thStyle: { minWidth: 180 } },
  { key: 'address', label: 'Address', thStyle: { minWidth: 200 } },
  { key: 'generic', label: 'Credit Score', field: 'Credit_Score', thStyle: { minWidth: 90 } },
  { key: 'date', label: 'Oldest Open', field: 'Oldest_Open_Date', thStyle: { minWidth: 110 } },
  { key: 'generic', label: 'Trucks', field: 'Number_of_Trucks', thStyle: { minWidth: 80 } },
  { key: 'generic', label: 'Cards Req.', field: 'Cards_Requested', thStyle: { minWidth: 80 } },
  { key: 'date', label: 'Date Filled', field: 'Date_Filled', thStyle: { minWidth: 110 } },
  { key: 'agent', label: 'Agent (Deal)', thStyle: { minWidth: 140 } },
  { key: 'notes', label: 'CS Notes', field: 'Customer_Service_Notes', thStyle: { minWidth: 180 } },
  { key: 'picklist', label: 'Billing Cycle', field: 'Billing_Cycle', thStyle: { minWidth: 140 } },
  /* Onboarding checklist — same explicit tick boxes as Apps in Process */
  { key: 'check', label: 'Email to TA', field: 'Email_to_TA', thStyle: { minWidth: 82, textAlign: CENTER } },
  { key: 'check', label: 'TA / EFS', field: 'TA_EFS_Added', thStyle: { minWidth: 72, textAlign: CENTER } },
  { key: 'check', label: 'Limits', field: 'Limits_added', thStyle: { minWidth: 64, textAlign: CENTER } },
  { key: 'check', label: 'Mobile App', field: 'Mobile_Driver_App', thStyle: { minWidth: 84, textAlign: CENTER } },
  { key: 'check', label: 'Chain Policy', field: 'Chain_policy', thStyle: { minWidth: 90, textAlign: CENTER } },
  { key: 'verified', label: 'VRF', thStyle: { minWidth: 50 } },
  { key: 'notes', label: 'Verif. Notes', field: 'Verification_Notes', thStyle: { minWidth: 180 } },
  { key: 'generic', label: 'Tracking #', field: 'Tracking_Number', thStyle: { minWidth: 120 } },
];

const APPS_COLUMNS: AppColumn[] = [
  { key: 'id', label: 'App ID', thStyle: { minWidth: 90 } },
  { key: 'name', label: 'Company', thStyle: { minWidth: 180 } },
  { key: 'picklist', label: 'Business Type', field: 'Type_of_Business', thStyle: { minWidth: 150 } },
  { key: 'stage', label: 'Stage', thStyle: { minWidth: 150 } },
  { key: 'wex_status', label: 'WEX Status', thStyle: { minWidth: 160 } },
  { key: 'contact', label: 'Contact', thStyle: { minWidth: 140 } },
  { key: 'generic', label: 'MC', field: 'emc', thStyle: { minWidth: 100 } },
  { key: 'generic', label: 'DOT', field: 'DOT', thStyle: { minWidth: 100 } },
  { key: 'phone', label: 'Phone', thStyle: { minWidth: 130 } },
  { key: 'generic', label: 'Email', field: 'Email', thStyle: { minWidth: 180 } },
  { key: 'address', label: 'Address', thStyle: { minWidth: 200 } },
  { key: 'generic', label: 'Credit Score', field: 'Credit_Score', thStyle: { minWidth: 90 } },
  { key: 'date', label: 'Oldest Open', field: 'Oldest_Open_Date', thStyle: { minWidth: 110 } },
  { key: 'generic', label: 'Trucks', field: 'Number_of_Trucks', thStyle: { minWidth: 80 } },
  { key: 'generic', label: 'Cards Req.', field: 'Cards_Requested', thStyle: { minWidth: 80 } },
  { key: 'date', label: 'Date Filled', field: 'Date_Filled', thStyle: { minWidth: 110 } },
  { key: 'agent', label: 'Agent (Deal)', thStyle: { minWidth: 140 } },
  { key: 'notes', label: 'CS Notes', field: 'Customer_Service_Notes', thStyle: { minWidth: 180 } },
  { key: 'picklist', label: 'Billing Cycle', field: 'Billing_Cycle', thStyle: { minWidth: 140 } },
  { key: 'boolean', label: 'Billing Form', field: 'Billing_Form_Y_N', thStyle: { minWidth: 110 } },
  { key: 'verified', label: 'VRF', thStyle: { minWidth: 50 } },
  { key: 'notes', label: 'Verif. Notes', field: 'Verification_Notes', thStyle: { minWidth: 180 } },
  /* Onboarding checklist — mirrors the CS tracking sheet (tick directly in the row) */
  { key: 'check', label: 'Email to TA', field: 'Email_to_TA', thStyle: { minWidth: 82, textAlign: CENTER } },
  { key: 'check', label: 'TA / EFS', field: 'TA_EFS_Added', thStyle: { minWidth: 72, textAlign: CENTER } },
  { key: 'check', label: 'Limits', field: 'Limits_added', thStyle: { minWidth: 64, textAlign: CENTER } },
  { key: 'check', label: 'Mobile App', field: 'Mobile_Driver_App', thStyle: { minWidth: 84, textAlign: CENTER } },
  { key: 'check', label: 'Chain Policy', field: 'Chain_policy', thStyle: { minWidth: 90, textAlign: CENTER } },
  { key: 'generic', label: 'Tracking #', field: 'Tracking_Number', thStyle: { minWidth: 120 } },
];

export function columnsFor(tab: SubTab): AppColumn[] {
  return tab === 'clients' ? CLIENT_COLUMNS : APPS_COLUMNS;
}

/* ─── Formatters (widget parity) ─────────────────────────────────────────── */

export function formatPhone(v: string): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return v;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Widget field name → live view-model accessor. Unknown/uncarried fields → ''. */
const FIELD_GET: Record<string, (a: Application) => string | number | null> = {
  Type_of_Business: (a) => a.biz,
  emc: (a) => a.mc,
  DOT: (a) => a.dot,
  Email: (a) => a.email,
  Credit_Score: (a) => a.credit,
  Number_of_Trucks: (a) => a.trucks,
  Cards_Requested: (a) => a.cards,
  Date_Filled: (a) => a.date,
  Customer_Service_Notes: (a) => a.notes,
  Billing_Cycle: (a) => a.cycle,
  /* Not carried by the live view-model — render '—' (do not invent data) */
  Oldest_Open_Date: () => null,
  Billing_Form_Y_N: () => null,
  Verification_Notes: () => null,
  Tracking_Number: () => null,
};

function fieldValue(app: Application, field: string | undefined): string {
  if (!field) return '';
  const get = FIELD_GET[field];
  if (!get) return '';
  const v = get(app);
  return v === null || v === undefined || v === '' ? '' : String(v);
}

/* ─── Cell renderer — the widget's per-key <template> branches ───────────── */

const MUTED = <span className="cs-app-row-muted">—</span>;

export function AppCell({
  col,
  app,
  subTab,
  pendingToggle,
}: {
  col: AppColumn;
  app: Application;
  subTab: SubTab;
  pendingToggle: string | null;
}): ReactElement {
  switch (col.key) {
    /* Company name */
    case 'name':
      return <div className="cs-app-row-name">{app.company || '—'}</div>;

    /* App ID / Carrier ID (primary, copyable) */
    case 'id': {
      const value = subTab === 'clients' ? app.carrierId : app.appId;
      const title =
        subTab === 'clients'
          ? app.carrierId
            ? 'Click to copy Carrier ID'
            : ''
          : app.appId
            ? 'Click to copy Application ID'
            : '';
      return (
        <span className="cs-app-row-id" title={title}>
          {value || '—'}
        </span>
      );
    }

    /* App ID (Clients secondary) */
    case 'app_id':
      return (
        <span className="cs-app-row-mono" title={app.appId ? 'Click to copy Application ID' : ''}>
          {app.appId || '—'}
        </span>
      );

    /* Stage — colored status dot + plain label */
    case 'stage':
      return app.stage ? (
        <span className="cs-dot-label">
          <span className="cs-dot-mark" style={dotStyle(app.stage)} />
          {app.stage}
        </span>
      ) : (
        MUTED
      );

    /* WEX Status — quiet text */
    case 'wex_status':
      return app.wex ? <span className="cs-app-row-text">{app.wex}</span> : MUTED;

    /* Contact — first + last name in one column */
    case 'contact': {
      const name = fullName(app);
      return name ? <span className="cs-app-row-text">{name}</span> : MUTED;
    }

    /* Phone */
    case 'phone':
      return <span className="cs-app-row-mono">{formatPhone(app.phone) || '—'}</span>;

    /* Date */
    case 'date':
      return <span className="cs-app-row-date">{fieldValue(app, col.field ?? 'Date_Filled') || '—'}</span>;

    /* Deal agent (from related Deal Owner / `_dealOwner`) */
    case 'agent': {
      const unassigned = !app.agent || app.agent === 'not assigned';
      if (unassigned) {
        return <span className="cs-badge cs-badge-muted">not assigned</span>;
      }
      return <span className="cs-app-row-owner">{app.agent}</span>;
    }

    /* Address summary */
    case 'address': {
      const short = [app.city, app.state].filter(Boolean).join(', ');
      return short ? (
        <span className="cs-app-row-text" title={short}>
          {short}
        </span>
      ) : (
        MUTED
      );
    }

    /* Notes preview */
    case 'notes': {
      const v = fieldValue(app, col.field);
      return v ? (
        <span className="cs-app-row-text" title={v}>
          {truncate(v, 60)}
        </span>
      ) : (
        MUTED
      );
    }

    /* Generic picklist — quiet text */
    case 'picklist': {
      const v = fieldValue(app, col.field);
      return v ? <span className="cs-app-row-text">{v}</span> : MUTED;
    }

    /* Inline tickable onboarding checkbox */
    case 'check': {
      if (!isOnboardingField(col.field)) return MUTED;
      const on = app[CHECK_PROP[col.field]] === 1;
      const busy = pendingToggle === col.field;
      return (
        <span
          className={`cs-cell-check${on ? ' is-on' : ''}${busy ? ' is-busy' : ''}`}
          role="checkbox"
          aria-checked={on ? 'true' : 'false'}
          aria-label={col.label}
          title={`${col.label} — click to toggle`}
        >
          <span className="cs-cell-check-box">
            <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </span>
      );
    }

    /* Verified checkmark */
    case 'verified':
      return app.verified ? <span className="cs-app-dot cs-dot-verified">✓</span> : MUTED;

    /* Generic text / number (boolean falls through to generic, widget parity) */
    default: {
      const v = fieldValue(app, col.field);
      return <span className="cs-app-row-text">{v || '—'}</span>;
    }
  }
}
