import type { CSSProperties } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';

const COPY: Record<string, { title: string; blurb: string; icon: IconName; hue: string }> = {
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
    blurb: 'Your Desk ticket queue is coming soon. Use Create and Data Center for leads and deals in the meantime.',
    icon: 'tickets',
    hue: 'var(--accent)',
  },
  callHub: {
    title: 'Call Hub',
    blurb: 'Click-to-dial history, callbacks, and call notes will land here next.',
    icon: 'callHub',
    hue: 'var(--ok)',
  },
};

/** Full-panel placeholder when a Coming soon nav item is selected. */
export function ComingSoonPanel({ sectionId }: { sectionId: string }) {
  const meta = COPY[sectionId] ?? {
    title: 'Coming soon',
    blurb: 'This workspace is still being built.',
    icon: 'clock' as IconName,
    hue: 'var(--warn)',
  };

  const wrapStyle = {
    ...s(
      'min-height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:48px 28px;border-radius:var(--radius-md);border:1px solid var(--border);background:radial-gradient(520px 280px at 50% 0%, color-mix(in srgb, var(--soon-hue) 16%, transparent), transparent 70%), var(--surface);width:100%',
    ),
    ['--soon-hue']: meta.hue,
  } as CSSProperties;

  return (
    <div className="ss-fu" style={wrapStyle}>
      <span
        style={s(
          `font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;border-radius:99px;color:#fff;background:linear-gradient(135deg, color-mix(in srgb, ${meta.hue} 92%, #fff), color-mix(in srgb, ${meta.hue} 55%, var(--accent)));box-shadow:0 4px 14px -2px color-mix(in srgb, ${meta.hue} 45%, transparent)`,
        )}
      >
        Coming soon
      </span>
      <div
        style={s(
          `width:64px;height:64px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${meta.hue} 16%, transparent);color:${meta.hue};border:1px solid color-mix(in srgb, ${meta.hue} 28%, transparent)`,
        )}
      >
        <Icon name={meta.icon} size={28} />
      </div>
      <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:26px;letter-spacing:.04em;text-transform:uppercase;text-align:center')}>
        {meta.title}
      </div>
      <p style={s('margin:0;max-width:420px;text-align:center;font-size:13.5px;line-height:1.55;color:var(--muted)')}>{meta.blurb}</p>
    </div>
  );
}
