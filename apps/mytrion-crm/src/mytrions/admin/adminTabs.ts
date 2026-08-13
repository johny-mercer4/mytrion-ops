/**
 * Admin Mytrion tabs — the declaration the shell and the permission-set picker share.
 *
 * REACT-FREE ON PURPOSE. This is imported by `access/tabRegistry.ts`, which the Permission Sets
 * screen reads to render its tab picker. If this file pulled in a component, the registry would drag
 * every workspace's data layer into the Admin chunk — and `admin/index.tsx` would import itself.
 * Icons stay in the shell for the same reason: the picker renders checkboxes, not glyphs.
 *
 * `as const satisfies` is what keeps the registry honest. `admin/index.tsx` derives its `Tab` union
 * from `AdminTabKey` and keys its panel switch on it, so adding an entry here is a compile error
 * until the shell renders it — and a tab the shell renders but this file does not declare cannot be
 * granted, which would make it permanently invisible to any scoped user.
 *
 * `group` mirrors the shell's own NavSection labels, so an admin configuring permissions sees the
 * same structure the user sees.
 */
import type { TabDescriptor } from '../../access/tabRegistry';

export const ADMIN_TABS = [
  { key: 'horizon', label: 'Horizon AI', group: 'AI & Knowledge' },
  { key: 'kb', label: 'Knowledge Base', group: 'AI & Knowledge' },
  { key: 'train', label: 'Train', group: 'AI & Knowledge' },
  { key: 'browser', label: 'Knowledge Browser', group: 'AI & Knowledge' },

  { key: 'access', label: 'User Management', group: 'Access' },
  { key: 'octane-telegram-users', label: 'Octane Telegram Users', group: 'Access' },
  { key: 'permission-sets', label: 'Permission Sets', group: 'Access' },
  /**
   * Declared as ONE destination, not two. `carriers-registered` and `carriers-invites` are children
   * of this row in the shell; an admin granting "Carrier User Management" means the screen, not one
   * of its two panes, so the registry deliberately stops at the parent.
   */
  { key: 'carriers', label: 'Carrier User Management', group: 'Access' },

  { key: 'kpi-data', label: 'KPI Collection & Data', group: 'CRM & Ops' },
  { key: 'data-loader', label: 'Data Loader', group: 'CRM & Ops' },
  { key: 'news', label: 'Client News', group: 'CRM & Ops' },
  { key: 'deals', label: 'Deals', group: 'CRM & Ops' },
  { key: 'escalation-routing', label: 'Escalation Routing', group: 'CRM & Ops' },
  { key: 'audit', label: 'Audit Log', group: 'CRM & Ops' },
  { key: 'jobs', label: 'Jobs', group: 'CRM & Ops' },

  { key: 'mytrion-db', label: 'Mytrion Database', group: 'Data' },
  { key: 'cmp', label: 'CMP Database', group: 'Data' },
  { key: 'dwh', label: 'Data Warehouse', group: 'Data' },
  { key: 'verification-db', label: 'Verification DB', group: 'Data' },

  { key: 'scope', label: 'Octane-Scope', group: 'Platform' },
] as const satisfies readonly TabDescriptor[];

export type AdminTabKey = (typeof ADMIN_TABS)[number]['key'];
