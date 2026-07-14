/**
 * THE access table — the single place to declare who can enter each Mytrion.
 *
 * Access rules (see resolveAccess.ts):
 *   - allowedProfiles  → DEFAULT access: a CRM profile maps to a Mytrion.
 *   - allowedRoles     → optional access by CRM role.
 *   - allowedUsernames → ADDITIVE override: "these named users ALSO get in", regardless of profile.
 *   - adminBypass      → anyone matching ADMIN_PROFILES / ADMIN_ROLES also gets in.
 *
 * `department` is the canonical backend slug (department_access) forwarded on chat/knowledge calls.
 * `allDepartments` sends allDepartments:true on knowledge retrieval (broad, admin-style scope).
 *
 * ⚠️ EDIT the allowedProfiles / allowedRoles / allowedUsernames below to your REAL Zoho CRM
 * profile/role/user names. The values here are placeholders so the skeleton resolves sensibly.
 */

export type MytrionId =
  | 'admin'
  | 'sales'
  | 'billing'
  | 'collection'
  | 'finance'
  | 'retention'
  | 'verification'
  | 'customer-service'
  | 'manager';

export interface MytrionAccessRule {
  id: MytrionId;
  title: string;
  /** Short context badge shown in the header (e.g. admin → "RnD"). */
  tag: string;
  /** Glyph key for the picker/nav (see MytrionGlyph) + one-line blurb. */
  icon: string;
  blurb: string;
  /** Accent hue for the Mytrion's icon chip: maps to a token (accent|success|purple|orange|danger). */
  hue: 'accent' | 'success' | 'purple' | 'orange' | 'danger';
  /** Canonical department_access slug forwarded to the backend. */
  department: string;
  /** Send allDepartments:true on knowledge queries (broad retrieval). */
  allDepartments: boolean;
  /** DEFAULT access by CRM profile name (case-insensitive, EXACT match). */
  allowedProfiles: string[];
  /**
   * SUBSTRING access by CRM profile — a profile is granted if it CONTAINS any of these terms
   * (case-insensitive). Mirrors the backend's sales-agent detection so "Sales Agent" also catches
   * variants like "Senior Sales Agent". Optional; omit for exact-only rules.
   */
  profileContainsAny?: string[];
  /** Optional access by CRM role name (case-insensitive). */
  allowedRoles: string[];
  /** ADDITIVE named-user overrides (case-insensitive) — get access regardless of profile/role. */
  allowedUsernames: string[];
  /** Admins (ADMIN_PROFILES/ADMIN_ROLES) also get this Mytrion. */
  adminBypass: boolean;
  /** 'ported' = has an existing Zoho/Vue origin to port; 'new' = stub for the design agent. */
  status: 'ported' | 'new';
  /** Existing Zoho widget folder this is ported from (for the design agent), if any. */
  portedFrom?: string;
}

/** Profiles/roles that count as admin — drive adminBypass and the Admin Mytrion. EDIT to your org. */
export const ADMIN_PROFILES = ['Administrator'];
export const ADMIN_ROLES: string[] = ['CEO'];

