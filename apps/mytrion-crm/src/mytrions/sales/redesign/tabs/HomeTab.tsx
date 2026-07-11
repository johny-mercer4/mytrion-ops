/**
 * Sales Mytrion redesign — Home tab. Ported verbatim from the reference prototype's `isHome`
 * slice + `renderVals()` view-model: hero briefing, workday progress, Updates & Announcements,
 * Today's Snapshot (skeleton → 3 groups), Your Activity (range toggle + daily average strip),
 * and the Quick Actions / Recent Inbox two-column footer. The JSX/design is unchanged; the data
 * source is now LIVE — loadSnapshot / loadAnnouncements / loadActivity / loadInbox via useLoad,
 * with the servercrm WebSocket reloading announcements + inbox in real time. Per-tab UI state
 * (activity range, inbox read map, clock tick) stays local; cross-tab affordances come from
 * useSales(). The Quick Actions cards render the static CALL_TO_ACTIONS catalog (action config).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { s, Svg } from '../dc';
import { ICO, iconBox, badge, deptStyle, timeParts, USER } from '../salesData';
import { CALL_TO_ACTIONS } from '../../data';
import {
  useLoad,
  loadSnapshot,
  loadAnnouncements,
  loadActivity,
  loadInbox,
  numFmt,
  money,
  type AnnVM,
  type InboxVM,
} from '../live';
import { useServerCrmSocket } from '../useServerCrmSocket';
import { useSales } from '../ctx';

type AnnItem = AnnVM;
type InboxItem = InboxVM;
type InboxType = InboxVM['type'];

interface SnapCell {
  icon: string;
  iconStyle: string;
  color: string;
  value: string;
  label: string;
  help: string;
}
interface SnapGroup {
  label: string;
  cells: SnapCell[];
}
interface ActTile {
  icon: string;
  iconStyle: string;
  value: string;
  label: string;
}
interface ActAvg {
  value: string;
  label: string;
}
interface ActRange {
  id: string;
  label: string;
  style: string;
  onClick: () => void;
}
interface CtaCode {
  text: string;
  style: string;
}
interface CtaCard {
  name: string;
  desc: string;
  top: boolean;
  codes: CtaCode[];
}
interface InboxPreviewVM {
  id: string;
  title: string;
  desc: string;
  time: string;
  icon: string;
  barColor: string;
  iconStyle: string;
  onClick: () => void;
}

const ICON_OF: Record<InboxType, string> = {
  critical: ICO.warn,
  task: ICO.check,
  warning: ICO.warn,
  reminder: ICO.clock,
  info: ICO.bell,
};
const COL_OF: Record<InboxType, string> = {
  critical: 'var(--danger)',
  task: 'var(--accent)',
  warning: 'var(--orange)',
  reminder: 'var(--warn)',
  info: 'var(--ok)',
};

/** Centered muted "Loading…" / red error text — the design's own light-weight states. */
function StateNote({ tone, children }: { tone: 'muted' | 'danger'; children: ReactNode }) {
  return (
    <div style={s(`width:100%;padding:22px;text-align:center;color:var(--${tone});font-size:12.5px;font-weight:600`)}>
      {children}
    </div>
  );
}

