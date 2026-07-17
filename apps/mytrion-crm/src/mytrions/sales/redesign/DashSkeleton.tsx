/** Shared skeleton / empty chrome for dashboard panels. */
import { s } from './dc';

export function DashSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={s('display:flex;flex-direction:column;gap:14px')}>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
        <div className="ss-skel" style={s('height:88px')} />
        <div className="ss-skel" style={s('height:88px')} />
      </div>
      <div style={s('display:grid;grid-template-columns:1.2fr 1fr .9fr;gap:12px')}>
        <div className="ss-skel" style={s('height:180px')} />
        <div className="ss-skel" style={s('height:180px')} />
        <div className="ss-skel" style={s('height:180px')} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ss-skel" style={s('height:120px')} />
      ))}
    </div>
  );
}

export function CompanySkeleton() {
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div className="ss-skel" style={s('height:48px;width:55%')} />
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')}>
        <div className="ss-skel" style={s('height:140px')} />
        <div className="ss-skel" style={s('height:140px')} />
        <div className="ss-skel" style={s('height:140px')} />
      </div>
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')}>
        <div className="ss-skel" style={s('height:140px')} />
        <div className="ss-skel" style={s('height:140px')} />
        <div className="ss-skel" style={s('height:140px')} />
      </div>
    </div>
  );
}

export function ComingSoonPanel({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div
      style={s(
        'padding:56px 28px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);text-align:center;box-shadow:var(--shadow-sm)',
      )}
    >
      <div
        style={s(
          'width:56px;height:56px;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)',
        )}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <div style={s('font-size:16px;font-weight:800')}>{title}</div>
      <div style={s('font-size:13px;color:var(--muted);margin-top:6px;max-width:360px;margin-left:auto;margin-right:auto;line-height:1.45')}>
        {blurb}
      </div>
      <span
        style={s(
          'display:inline-block;margin-top:16px;padding:5px 12px;border-radius:99px;background:color-mix(in srgb,var(--orange) 14%,transparent);color:var(--orange);font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase',
        )}
      >
        Coming soon
      </span>
    </div>
  );
}
