/**
 * Workspace blocks inside a department desk.
 *
 * A desk is a hub, exactly like the Manager Overview: a grid of workspace cards, one per surface.
 * Tasks is the first on every desk; other blocks are declared per department as they land. Reusing
 * Overview's `.mg-card` shape rather than stacking panels means a desk reads the same way whether
 * it has one block or five, and a new block is an entry here rather than a layout change.
 */
import type { LucideIcon } from 'lucide-react';
import { ClipboardList, Gauge, Megaphone } from 'lucide-react';
import type { ManagerDepartmentId } from './managerNav';

export type DeptWorkspaceId = 'tasks' | 'kpi' | 'announcements';

export interface DeptWorkspace {
  id: DeptWorkspaceId;
  label: string;
  /** Short chip on the card, matching the Overview cards' `tag`. */
  tag: string;
  description: string;
  icon: LucideIcon;
  tone: string;
}

const TASKS: DeptWorkspace = {
  id: 'tasks',
  label: 'Tasks',
  tag: 'Assign',
  description:
    'Assign work to this department’s agents and track it to done — a status board with full history on every assignment.',
  icon: ClipboardList,
  tone: 'var(--tone-sky)',
};

const KPI: DeptWorkspace = {
  id: 'kpi',
  label: 'KPI',
  tag: 'Cycle',
  description:
    'Every sales agent’s headline numbers for the current billing cycle — card swipes, gallons and app fills.',
  icon: Gauge,
  tone: 'var(--tone-emerald)',
};

const ANNOUNCEMENTS: DeptWorkspace = {
  id: 'announcements',
  label: 'Announcements',
  tag: 'Publish',
  description:
    'Compose department-wide updates, preview exactly what agents will see and publish them to the right teams.',
  icon: Megaphone,
  tone: 'var(--tone-sky)',
};

/**
 * Which blocks a desk offers. Tasks is universal; KPI is Sales-only for now because its metrics are
 * sales-shaped (deal app fills, fuel volume by owning agent) and the other desks have no equivalent
 * yet. Add an entry here when one does — do not generalise the Sales query to fit.
 */
const BY_DEPARTMENT: Partial<Record<ManagerDepartmentId, readonly DeptWorkspace[]>> = {
  sales: [TASKS, KPI, ANNOUNCEMENTS],
};

export function deptWorkspaces(department: ManagerDepartmentId): readonly DeptWorkspace[] {
  return BY_DEPARTMENT[department] ?? [TASKS];
}

export function isDeptWorkspace(value: string): value is DeptWorkspaceId {
  return value === 'tasks' || value === 'kpi' || value === 'announcements';
}
