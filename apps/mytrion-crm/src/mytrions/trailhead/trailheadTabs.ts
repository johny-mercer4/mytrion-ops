/** Trailhead Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const TRAILHEAD_TABS = [
  { key: 'main', label: 'Overview' },
  { key: 'courses', label: 'Courses' },
  { key: 'instructor', label: 'Instructor' },
  { key: 'exams', label: 'Exams' },
] as const satisfies readonly TabDescriptor[];

export type TrailheadTabKey = (typeof TRAILHEAD_TABS)[number]['key'];
