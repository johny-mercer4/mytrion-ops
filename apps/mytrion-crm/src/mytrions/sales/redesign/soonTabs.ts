/**
 * Single source of truth for parked Sales nav tabs — sidebar SOON chips and the
 * full-panel ComingSoonPanel share this catalog so hues/copy stay aligned.
 */
import type { IconName } from './icons';

export interface SoonTabMeta {
  title: string;
  blurb: string;
  icon: IconName;
  /** Accent for SOON chip + panel badge / icon well. */
  hue: string;
}

export const SOON_TABS: Record<string, SoonTabMeta> = {
  retention: {
    title: 'Retention',
    blurb: 'Cases and Open Pool will live here — assign, escalate, and work the retention queue in one place.',
    icon: 'retention',
    hue: 'var(--orange)',
  },
  verification: {
    title: 'Verification Pipeline',
    blurb: 'Document checks, Plaid links, and limit reviews are on the way for this desk.',
    icon: 'verification',
    hue: 'var(--violet)',
  },
  tickets: {
    title: 'Tickets',
    blurb:
      'Raise tickets and escalations from Create — they go straight into Zoho Desk, where Customer '
      + 'Service, Billing and Verification work them. Reading and replying to them in here is next.',
    icon: 'tickets',
    hue: 'var(--warn)',
  },
  callHub: {
    title: 'Call Hub',
    blurb: 'Your Mytrion and Zoho call history lives here. Callbacks queue and richer notes are next.',
    icon: 'callHub',
    hue: 'var(--ok)',
  },
};

const FALLBACK: SoonTabMeta = {
  title: 'Coming soon',
  blurb: 'This workspace is still being built.',
  icon: 'clock',
  hue: 'var(--warn)',
};

export function soonTabMeta(sectionId: string): SoonTabMeta {
  return SOON_TABS[sectionId] ?? FALLBACK;
}

export function soonHue(sectionId: string): string {
  return soonTabMeta(sectionId).hue;
}
