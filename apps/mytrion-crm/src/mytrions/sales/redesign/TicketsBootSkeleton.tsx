/** Initial Tickets-tab loader — list shimmer + one chat spinner (no stacked loaders). */

export function TicketsBootSkeleton() {
  return (
    <div className="ss-tk-layout ss-tk-boot" aria-busy="true" aria-label="Loading tickets">
      <div className="ss-tk-list">
        <div className="ss-tk-list-hd">
          <div className="ss-tk-boot-bar ss-skel" style={{ width: 110, height: 14 }} />
          <div className="ss-tk-boot-bar ss-skel" style={{ width: '100%', height: 34 }} />
          <div className="ss-tk-boot-bar ss-skel" style={{ width: '100%', height: 34 }} />
        </div>
        <div className="ss-tk-list-body">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ss-tk-boot-card" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="ss-skel" style={{ height: 13, width: `${78 - i * 5}%` }} />
              <div className="ss-skel" style={{ height: 10, width: '46%', marginTop: 8 }} />
              <div className="ss-skel" style={{ height: 18, width: 96, marginTop: 10, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="ss-tk-chat">
        <div className="ss-tk-boot-center ss-tk-boot-center--solo">
          <span className="ss-tk-boot-ring" aria-hidden="true" />
          <span className="ss-tk-boot-title">Loading your tickets</span>
          <span className="ss-tk-boot-sub">Pulling your Desk queue…</span>
        </div>
      </div>
    </div>
  );
}
