/**
 * THE access table — the single place to declare who can enter each Mytrion.
 *
 * Access rules (see resolveAccess.ts):
 *   - allowedProfiles  → DEFAULT access: a CRM profile maps to a Mytrion.
 *   - allowedRoles     → optional access by CRM role.
 *   - allowedUsernames → ADDITIVE override: "these named users ALSO get in", regardless of profile.
 *   - usernameContainsAny → SUBSTRING match on Zoho user_name (case-insensitive contains).
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
  | 'verification'
  | 'manager'
  | 'analyst'
  | 'customer-service';

export interface MytrionAccessRule {
  id: MytrionId;
  title: string;
  /** Short context badge shown in the header (e.g. admin → "RnD"). */
  tag: string;
  /** Glyph key for the picker/nav (see MytrionGlyph) + one-line blurb. */
  icon: string;
  blurb: string;
  /** Accent hue for the Mytrion's icon chip: maps to a token. */
  hue: 'accent' | 'success' | 'purple' | 'orange' | 'danger' | 'warning' | 'black' | 'blue' | 'red' | 'green' | 'yellow' | 'dark-purple' | 'light-blue' | 'rocket';
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
  /**
   * SUBSTRING access by Zoho user_name — granted if userName CONTAINS any term (case-insensitive).
   * Optional; omit for exact-only rules.
   */
  usernameContainsAny?: string[];
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
    hue: 'black',
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
    hue: 'rocket',
    department: 'sales',
    allDepartments: false,
    // Every rep's CRM profile is "Sales Agent" (region lives in the ROLE). Substring match so any
    // "…Sales Agent…" profile lands here — and ONLY here — so they auto-enter /m/sales on login.
    // List mirrors the backend DEFAULT_PROFILE_SEED (src/lib/mytrions.ts) — the server-resolved
    // access wins for verified sessions; this fallback only covers dev-mock/legacy paths.
    allowedProfiles: ['Sales', 'Sales Agent', 'Sales Plus', 'Sales Assistant', 'Referral Standard Plus', 'Standard Plus'],
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
    hue: 'blue',
    department: 'billing',
    allDepartments: false,
    // 'Standard Plus' mirrors DEFAULT_PROFILE_SEED (sales + billing).
    allowedProfiles: ['Billing', 'Standard Plus'],
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
    hue: 'red',
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
    hue: 'green',
    department: 'finance',
    allDepartments: false,
    // Restricted workspace: Administrator profile OR named finance operators (substring match).
    allowedProfiles: ['Administrator'],
    allowedRoles: [],
    allowedUsernames: [],
    usernameContainsAny: ['Azimov', 'Mirjalol'],
    adminBypass: false,
    status: 'ported',
    portedFrom: 'zoho-octane/app/mytrion-finance',
  },
  'customer-service': {
    id: 'customer-service',
    title: 'Customer Service Mytrion',
    tag: 'CS',
    icon: 'customer-service',
    blurb: 'Tickets, calls, contacts and Desk + DWH analytics in one place.',
    hue: 'yellow',
    department: 'customer-service',
    allDepartments: false,
    // The org has NO "Customer Service"/"Support" PROFILES (verified against the live user
    // roster, 2026-07-16) — CS staff carry "Standard"/"Standard Plus" profiles and are
    // identified by their Zoho ROLE. Roles below match all 22 CS users (20 agents + 2
    // managers); the profile entries stay as a harmless forward-compat grant.
    // 'Standard' mirrors DEFAULT_PROFILE_SEED (→ customer-service).
    allowedProfiles: ['Customer Service', 'Support', 'Standard'],
    allowedRoles: ['Customer Service Agent', 'Customer Service Manager'],
    allowedUsernames: [],
    adminBypass: true,
    status: 'ported',
    portedFrom: 'zoho-octane/app/mytrion-customer-service',
  },
  verification: {
    id: 'verification',
    title: 'Verification Mytrion',
    tag: 'Verification',
    icon: 'verification',
    blurb: 'Verification queue, document checklist and audit trail.',
    hue: 'dark-purple',
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
    hue: 'light-blue',
    department: 'management',
    // OPEN DECISION: are managers hierarchical (see across departments)? If yes, set true.
    allDepartments: false,
    allowedProfiles: ['Manager'],
    allowedRoles: ['Manager'],
    allowedUsernames: [],
    adminBypass: true,
    status: 'new',
  },
  analyst: {
    id: 'analyst',
    title: 'Analytics Mytrion',
    tag: 'Analytics',
    icon: 'analyst',
    blurb:
      'Cross-department analytics — pipeline metrics, conversions, transactions, tickets and performance trends.',
    hue: 'light-blue',
    department: 'analytics',
    // Cross-department read-only analytics: the backend `analyst` agent reads across every
    // department (allowAllDepartments), so retrieval is broad and the dept slug is display-only.
    allDepartments: true,
    allowedProfiles: [],
    allowedRoles: ['Analytics Specialist'],
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
  'verification',
  'manager',
  'analyst',
];