export function HomeTab() {
  const { openDetail, go } = useSales();

  // ---- live data ----
  const snap = useLoad(loadSnapshot, []);
  const dailyAct = useLoad(() => loadActivity('today'), []); // snapshot "Tasks Done" (today)
  const ann = useLoad(loadAnnouncements, []);
  const inbox = useLoad(loadInbox, []);

  // ---- local per-tab state ----
  const [activityRange, setActivityRange] = useState<string>('week');
  const [inboxRead, setInboxRead] = useState<Record<string, boolean>>({});
  const [, setTick] = useState<number>(0); // drives the 30s clock re-render

  const act = useLoad(
    () => loadActivity(activityRange as 'today' | 'week' | 'month'),
    [activityRange],
  );

  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(clock);
  }, []);

  // Real-time: announcements + inbox reload on the matching servercrm frame.
  useServerCrmSocket({
    subscribe: { type: 'subscribe' },
    onMessage: (msg) => {
      if (msg.type === 'sales_announcement') ann.reload();
      else if (msg.type === 'crm_inbox_notification') inbox.reload();
    },
  });

  const refreshSnapshot = (): void => {
    snap.reload();
    dailyAct.reload();
  };

  const openInbox = (i: InboxItem): void => {
    setInboxRead((r) => ({ ...r, [i.id]: true }));
    openDetail({
      title: i.title,
      body: i.desc,
      icon: ICON_OF[i.type],
      iconStyle: iconBox(COL_OF[i.type], 44),
      metaLabel: 'Received:',
      meta: i.time,
      badges: [badge(i.prio.toUpperCase(), COL_OF[i.type]), badge(i.tag, 'var(--muted)')],
    });
  };

  const openAnn = (a: AnnItem): void => {
    openDetail({
      title: a.title,
      body: a.body,
      icon: a.icon,
      iconStyle: iconBox(a.color, 44),
      metaLabel: 'Posted:',
      meta: a.time,
      badges: [
        badge(a.type.toUpperCase(), a.color),
        badge(a.prio, a.prio === 'High' ? 'var(--orange)' : 'var(--muted)'),
      ],
    });
  };

  // ---- derived view-model (mirrors renderVals) ----
  const T = timeParts();
  const timeOfDay = T.tod;
  const dateLabel = T.dateLabel;
  const timeFmt = T.timeFmt;
  const workdayPct = T.pct;
  const workdayFill = `${T.pct}%`;
  const workdayKnob = `${Math.min(T.pct, 96)}%`;
  const annData = ann.data ?? [];
  const inboxData = inbox.data ?? [];
  const inboxUnread = inboxData.filter((i) => !inboxRead[i.id]).length;
  const snapLoading = snap.loading;
  const snapReady = !snap.loading && !snap.error && !!snap.data;
  const snapSpinCss = snap.loading ? 'animation:ss-spin .9s linear infinite' : '';
  const skel8 = [1, 2, 3, 4, 5, 6, 7, 8];

  const green = 'var(--ok)';
  const red = 'var(--danger)';
  const amber = 'var(--warn)';
  const orange = 'var(--orange)';
  const accent = 'var(--accent)';
  const violet = 'var(--violet)';
  const mk = (icon: keyof typeof ICO, col: string, value: string | number, label: string, help: string): SnapCell => ({
    icon: ICO[icon],
    iconStyle: iconBox(col, 36),
    color: col,
    value: String(value),
    label,
    help,
  });
  const sf = snap.data;
  const snapshotGroups: SnapGroup[] = [
    {
      label: 'Your Clients',
      cells: [
        mk('users', accent, numFmt(sf?.active_clients ?? 0), 'Active Customers', 'Fueled in the last 10 days'),
        mk('lead', red, numFmt(sf?.inactive_clients ?? 0), 'Need Attention', 'Quiet 10+ days — worth a call'),
        mk('clock', orange, numFmt(sf?.stuck_deals_count ?? 0), 'Stuck Applications', 'Sitting 15+ days'),
        mk('money', red, money(-(sf?.total_debt_amount ?? 0)), 'Money Owed', `${numFmt(sf?.total_debtors ?? 0)} debtors · ${numFmt(sf?.total_hard_debtors ?? 0)} hard`),
      ],
    },
    {
      label: 'This Week',
      cells: [
        mk('card', green, numFmt(sf?.swipes_this_week ?? 0), 'Fuel Transactions', 'Mon–today this week'),
        mk('fuel', violet, numFmt(sf?.gallons_this_week ?? 0), 'Gallons Pumped', 'Gallons this cycle'),
        mk('card', accent, numFmt(sf?.new_cards_this_week ?? 0), 'New Cards', 'Activated for new units'),
        mk('trend', green, sf?.volume_trend ?? '—', 'Volume Trend', 'Week over week'),
      ],
    },
    {
      label: 'Today',
      cells: [
        mk('card', accent, numFmt(sf?.swipes_today ?? 0), 'Fuel Transactions', 'So far today'),
        mk('fuel', violet, numFmt(sf?.gallons_today ?? 0), 'Gallons Pumped', 'So far today'),
        mk('card', green, numFmt(sf?.new_cards_today ?? 0), 'New Cards', 'Activated today'),
        mk('check', green, numFmt(dailyAct.data?.tasks ?? 0), 'Tasks Done', 'Cleared from your queue'),
      ],
    },
  ];

  const at = (icon: keyof typeof ICO, col: string, value: string | number, label: string): ActTile => ({
    icon: ICO[icon],
    iconStyle: `${iconBox(col, 32)};margin:0 auto`,
    value: String(value),
    label,
  });
  const ac = act.data;
  const activityTiles: ActTile[] = [
    at('calls', accent, ac?.calls ?? 0, 'Calls'),
    at('notes', violet, ac?.notes ?? 0, 'Notes'),
    at('lead', green, ac?.leads ?? 0, 'Leads +'),
    at('inbox', accent, ac?.received ?? 0, 'Received'),
    at('star', amber, ac?.interested ?? 0, 'Interested'),
    at('doc', violet, ac?.apps ?? 0, 'Apps'),
    at('check', green, ac?.tasks ?? 0, 'Tasks'),
  ];
  const rangeDays = activityRange === 'today' ? 1 : activityRange === 'month' ? 30 : 7;
  const av = (v: number, l: string): ActAvg => ({
    value: (v / rangeDays).toFixed(1).replace('.0', ''),
    label: l,
  });
  const activityAverages: ActAvg[] = [
    av(ac?.calls ?? 0, 'calls'),
    av(ac?.notes ?? 0, 'notes'),
    av(ac?.leads ?? 0, 'leads'),
    av(ac?.apps ?? 0, 'apps'),
  ];
  const rangeDefs: [string, string][] = [
    ['today', 'Today'],
    ['week', 'Week'],
    ['month', 'Month'],
  ];
  const activityRanges: ActRange[] = rangeDefs.map(([id, label]) => {
    const on = activityRange === id;
    return {
      id,
      label,
      style: `padding:5px 13px;border-radius:7px;border:none;cursor:pointer;font-size:11.5px;font-weight:700;background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--muted)'};transition:all .14s`,
      onClick: () => setActivityRange(id),
    };
  });

  const ctaCards: CtaCard[] = CALL_TO_ACTIONS.filter((a) => a.top).map((a) => ({
    name: a.name,
    desc: a.desc,
    top: a.top,
    codes: a.codes.map((c) => ({ text: c, style: deptStyle(c) })),
  }));

  const inboxPreview: InboxPreviewVM[] = inboxData.slice(0, 3).map((i) => ({
    id: i.id,
    title: i.title,
    desc: i.desc,
    time: i.time,
    icon: ICON_OF[i.type],
    barColor: COL_OF[i.type],
    iconStyle: iconBox(COL_OF[i.type], 34),
    onClick: () => openInbox(i),
  }));

  const goAuto = (): void => go('auto');
  const goInbox = (): void => go('inbox');

  return (
    <div className="ss-fu">
      {/* hero */}
      <div style={s('display:grid;grid-template-columns:1.35fr 1fr;gap:18px;margin-bottom:18px')}>
        <div style={s('position:relative;overflow:hidden;border-radius:18px;padding:26px 28px;background:linear-gradient(120deg, rgba(var(--accent-rgb),.14), rgba(var(--violet-rgb),.10)), var(--surface);border:1px solid var(--border)')}>
          <div style={s('position:absolute;right:-40px;top:-40px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.22),transparent 70%);pointer-events:none')}></div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)')}>{dateLabel}</div>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:30px;letter-spacing:.01em;margin-top:8px;line-height:1.1')}>Good {timeOfDay}, <span style={s('background:linear-gradient(120deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent')}>{USER.first}</span></div>
          <div style={s('font-size:13.5px;color:var(--text2);margin-top:8px;max-width:440px')}>Here's your briefing for today. You're ahead of the queue — {inboxUnread} items need a look.</div>
          <div style={s('display:flex;gap:10px;margin-top:18px')}>
            <button onClick={goAuto} className="ss-btn-p" style={s('height:38px;padding:0 16px;border-radius:10px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:7px')}><Svg d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" size={15} strokeWidth={2.2} />Run an action</button>
            <button className="ss-ico-btn" style={s('height:38px;padding:0 15px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:7px')}><Svg d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" size={15} />Ask Mytrion AI</button>
          </div>
        </div>
        <div style={s('border-radius:18px;padding:22px 24px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center')}>
          <div style={s('display:flex;justify-content:space-between;align-items:baseline')}>
            <span style={s('font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)')}>Workday Progress</span>
            <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text2)")}>{timeFmt}</span>
          </div>
          <div style={s('position:relative;height:9px;border-radius:99px;background:var(--raised);margin:18px 0 10px')}>
            <div style={s(`position:absolute;inset:0;width:${workdayFill};border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))`)}></div>
            <div style={s(`position:absolute;top:50%;left:${workdayKnob};transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:var(--surface);border:2px solid var(--accent);box-shadow:0 2px 8px rgba(var(--accent-rgb),.5)`)}></div>
          </div>
          <div style={s('display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);font-weight:600')}>
            <span>9:00 AM</span><span style={s("color:var(--accent);font-family:'JetBrains Mono',monospace")}>{workdayPct}% done</span><span>6:00 PM</span>
          </div>
        </div>
      </div>

      {/* announcements */}
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px')}>
        <div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><Svg d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.952 9.168-5v14c-1.543-3.048-5.068-5-9.168-5H7a3.988 3.988 0 01-1.564-.317z" size={17} /></span>Updates &amp; Announcements</div>
        <span style={s('font-size:10.5px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:rgba(var(--accent-rgb),.14);color:var(--accent)')}>{annData.length} NEW</span>
      </div>
      <div style={s('display:flex;gap:12px;overflow-x:auto;padding-bottom:6px')}>
        {ann.loading && <StateNote tone="muted">Loading…</StateNote>}
        {ann.error && <StateNote tone="danger">{ann.error}</StateNote>}
        {!ann.loading && !ann.error && annData.length === 0 && <StateNote tone="muted">No announcements</StateNote>}
        {annData.map((a) => (
          <div key={a.title} onClick={() => openAnn(a)} className="ss-card-h" style={s('flex:0 0 300px;display:flex;gap:12px;padding:15px;border-radius:14px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
            <div style={s(iconBox(a.color, 40))}><Svg d={a.icon} size={18} /></div>
            <div style={s('min-width:0')}>
              <div style={s('font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical')}>{a.title}</div>
              <div style={s('font-size:11px;color:var(--muted);margin-top:4px')}>{a.time}</div>
            </div>
          </div>
        ))}
      </div>

      {/* snapshot */}
      <div style={s('margin-top:24px;border-radius:18px;background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}>Today's Snapshot</div>
          <div style={s('display:flex;align-items:center;gap:10px')}>
            <span style={s('font-size:11px;color:var(--muted)')}>Updated {timeFmt}</span>
            <button onClick={refreshSnapshot} aria-label="Refresh" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><Svg d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={15} style={s(snapSpinCss)} /></button>
          </div>
        </div>
        <div style={s('padding:18px 20px')}>
          {snapLoading && (
            <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px')}>
              {skel8.map((sk) => (
                <div key={sk} style={s('padding:16px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <div className="ss-skel" style={s('width:34px;height:34px;border-radius:9px')}></div>
                  <div className="ss-skel" style={s('width:54px;height:20px;margin-top:12px')}></div>
                  <div className="ss-skel" style={s('width:80%;height:11px;margin-top:8px')}></div>
                </div>
              ))}
            </div>
          )}
          {snap.error && <StateNote tone="danger">{snap.error}</StateNote>}
          {snapReady && (
            <div>
              {snapshotGroups.map((g) => (
                <div key={g.label} style={s('margin-bottom:16px')}>
                  <div style={s('font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px')}>{g.label}</div>
                  <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px')}>
                    {g.cells.map((c) => (
                      <div key={c.label} className="ss-card-h" style={s('padding:15px;border-radius:13px;background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);position:relative')}>
                        <div style={s(c.iconStyle)}><Svg d={c.icon} size={18} /></div>
                        <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:23px;margin-top:12px;color:${c.color}`)}>{c.value}</div>
                        <div style={s('font-size:12px;font-weight:600;color:var(--text);margin-top:2px')}>{c.label}</div>
                        <div style={s('font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.35')}>{c.help}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* activity */}
      <div style={s('margin-top:18px;border-radius:18px;background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}>Your Activity</div>
          <div style={s('display:flex;gap:3px;padding:3px;border-radius:9px;background:var(--alt);border:1px solid var(--border2)')}>
            {activityRanges.map((r) => (
              <button key={r.id} onClick={r.onClick} style={s(r.style)}>{r.label}</button>
            ))}
          </div>
        </div>
        <div style={s('padding:18px 20px')}>
          {act.loading && <StateNote tone="muted">Loading…</StateNote>}
          {!act.loading && act.error && <StateNote tone="danger">{act.error}</StateNote>}
          {!act.loading && !act.error && (
            <>
              <div style={s('display:grid;grid-template-columns:repeat(7,1fr);gap:11px')}>
                {activityTiles.map((t) => (
                  <div key={t.label} style={s('padding:13px;border-radius:12px;background:var(--alt);border:1px solid var(--border2);text-align:center')}>
                    <div style={s(t.iconStyle)}><Svg d={t.icon} size={16} /></div>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:19px;margin-top:9px")}>{t.value}</div>
                    <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px')}>{t.label}</div>
                  </div>
                ))}
              </div>
              <div style={s('margin-top:14px;padding:13px 16px;border-radius:12px;background:linear-gradient(120deg,rgba(var(--accent-rgb),.08),transparent);border:1px solid var(--border2);display:flex;align-items:center;gap:16px;flex-wrap:wrap')}>
                <span style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)')}>Daily average</span>
                {activityAverages.map((a) => (
                  <span key={a.label} style={s('font-size:12px;color:var(--text2)')}><strong style={s("font-family:'JetBrains Mono',monospace;color:var(--text)")}>{a.value}</strong> {a.label}/day</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* CTA + inbox preview */}
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px')}>
        <div>
          <div style={s('display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px')}><div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><Svg d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" size={17} /></span>Quick Actions</div><button onClick={goAuto} className="ss-tab-x" style={s('background:none;border:none;color:var(--accent);font-weight:700;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:7px')}>All guides →</button></div>
          <div style={s('display:flex;flex-direction:column;gap:12px')}>
            {ctaCards.map((c) => (
              <div key={c.name} onClick={goAuto} className="ss-card-h" style={s('padding:16px;border-radius:14px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                <div style={s('display:flex;align-items:center;gap:6px;margin-bottom:9px')}>
                  {c.codes.map((code) => (
                    <span key={code.text} style={s(code.style)}>{code.text}</span>
                  ))}
                  <div style={s('flex:1')}></div>
                  {c.top && (<span style={s('font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(248,113,113,.16);color:var(--danger)')}>TOP</span>)}
                </div>
                <div style={s('font-size:14px;font-weight:700')}>{c.name}</div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:5px;line-height:1.45')}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={s('display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px')}><div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg></span>Recent Inbox</div><button onClick={goInbox} className="ss-tab-x" style={s('background:none;border:none;color:var(--accent);font-weight:700;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:7px')}>View all →</button></div>
          <div style={s('display:flex;flex-direction:column;gap:10px')}>
            {inbox.loading && <StateNote tone="muted">Loading…</StateNote>}
            {inbox.error && <StateNote tone="danger">{inbox.error}</StateNote>}
            {!inbox.loading && !inbox.error && inboxData.length === 0 && <StateNote tone="muted">No messages</StateNote>}
            {inboxPreview.map((i) => (
              <div key={i.id} onClick={i.onClick} className="ss-card-h" style={s('display:flex;gap:12px;padding:13px 14px;border-radius:13px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm);position:relative;overflow:hidden')}>
                <div style={s(`position:absolute;left:0;top:0;bottom:0;width:3px;background:${i.barColor}`)}></div>
                <div style={s(i.iconStyle)}><Svg d={i.icon} size={15} /></div>
                <div style={s('min-width:0;flex:1')}>
                  <div style={s('display:flex;justify-content:space-between;gap:8px')}><span style={s('font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{i.title}</span><span style={s('font-size:10.5px;color:var(--muted);white-space:nowrap')}>{i.time}</span></div>
                  <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{i.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
