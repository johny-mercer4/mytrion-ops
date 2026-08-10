/**
 * Manager Mytrion navigation — two groups, mirroring how a manager actually works:
 *
 *   General      Overview (the hub; the workspace cards open from here)
 *   Departments  one entry per Octane department the manager oversees
 *
 * RBAC is layered. Layer 1 is entering the Manager Mytrion at all (`canAccess` in resolveAccess).
 * Layer 2 is `access(user)` per card/department here. Both only shape the UI — the endpoint behind
 * each surface is the real security boundary (EFS Console → the `management`-gated /v1/manager/efs/*).
 * Departments are UI-only today, so their gate is open; when per-department RBAC lands, narrow the
 * `access` predicate rather than hiding items in the shell.
 *
 * Referrals and Loyalty moved to the Marketing Mytrion; their routes moved with them.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  BadgeCheck,
  CreditCard,
  Fuel,
  Headphones,
  LineChart,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import type { UserContext } from '../../context/userContext';
import { canSeeTab } from '../../access/resolveAccess';

/** Cards on the Overview hub. Add an id here as new hub blocks land (payouts, approvals, KPIs, …). */
export type ManagerCardId = 'efs';

export type ManagerDepartmentId =
  | 'sales'
  | 'customer-service'
  | 'billing'
  | 'finance'
  | 'collection'
  | 'mobile'
  | 'verification';

export type ManagerViewId = 'overview' | ManagerCardId | ManagerDepartmentId;

export interface ManagerCard {
  id: ManagerCardId;
  label: string;
  /** Short chip shown on the card. */
  tag: string;
  description: string;
  icon: LucideIcon;
  /** Wayfinding hue, from the shared --tone-* scale (see styles/horizon.css). */
  tone: string;
  /** Layer-2 gate: may THIS user open the card? Default: any Manager-level user. */
  access: (user: UserContext) => boolean;
}

export interface ManagerDepartment {
  id: ManagerDepartmentId;
  label: string;
  /**
   * Sidebar label. The full `label` truncates in a 248px rail ("Customer Service Manag…"), and the
   * nav group is already titled Departments, so repeating "Management" there costs more than it says.
   */
  navLabel: string;
  /** One line on the department's landing — what a manager comes here to do. */
  description: string;
  icon: LucideIcon;
  tone: string;
  access: (user: UserContext) => boolean;
}

export const MANAGER_CARDS: ManagerCard[] = [
  {
    id: 'efs',
    label: 'EFS Console',
    tag: 'Live',
    description:
      'Live EFS state for every client — parent balance, contracts, cards, transactions and money codes, read straight from the vendor.',
    icon: Fuel,
    // Blue reads as the fuel network's own signal and stays clear of Referrals' pink and Loyalty's
    // amber, so the three hub cards are distinguishable at a glance.
    tone: 'var(--tone-blue)',
    // Same Layer-2 posture as the other two: entering Manager is the gate. The real boundary is
    // the `management`-gated /v1/manager/efs/* endpoint, which additionally refuses any carrier
    // that is not in octane.dim_company.
    access: () => true,
  },
];

/**
 * Departments the manager oversees. Each hue is that department's own colour elsewhere in the app, so
 * a manager sees the same signal here as when they enter that Mytrion — except Verification, which
 * takes violet because its usual teal belongs to Finance here, and distinctness inside one list wins.
 */
export const MANAGER_DEPARTMENTS: ManagerDepartment[] = [
  {
    id: 'sales',
    label: 'Sales Management',
    navLabel: 'Sales',
    description: 'Pipeline health, agent performance, retention hand-offs and the Open Pool.',
    icon: LineChart,
    tone: 'var(--tone-sky)',
    access: () => true,
  },
  {
    id: 'customer-service',
    label: 'Customer Service Management',
    navLabel: 'Customer Service',
    description: 'Ticket load, response times, retention desks and CITI hand-off throughput.',
    icon: Headphones,
    tone: 'var(--tone-amber)',
    access: () => true,
  },
  {
    id: 'billing',
    label: 'Billing Management',
    navLabel: 'Billing',
    description: 'Invoicing, payment reconciliation, debtors and prepay balance oversight.',
    icon: CreditCard,
    tone: 'var(--tone-emerald)',
    access: () => true,
  },
  {
    id: 'finance',
    label: 'Finance Management',
    navLabel: 'Finance',
    description: 'Margin, fuel spend, forecasting and month-end reporting.',
    icon: TrendingUp,
    tone: 'var(--tone-teal)',
    access: () => true,
  },
  {
    id: 'collection',
    label: 'Collection Management',
    navLabel: 'Collection',
    description: 'Bad-debt escalation, agency filing and recovery outcomes.',
    icon: Archive,
    tone: 'var(--tone-indigo)',
    access: () => true,
  },
  {
    id: 'mobile',
    label: 'Mobile Management',
    navLabel: 'Mobile',
    description: 'The Octane driver app — adoption, releases and in-app behaviour. Not the mini-app.',
    icon: Smartphone,
    tone: 'var(--tone-cyan)',
    access: () => true,
  },
  {
    id: 'verification',
    label: 'Verification Management',
    navLabel: 'Verification',
    description: 'Credit and compliance decisioning throughput, and the verification pipeline.',
    icon: BadgeCheck,
    tone: 'var(--tone-violet)',
    access: () => true,
  },
];

/** Cards this user may open (Layer-2 filtered) — drives the Overview grid. */
export function accessibleManagerCards(user: UserContext): ManagerCard[] {
  return MANAGER_CARDS.filter((card) => card.access(user) && canSeeTab(user, 'manager', card.id));
}

/** Departments this user may open (Layer-2 filtered) — drives the Departments nav group. */
export function accessibleManagerDepartments(user: UserContext): ManagerDepartment[] {
  return MANAGER_DEPARTMENTS.filter((dept) => dept.access(user) && canSeeTab(user, 'manager', dept.id));
}

/** Layer-2 check for a single card — guards the view switch so a stale state can't bypass the grid. */
export function canOpenManagerCard(user: UserContext, id: ManagerCardId): boolean {
  const card = MANAGER_CARDS.find((c) => c.id === id);
  return card ? card.access(user) : false;
}

/** Layer-2 check for a department view. */
export function canOpenManagerDepartment(user: UserContext, id: ManagerDepartmentId): boolean {
  const dept = MANAGER_DEPARTMENTS.find((d) => d.id === id);
  return dept ? dept.access(user) : false;
}

export function findManagerDepartment(id: string): ManagerDepartment | undefined {
  return MANAGER_DEPARTMENTS.find((d) => d.id === id);
}
