import type { CSSProperties } from 'react';
import { Icon } from '../icons';
import { soonTabMeta } from '../soonTabs';

/**
 * Full-panel placeholder when a Coming soon nav item is selected.
 * Layout is shared CSS (`.ss-soon-panel`) — only title / blurb / icon / hue vary per tab.
 */
export function ComingSoonPanel({ sectionId }: { sectionId: string }) {
  const meta = soonTabMeta(sectionId);

  return (
    <div
      className="ss-fu ss-soon-panel"
      role="status"
      aria-label={`${meta.title} — coming soon`}
      style={{ ['--soon-hue' as string]: meta.hue } as CSSProperties}
    >
      <span className="ss-soon-panel__badge">Coming soon</span>
      <div className="ss-soon-panel__icon" aria-hidden="true">
        <Icon name={meta.icon} size={28} />
      </div>
      <h2 className="ss-soon-panel__title">{meta.title}</h2>
      <p className="ss-soon-panel__blurb">{meta.blurb}</p>
    </div>
  );
}
