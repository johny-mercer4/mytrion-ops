/**
 * HR Mytrion navigation — a flat tab set, unlike Manager's card-hub. HR is a day-to-day workspace
 * (you live in Employees or Attendance), not a launcher, so every destination is one click away in
 * the sidebar.
 *
 * RBAC is layered. Layer 1 is entering the HR Mytrion at all (`canAccess` in resolveAccess, driven
 * by the access table in access/mytrions.config.ts). Layer 2 is `access(user)` per tab here. Both
 * only shape the UI — once these tabs get real endpoints, the endpoint is the security boundary
 * (HR → an `hr`-gated /v1/hr/*, mirroring Manager's `management` gate).
 *
 * Attendance / Requests / Profile stay `soon`. Employees, Departments, and Org Structure
 * are live against `hr_employees` / `hr_departments` (no mock trees).
 */
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarClock, Home, Inbox, Network, UserRound, Users } from 'lucide-react';
import type { UserContext } from '../../context/userContext';

export type HrTabId =
  | 'home'
  | 'employees'
  | 'departments'
  | 'org'
  | 'attendance'
  | 'requests'
  | 'profile';

export interface HrTab {
  id: HrTabId;
  label: string;
  /** One line on the tab's page head — what an HR user comes here to do. */
  description: string;
  icon: LucideIcon;
  /** Wayfinding hue, from the shared --tone-* scale (see styles/horizon.css). */
  tone: string;
  /** Extra sidebar-search terms (the label is always searched). */
  keywords: string[];
  /** Not wired to a live source yet — the tab renders <ComingSoon /> and the nav shows a badge. */
  soon?: boolean;
  /** Layer-2 gate: may THIS user open the tab? Default: any HR-level user. */
  access: (user: UserContext) => boolean;
}

/**
 * Hues are deliberately distinct per tab rather than five reds: a categorised sidebar is far faster
 * to scan when each destination owns a colour. HR's own red stays the module accent (buttons, focus
 * rings, links) via [data-mytrion='hr'] in styles/global.css.
 */
export const HR_TABS: HrTab[] = [
  {
    id: 'home',
    label: 'Home',
    description: 'Headcount at a glance, and the way in to everything else.',
    icon: Home,
    tone: 'var(--tone-rose)',
    keywords: ['overview', 'dashboard', 'hub'],
    access: () => true,
  },
  {
    id: 'employees',
    label: 'Employees',
    description: 'The people directory — every employee, their department, role and status.',
    icon: Users,
    tone: 'var(--tone-sky)',
    keywords: ['directory', 'people', 'staff', 'headcount', 'roster'],
    access: () => true,
  },
  {
    id: 'departments',
    label: 'Departments',
    description: 'Org units — name, code, lead and parent department.',
    icon: Building2,
    tone: 'var(--tone-indigo)',
    keywords: ['org', 'teams', 'units', 'structure', 'dept'],
    access: () => true,
  },
  {
    id: 'org',
    label: 'Org Structure',
    description: 'Department hierarchy with real headcount from linked employees.',
    icon: Network,
    tone: 'var(--tone-teal)',
    keywords: ['hierarchy', 'tree', 'org chart', 'structure'],
    access: () => true,
  },
  {
    id: 'attendance',
    soon: true,
    label: 'Attendance',
    description: 'Check-ins, hours worked and absence, per employee and per day.',
    icon: CalendarClock,
    tone: 'var(--tone-emerald)',
    keywords: ['time', 'check-in', 'hours', 'absence', 'shifts'],
    access: () => true,
  },
  {
    id: 'requests',
    soon: true,
    label: 'Requests',
    description: 'Leave, time-off and other employee requests awaiting a decision.',
    icon: Inbox,
    tone: 'var(--tone-amber)',
    keywords: ['leave', 'time off', 'approvals', 'vacation', 'sick'],
    access: () => true,
  },
  {
    id: 'profile',
    soon: true,
    label: 'Profile',
    description: 'One employee record in full — personal, work and reporting details.',
    icon: UserRound,
    tone: 'var(--tone-violet)',
    keywords: ['record', 'personal', 'details', 'me'],
    access: () => true,
  },
];

/** Tabs this user may open (Layer-2 filtered) — drives the sidebar. */
export function accessibleHrTabs(user: UserContext): HrTab[] {
  return HR_TABS.filter((tab) => tab.access(user));
}

/** Layer-2 check for a single tab — guards the view switch so stale state can't bypass the sidebar. */
export function canOpenHrTab(user: UserContext, id: HrTabId): boolean {
  const tab = HR_TABS.find((t) => t.id === id);
  return tab ? tab.access(user) : false;
}

export function findHrTab(id: HrTabId): HrTab {
  // HR_TABS covers every HrTabId, so this is total; the fallback satisfies the type checker.
  return HR_TABS.find((t) => t.id === id) ?? HR_TABS[0]!;
}
