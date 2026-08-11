/**
 * Customer Service Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why.
 *
 * Keys are the existing `CsSectionId` values (csNav.ts), which the Shell and the Home quick-actions
 * already share. Several are `soon` in the shell today; they stay declared and grantable, because
 * `soon` is a build-status flag and a permission is a grant — the two compose.
 */
import type { TabDescriptor } from '../../access/tabRegistry';
import type { CsSectionId } from './csNav';

export const CS_TABS = [
  { key: 'home', label: 'Home' },

  { key: 'applications', label: 'Applications', group: 'Onboarding' },
  { key: 'citi-folder', label: 'CITI Folder', group: 'Onboarding' },
  { key: 'citi-fuel', label: 'CITI Fuel', group: 'Onboarding' },

  { key: 'retention-cases', label: 'Retention Cases', group: 'Retention' },
  { key: 'open-pool', label: 'Open Pool', group: 'Retention' },

  { key: 'maintenance', label: 'Maintenance', group: 'Service' },
  { key: 'service-center', label: 'Service Center', group: 'Service' },
  { key: 'inbox', label: 'Inbox', group: 'Service' },
  { key: 'tickets', label: 'Tickets', group: 'Service' },

  { key: 'data-center', label: 'Data Center', group: 'Measure' },
  { key: 'analytics', label: 'Analytics', group: 'Measure' },
] as const satisfies readonly TabDescriptor[];

export type CsTabKey = (typeof CS_TABS)[number]['key'];

/**
 * Compile-time parity with `CsSectionId`.
 *
 * CS keys its shell, its Home quick actions and its URL state on CsSectionId, so that union stays
 * the source of truth for the module. This assertion makes the registry a mirror of it rather than a
 * second list to maintain: drop a tab from either side and this stops compiling.
 */
type _KeysAreSectionIds = CsTabKey extends CsSectionId ? true : never;
type _SectionIdsAreKeys = CsSectionId extends CsTabKey ? true : never;
const _parity: [_KeysAreSectionIds, _SectionIdsAreKeys] = [true, true];
void _parity;
