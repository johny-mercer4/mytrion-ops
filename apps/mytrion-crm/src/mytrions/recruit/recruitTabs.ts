/** Recruit Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const RECRUIT_TABS = [
  { key: 'home', label: 'Home' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'candidates', label: 'Candidates' },
  // Admin-only in the shell (`admin ? [settings] : []`). Declared anyway — the registry answers
  // "what exists", the shell answers "may you see it", and a tab absent from the registry could
  // never be granted at all.
  { key: 'settings', label: 'Settings' },
] as const satisfies readonly TabDescriptor[];

export type RecruitTabKey = (typeof RECRUIT_TABS)[number]['key'];