export const MYTRIONS: Record<MytrionId, MytrionAccessRule> = {
  admin: {
    id: 'admin',
    title: 'Mytrion Admin',
    tag: 'RnD',
    icon: 'admin',
    blurb: 'RnD knowledge base — train agents, browse embeddings, map agent scope.',
    hue: 'accent',
    department: 'admin',
    allDepartments: true,
    allowedProfiles: ['Administrator'],
    allowedRoles: ['CEO'],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/agent-scope',
  },
  sales: {
    id: 'sales',
    title: 'Sales Mytrion',
    tag: 'Sales',
    icon: 'sales',
    blurb: 'Self-service ops — carrier balances, cards, invoices, EFS/WEX, automations.',
    hue: 'success',
    department: 'sales',
    allDepartments: false,
    // Every rep's CRM profile is "Sales Agent" (region lives in the ROLE). Substring match so any
    // "…Sales Agent…" profile lands here — and ONLY here — so they auto-enter /m/sales on login.
    allowedProfiles: ['Sales'],
    profileContainsAny: ['Sales Agent'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/self-service',
  },
  billing: {
    id: 'billing',
    title: 'Billing Mytrion',
    tag: 'Billing',
    icon: 'billing',
    blurb: 'Invoices, transactions, debtors and split-payment reconciliation.',
    hue: 'purple',
    department: 'billing',
    allDepartments: false,
    allowedProfiles: ['Billing'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/billing-mytrion',
  },
  collection: {
    id: 'collection',
    title: 'Collection Mytrion',
    tag: 'Collection',
    icon: 'collection',
    blurb: 'Bad-debt escalation timeline, Array agency filing, recovery cases.',
    hue: 'danger',
    department: 'collection',
    allDepartments: false,
    allowedProfiles: ['Collection'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
  },
  finance: {
    id: 'finance',
    title: 'Finance Mytrion',
    tag: 'Finance',
    icon: 'finance',
    blurb: 'Fueling transactions, invoicing, balance audits and pattern checks.',
    hue: 'orange',
    department: 'finance',
    allDepartments: false,
    allowedProfiles: ['Finance'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/mytrion-finance',
  },
  'customer-service': {
    id: 'customer-service',
    title: 'Customer Service Mytrion',
    tag: 'CS',
    icon: 'customer-service',
    blurb: 'Tickets, calls, contacts and Desk + DWH analytics in one place.',
    hue: 'accent',
    department: 'customer-service',
    allDepartments: false,
    allowedProfiles: ['Customer Service', 'Support'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/mytrion-customer-service',
  },
  retention: {
    id: 'retention',
    title: 'Retention Mytrion',
    tag: 'Retention',
    icon: 'retention',
    blurb: 'Churn signals, win-back playbooks and retention metrics.',
    hue: 'danger',
    department: 'retention',
    allDepartments: false,
    allowedProfiles: ['Retention'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
  },
  verification: {
    id: 'verification',
    title: 'Verification Mytrion',
    tag: 'Verification',
    icon: 'verification',
    blurb: 'Verification queue, document checklist and audit trail.',
    hue: 'success',
    department: 'verification',
    allDepartments: false,
    allowedProfiles: ['Verification'],
    allowedRoles: [],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
  },
  manager: {
    id: 'manager',
    title: 'Manager Mytrion',
    tag: 'Manager',
    icon: 'manager',
    blurb: 'Team metrics roll-up and cross-department KPIs.',
    hue: 'purple',
    department: 'management',
    // OPEN DECISION: are managers hierarchical (see across departments)? If yes, set true.
    allDepartments: false,
    allowedProfiles: ['Manager'],
    allowedRoles: ['Manager'],
    allowedUsernames: [],
    adminBypass: true,
    status: 'new',
  },
};

/** Display order for the picker. */
export const MYTRION_ORDER: MytrionId[] = [
  'admin',
  'sales',
  'billing',
  'collection',
  'finance',
  'customer-service',
  'retention',
  'verification',
  'manager',
];

/** Type guard for a path param. */
export function isMytrionId(value: string): value is MytrionId {
  return Object.prototype.hasOwnProperty.call(MYTRIONS, value);
}

/**
 * Backend department agent keys (mirror of src/modules/agents/types.ts AGENT_KEYS). The chat UI sends
 * `agent:<key>` to POST /v1/agent for direct-to-child. Every non-admin MytrionId equals its agent key;
 * `admin` has no agent (→ orchestrator mode). `marketing`/`analyst` have no Mytrion but appear in an
 * admin's orchestrator run, so their labels are still needed.
 */
export type AgentKey =
  | 'customer-service'
  | 'billing'
  | 'verification'
  | 'retention'
  | 'sales'
  | 'marketing'
  | 'finance'
  | 'analyst'
  | 'manager'
  | 'collection';

export const AGENT_LABELS: Record<AgentKey, string> = {
  sales: 'Sales',
  billing: 'Billing',
  collection: 'Collection',
  finance: 'Finance',
  retention: 'Retention',
  verification: 'Verification',
  'customer-service': 'Customer Service',
  marketing: 'Marketing',
  analyst: 'Analyst',
  manager: 'Manager',
};

/** The department agent for a Mytrion. `admin` → null (orchestrator routes across the caller's agents). */
export function agentKeyFor(id: MytrionId): AgentKey | null {
  return id === 'admin' ? null : (id as AgentKey);
}