/**
 * Live MytrionIds temporarily parked as Coming soon — shown on the picker grid but not
 * enterable (filtered out of resolveAccessibleMytrions / canAccess).
 */
export const COMING_SOON_MYTRION_IDS: readonly MytrionId[] = [
  'collection',
  'verification',
  'manager',
  'analyst',
];

/** Picker-only tiles — visible on the wizard grid but not routable yet. */
export interface ComingSoonPickerTile {
  id: string;
  title: string;
  icon: string;
  hue: 'accent' | 'success' | 'purple' | 'orange' | 'danger' | 'warning' | 'black' | 'blue' | 'red' | 'green' | 'yellow' | 'dark-purple' | 'light-blue' | 'rocket';
}

export const COMING_SOON_PICKER_TILES: ComingSoonPickerTile[] = [
  ...COMING_SOON_MYTRION_IDS.map((id) => ({
    id,
    title: MYTRIONS[id].title,
    icon: MYTRIONS[id].icon,
    hue: MYTRIONS[id].hue,
  })),
  {
    id: 'hr',
    title: 'HR Mytrion',
    icon: 'hr',
    hue: 'red',
  },
];

/** Type guard for a path param. */
export function isMytrionId(value: string): value is MytrionId {
  return Object.prototype.hasOwnProperty.call(MYTRIONS, value);
}

/**
 * Public URL slug for each Mytrion, used under /main/:slug (e.g. /main/salesmytrion). Kept distinct
 * from the internal MytrionId (which stays the DB/RBAC-facing department key) so the URL can read
 * naturally without renaming anything backend-side. `customer-service` shortens to "cs" to match
 * the org's own shorthand for the department.
 */
export const MYTRION_URL_SLUG: Record<MytrionId, string> = {
  admin: 'adminmytrion',
  sales: 'salesmytrion',
  billing: 'billingmytrion',
  collection: 'collectionmytrion',
  finance: 'financemytrion',
  verification: 'verificationmytrion',
  manager: 'managermytrion',
  analyst: 'analystmytrion',
  'customer-service': 'csmytrion',
};

const URL_SLUG_TO_ID: Record<string, MytrionId> = Object.fromEntries(
  Object.entries(MYTRION_URL_SLUG).map(([id, slug]) => [slug, id as MytrionId]),
);

/** Resolve a /main/:slug path param back to its MytrionId, or undefined for an unknown slug. */
export function mytrionIdFromUrlSlug(slug: string): MytrionId | undefined {
  return URL_SLUG_TO_ID[slug];
}

/**
 * Backend department agent keys (mirror of src/modules/agents/types.ts AGENT_KEYS). The chat UI sends
 * `agent:<key>` to POST /v1/agent for direct-to-child. Every non-admin MytrionId equals its agent key;
 * `admin` has no agent (→ orchestrator mode). `marketing` has no Mytrion but appears in an admin's
 * orchestrator run, so its label is still needed.
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
