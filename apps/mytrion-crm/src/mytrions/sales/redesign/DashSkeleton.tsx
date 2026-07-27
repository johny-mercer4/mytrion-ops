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

export function DebtorsSkeleton() {
  return (
    <div style={s('display:flex;flex-direction:column;gap:14px')}>
      <div style={s('display:flex;justify-content:space-between;gap:12px')}>
        <div className="ss-skel" style={s('height:42px;width:42%')} />
        <div className="ss-skel" style={s('height:34px;width:96px')} />
      </div>
      <div className="ss-skel" style={s('height:38px;width:100%')} />
      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:10px')}>
        <div className="ss-skel" style={s('height:72px')} />
        <div className="ss-skel" style={s('height:72px')} />
        <div className="ss-skel" style={s('height:72px')} />
        <div className="ss-skel" style={s('height:72px')} />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="ss-skel" style={s('height:108px')} />
      ))}
    </div>
  );
}
