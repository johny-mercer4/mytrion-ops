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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getSession } from '@/api/session';
import { getAppStats } from '@/api/dataCenter';
import { getImpersonation } from '@/api/impersonation';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { s, clickable } from '../dc';
import { Icon, type IconName } from '../icons';
import { ICO, iconBox, badge, deptStyle, timeParts } from '../salesData';
import { useSessionUser } from '../sessionUser';
import { markInboxRead } from '../inboxRead';
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
import { subscribeInboxLive } from '../inboxLiveBus';
import { useServerCrmSocket } from '../useServerCrmSocket';
import { useSales } from '../ctx';
import {
  DAILY_APPS_GOAL,
  todayApps,
  topDay,
  weekTotal,
  currentStreak,
  isNewBest,
  claimCelebration,
} from '../streakStore';
import { ActivityTilesSkeleton, HomeBelowFoldSkeleton } from './HomeSkeleton';

type AnnItem = AnnVM;
type InboxItem = InboxVM;
type InboxType = InboxVM['type'];

interface SnapCell {
  icon: IconName;
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
  icon: IconName;
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
  icon: IconName;
  barColor: string;
  iconStyle: string;
  onClick: () => void;
}

const ICON_OF: Record<InboxType, IconName> = {
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

/** Centered muted / red status text — used for errors and true empty states only. */
function StateNote({ tone, children }: { tone: 'muted' | 'danger'; children: ReactNode }) {
  return (
    <div style={s(`width:100%;padding:22px;text-align:center;color:var(--${tone});font-size:13px;font-weight:600`)}>
      {children}
    </div>
  );
}

/** One mini stat in the habit-loop strip (streak / personal best / momentum). */
function StreakStat({
  emoji,
  icon,
  value,
  label,
  tone,
  loading,
}: {
  emoji?: string;
  icon?: IconName;
  value: number | string;
  label: string;
  tone: string;
  loading?: boolean;
}) {
  return (
    <div
      className="ss-card-h"
      aria-busy={loading || undefined}
      style={s(
        'display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)',
      )}
    >
      <div
        style={s(
          `width:38px;height:38px;flex-shrink:0;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:19px;background:color-mix(in srgb,${tone} 15%,transparent);color:${tone}`,
        )}
      >
        {emoji ?? (icon ? <Icon name={icon} size={18} /> : null)}
      </div>
      <div style={s('min-width:0;flex:1')}>
        {loading ? (
          <div className="ss-skel" style={s('width:42px;height:22px;border-radius:6px')} />
        ) : (
          <div
            style={s(
              "font-family:'JetBrains Mono',monospace;font-weight:500;font-size:22px;line-height:1;color:var(--text)",
            )}
          >
            {value}
          </div>
        )}
        <div style={s('font-size:11px;color:var(--muted);margin-top:5px')}>{label}</div>
      </div>
    </div>
  );
}

export function HomeTab() {
  const { openDetail, go, pushToast } = useSales();
  const user = useSessionUser();
  const { actingAs } = useImpersonation();
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');

  // ---- live data ----
  const snap = useLoad(loadSnapshot, []);
  const dailyAct = useLoad(() => loadActivity('today'), []); // snapshot "Tasks Done" (today)
  const ann = useLoad(loadAnnouncements, []);
  const inbox = useLoad(loadInbox, [currentUserId]);
  // Real per-day applications (Zoho COQL: Deals.Application_Date = application filled, owner-scoped).
  // Pass zoho_user_id like Deals/Desk — bare getAppStats() can resolve to no owner and show silent zeros.
  const appStats = useLoad(() => {
    const actAsId = getImpersonation()?.zohoUserId?.trim();
    const selfId = getSession()?.worker.zohoUserId?.trim();
    return getAppStats(actAsId || selfId || undefined);
  }, [currentUserId]);

  // ---- local per-tab state ----
  const [activityRange, setActivityRange] = useState<string>('week');
  const [, setTick] = useState<number>(0); // drives the 30s clock re-render
  /** One-shot: keep a single below-fold skeleton until the first home loads settle. */
  const [homeReady, setHomeReady] = useState(false);
  /** Transient goal/personal-best celebration overlay (auto-dismissed). */
  const [celebration, setCelebration] = useState<{ emoji: string; title: string; msg: string } | null>(null);
  /** Set while a user-initiated snapshot refresh is in flight, so we can confirm it on completion. */
  const snapRefreshPending = useRef(false);

  const act = useLoad(
    (fresh) => loadActivity(activityRange as 'today' | 'week' | 'month', fresh),
    [activityRange],
  );
  // When the visible range IS today, prefer the (identical) range load so the cell and the
  // tiles agree — but fall back to dailyAct while it's still loading, so switching ranges
  // never flashes the Tasks-Done cell to 0. Same touchpoint either way; loadActivity's
  // in-flight dedupe collapses concurrent equal calls into one POST.
  const dailyTasks = (activityRange === 'today' ? act.data?.tasks : undefined) ?? dailyAct.data?.tasks ?? 0;

  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (homeReady) return;
    const pending =
      (snap.loading && snap.data === null && !snap.error) ||
      (ann.loading && ann.data === null && !ann.error) ||
      (act.loading && act.data === null && !act.error) ||
      (inbox.loading && inbox.data === null && !inbox.error);
    if (!pending) setHomeReady(true);
  }, [
    homeReady,
    snap.loading,
    snap.data,
    snap.error,
    ann.loading,
    ann.data,
    ann.error,
    act.loading,
    act.data,
    act.error,
    inbox.loading,
    inbox.data,
    inbox.error,
  ]);

  // Real-time: announcements on this tab's socket; inbox toast/reload are shell-level
  // (`useSidebarBadges` → toast on every tab + `inboxLiveBus` for the Home preview list).
  useServerCrmSocket({
    enabled: !!currentUserId,
    watchKey: currentUserId,
    subscribe: { type: 'subscribe', userId: currentUserId },
    onMessage: (msg) => {
      if (msg.type === 'sales_announcement') ann.reload();
    },
  });
  useEffect(() => subscribeInboxLive(() => inbox.reload()), [inbox.reload]);

  const refreshSnapshot = (): void => {
    snapRefreshPending.current = true;
    snap.reload();
    // Reload the daily cell; on the Today range also reload the tiles — the in-flight dedupe
    // collapses the two identical activity.agent calls into one POST, and both stay in sync.
    dailyAct.reload();
    if (activityRange === 'today') act.reload();
    appStats.reload();
  };

  const openInbox = (i: InboxItem): void => {
    markInboxRead(i.id);
    openDetail({
      title: i.title,
      body: i.desc,
      icon: ICON_OF[i.type],
      iconStyle: iconBox(COL_OF[i.type], 44),
      metaLabel: 'Received:',
      meta: i.time,
      badges: [badge(i.prio.toUpperCase(), COL_OF[i.type]), ...(i.tag ? [badge(i.tag, 'var(--muted)')] : [])],
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
  const workdayFill = `${T.pct}%`;
  const workdayKnob = `${T.knobPct}%`;
  const workday = T.workday;
  const annData = ann.data ?? [];
  const inboxData = inbox.data ?? [];
  const snapSpinCss = snap.loading ? 'animation:ss-spin .9s linear infinite' : '';

  // ---- daily-goal habit loop — REAL data (Zoho COQL: Deals.Application_Date per day, owner-scoped) ----
  const appsLoading = appStats.loading && !appStats.data;
  const appDays = appStats.data?.days ?? {};
  const appsDone = todayApps(appDays);
  const goalMet = appsDone >= DAILY_APPS_GOAL;
  const appsGoalPct = DAILY_APPS_GOAL > 0 ? Math.min(100, Math.round((appsDone / DAILY_APPS_GOAL) * 100)) : 0;
  const appsToGo = Math.max(0, DAILY_APPS_GOAL - appsDone);
  const streakDays = currentStreak(appDays, DAILY_APPS_GOAL);
  const bestDay = topDay(appDays);
  const weekApps = weekTotal(appDays);

  // Celebrate a fresh personal best / goal hit at most once per day (claimCelebration guards re-fires
  // across reloads + tab switches). Runs once the real app-stats settle.
  useEffect(() => {
    if (!appStats.data) return;
    if (isNewBest(appDays) && claimCelebration('best')) {
      const msg = `${appsDone} apps today — a new personal best.`;
      setCelebration({ emoji: '🏆', title: 'New personal best!', msg });
      pushToast('New personal best!', msg);
    } else if (goalMet && claimCelebration('goal')) {
      const msg = `You hit ${DAILY_APPS_GOAL} apps today. Streak alive 🔥`;
      setCelebration({ emoji: '🎉', title: 'Daily goal hit!', msg });
      pushToast('Daily goal hit!', msg);
    }
  }, [appStats.data]);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 3800);
    return () => clearTimeout(t);
  }, [celebration]);

  // Confirm a user-initiated snapshot refresh once the fresh data lands. reload() is fire-and-forget
  // and useLoad doesn't flip `loading` on reload, so watch the data reference changing instead.
  useEffect(() => {
    if (snapRefreshPending.current && snap.data) {
      snapRefreshPending.current = false;
      pushToast('Snapshot refreshed', `Updated ${timeFmt} ET`);
    }
  }, [snap.data]);

  const green = 'var(--ok)';
  const red = 'var(--danger)';
  const amber = 'var(--warn)';
  const accent = 'var(--accent)';
  const violet = 'var(--violet)';
  const cyan = 'var(--cyan)';
  const neutral = 'var(--text)';
  const mk = (icon: keyof typeof ICO, col: string, value: string | number, label: string, help: string): SnapCell => ({
    icon: ICO[icon],
    iconStyle: iconBox(col, 36),
    color: col,
    value: String(value),
    label,
    help,
  });
  const sf = snap.data;
  const debtAmt = sf?.total_debt_amount ?? 0;
  const moneyOwed = debtAmt > 0 ? money(-debtAmt) : '$0';
  // Volume trend keeps a status hue but pairs it with an arrow glyph so direction survives grayscale
  // and red/green colorblindness (audit: never rely on hue alone).
  const volDir = sf?.volume_trend_dir;
  const volumeTrendRaw = sf?.volume_trend && sf.volume_trend !== '—' ? sf.volume_trend : '0%';
  const volumeTrend = `${volDir === 'up' ? '▲ ' : volDir === 'down' ? '▼ ' : ''}${volumeTrendRaw}`;
  const volumeColor = volDir === 'down' ? red : volDir === 'up' ? green : neutral;
  // Curated coloring: each metric owns ONE consistent hue across groups (fixes the old "same metric,
  // two colors" rainbow) — counts get a calm brand hue, status cells keep red/amber and are always
  // backed by a glyph or sign (warn/clock icon, -$, ▲/▼) so meaning survives grayscale/colorblindness.
  const snapshotGroups: SnapGroup[] = [
    {
      label: 'Your Clients',
      cells: [
        mk('users', accent, numFmt(sf?.active_clients ?? 0), 'Active Customers', 'Fueled in the last 10 days'),
        mk('warn', (sf?.inactive_clients ?? 0) > 0 ? red : neutral, numFmt(sf?.inactive_clients ?? 0), 'Need Attention', 'Quiet 10+ days — worth a call'),
        mk('clock', (sf?.stuck_deals_count ?? 0) > 0 ? amber : neutral, numFmt(sf?.stuck_deals_count ?? 0), 'Stuck Applications', 'Sitting 15+ days'),
        mk('money', debtAmt > 0 ? red : neutral, moneyOwed, 'Money Owed', `${numFmt(sf?.total_debtors ?? 0)} debtors · ${numFmt(sf?.total_hard_debtors ?? 0)} hard`),
      ],
    },
    {
      label: 'This Week',
      cells: [
        mk('card', cyan, numFmt(sf?.swipes_this_week ?? 0), 'Fuel Transactions', sf?.fuel_tx_caption ?? 'Mon–today this week'),
        mk('fuel', violet, numFmt(sf?.gallons_this_week ?? 0), 'Gallons Pumped', 'Gallons this cycle'),
        mk('card', green, numFmt(sf?.new_cards_this_week ?? 0), 'New Cards', 'Activated for new units'),
        mk('trend', volumeColor, volumeTrend, 'Volume Trend', 'Week over week'),
      ],
    },
    {
      label: 'Today',
      cells: [
        mk('card', cyan, numFmt(sf?.swipes_today ?? 0), 'Fuel Transactions', 'So far today'),
        mk('fuel', violet, numFmt(sf?.gallons_today ?? 0), 'Gallons Pumped', 'So far today'),
        mk('card', green, numFmt(sf?.new_cards_today ?? 0), 'New Cards', 'Activated today'),
        mk('check', green, numFmt(dailyTasks), 'Tasks Done', 'Cleared from your queue'),
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
      style: `padding:5px 13px;border-radius:var(--radius-md);border:none;cursor:pointer;font-size:12px;font-weight:700;background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--muted)'};transition:all .14s`,
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
        <div style={s('position:relative;overflow:hidden;border-radius:var(--radius-md);padding:26px 28px;background:linear-gradient(120deg, rgba(var(--accent-rgb),.14), rgba(var(--violet-rgb),.10)), var(--surface);border:1px solid var(--border)')}>
          <div style={s('position:absolute;right:-40px;top:-40px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.22),transparent 70%);pointer-events:none')}></div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)')}>{dateLabel}</div>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:30px;letter-spacing:.01em;margin-top:8px;line-height:1.1')}>Good {timeOfDay}, <span style={s('background:linear-gradient(120deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent')}>{user.first}</span></div>
          {/* Daily goal bar — Deals.Application_Date (application filled), owner-scoped COQL. */}
          <div style={s('margin-top:18px')} aria-busy={appsLoading || undefined}>
            <div style={s('display:flex;justify-content:space-between;align-items:center;margin-bottom:8px')}>
              <span style={s('font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text2)')}>
                Today's Goal
              </span>
              {appsLoading ? (
                <div className="ss-skel" style={s('width:72px;height:12px;border-radius:6px')} />
              ) : (
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text2)")}>
                  {appsDone} / {DAILY_APPS_GOAL} apps
                </span>
              )}
            </div>
            <div style={s('position:relative;height:9px;border-radius:99px;background:var(--raised);overflow:hidden')}>
              {appsLoading ? (
                <div className="ss-skel" style={s('position:absolute;inset:0;border-radius:99px')} />
              ) : (
                <div
                  style={s(
                    `position:absolute;inset:0 auto 0 0;width:${appsGoalPct}%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .55s cubic-bezier(.2,0,0,1)`,
                  )}
                />
              )}
            </div>
            {appsLoading ? (
              <div className="ss-skel" style={s('width:180px;height:11px;border-radius:6px;margin-top:9px')} />
            ) : (
              <div
                style={s(
                  `font-size:11px;margin-top:7px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${appStats.error ? 'var(--danger)' : goalMet ? 'var(--ok-text)' : 'var(--accent-text)'}`,
                )}
              >
                {appStats.error
                  ? 'Could not load apps from Deals — retry refresh'
                  : goalMet
                    ? 'Goal met — nice work ✦'
                    : `${appsToGo} more to hit your goal ✦`}
              </div>
            )}
          </div>
          <div style={s('display:flex;gap:10px;margin-top:18px')}>
            <button onClick={goAuto} className="ss-btn-p" style={s('height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:7px')}><Icon name={ICO.bolt} size={15} strokeWidth={2.2} />Run an action</button>
          </div>
        </div>
        <div style={s('border-radius:var(--radius-md);padding:22px 24px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center')}>
          <div style={s('display:flex;justify-content:space-between;align-items:baseline')}>
            <span style={s('font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)')}>Workday Progress</span>
            <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text2)")}>{timeFmt}</span>
          </div>
          <div style={s('position:relative;height:9px;border-radius:99px;background:var(--raised);margin:18px 0 10px;overflow:visible')}>
            {/* Phase track ticks: morning · midday · afternoon · close */}
            <div aria-hidden="true" style={s('position:absolute;inset:0;display:flex;pointer-events:none')}>
              <div style={s('flex:1;border-right:1px solid color-mix(in srgb, var(--border) 70%, transparent)')} />
              <div style={s('flex:1;border-right:1px solid color-mix(in srgb, var(--border) 70%, transparent)')} />
              <div style={s('flex:1;border-right:1px solid color-mix(in srgb, var(--border) 70%, transparent)')} />
              <div style={s('flex:1')} />
            </div>
            <div style={s(`position:absolute;inset:0;width:${workdayFill};border-radius:99px;background:${workday.barGradient};transition:width .35s ease,background .35s ease`)}></div>
            <div style={s(`position:absolute;top:50%;left:${workdayKnob};transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:var(--surface);border:2px solid ${workday.accent};box-shadow:0 2px 8px color-mix(in srgb, ${workday.accent} 55%, transparent);transition:left .35s ease,border-color .35s ease`)}></div>
          </div>
          <div style={s('display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-weight:600')}>
            <span>9:00 AM</span>
            <span style={s(`color:${workday.accent};font-family:'JetBrains Mono',monospace;font-weight:700`)}>{workday.statusLabel}</span>
            <span>6:00 PM</span>
          </div>
        </div>
      </div>

      {/* Habit loop — streak · personal best · week (from Deals Application_Date COQL). */}
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px')}>
        <StreakStat emoji="🔥" value={streakDays} label="day streak" tone="var(--orange)" loading={appsLoading} />
        <StreakStat emoji="⭐" value={bestDay} label="best day · apps" tone="var(--warn)" loading={appsLoading} />
        <StreakStat icon="doc" value={weekApps} label="this week · apps" tone="var(--accent)" loading={appsLoading} />
      </div>

      {celebration && (
        <div aria-hidden="true" style={s('position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;pointer-events:none')}>
          <div style={s('position:relative;padding:20px 28px;border-radius:var(--radius-md);background:linear-gradient(120deg,rgba(var(--accent-rgb),.16),rgba(var(--violet-rgb),.12)),var(--surface);border:1px solid rgba(var(--accent-rgb),.45);box-shadow:var(--shadow);display:flex;align-items:center;gap:16px;animation:ss-pop .3s cubic-bezier(.2,0,0,1) both')}>
            <div aria-hidden="true" style={s('position:absolute;inset:0;border-radius:var(--radius-md);border:2px solid var(--accent);animation:ss-ring .9s ease-out both;pointer-events:none')}></div>
            <span style={s('font-size:34px')}>{celebration.emoji}</span>
            <div style={s('min-width:0')}>
              <div style={s("font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;letter-spacing:.03em;text-transform:uppercase;color:var(--ok-text)")}>{celebration.title}</div>
              <div style={s('font-size:13px;color:var(--text2);margin-top:2px')}>{celebration.msg}</div>
            </div>
          </div>
        </div>
      )}

      {!homeReady ? (
        <HomeBelowFoldSkeleton />
      ) : (
        <>
          {/* announcements */}
          <div style={s('display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px')}>
            <div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><Icon name={ICO.bell} size={17} /></span>Updates &amp; Announcements</div>
            <span style={s('font-size:11px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:99px;background:rgba(var(--accent-rgb),.14);color:var(--accent)')}>{annData.length} NEW</span>
          </div>
          <div style={s('display:flex;gap:12px;overflow-x:auto;padding-bottom:6px')}>
            {ann.error && <StateNote tone="danger">{ann.error}</StateNote>}
            {!ann.error && annData.length === 0 && <StateNote tone="muted">No announcements</StateNote>}
            {annData.map((a) => (
              <div key={a.title} {...clickable(() => openAnn(a))} className="ss-card-h" style={s('flex:0 0 300px;display:flex;gap:12px;padding:15px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                <div style={s(iconBox(a.color, 40))}><Icon name={a.icon} size={18} /></div>
                <div style={s('min-width:0')}>
                  <div style={s('font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical')}>{a.title}</div>
                  <div style={s('font-size:11px;color:var(--muted);margin-top:4px')}>{a.time}</div>
                </div>
              </div>
            ))}
          </div>

          {/* snapshot */}
          <div style={s('margin-top:24px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)')}>
              <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}>Today's Snapshot</div>
              <div style={s('display:flex;align-items:center;gap:10px')}>
                <span style={s('font-size:11px;color:var(--muted)')}>Updated {timeFmt}</span>
                <button onClick={refreshSnapshot} aria-label="Refresh" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}><Icon name="refresh" size={15} style={s(snapSpinCss)} /></button>
              </div>
            </div>
            <div style={s('padding:18px 20px')}>
              {snap.error && <StateNote tone="danger">{snap.error}</StateNote>}
              {!snap.error && (
                <div>
                  {snapshotGroups.map((g) => (
                    <div key={g.label} style={s('margin-bottom:16px')}>
                      <div style={s('font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px')}>{g.label}</div>
                      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px')}>
                        {g.cells.map((c) => (
                          <div key={c.label} className="ss-card-h" style={s('padding:15px;border-radius:var(--radius-md);background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);position:relative')}>
                            <div style={s(c.iconStyle)}><Icon name={c.icon} size={18} /></div>
                            <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:500;font-size:23px;line-height:1.15;min-height:27px;margin-top:12px;color:${c.color}`)}>{c.value}</div>
                            <div style={s('font-size:12px;font-weight:600;color:var(--text);margin-top:2px')}>{c.label}</div>
                            <div style={s('font-size:11px;color:var(--muted);margin-top:4px;line-height:1.35')}>{c.help}</div>
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
          <div style={s('margin-top:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px')}>
              <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}>Your Activity</div>
              <div style={s('display:flex;gap:3px;padding:3px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                {activityRanges.map((r) => (
                  <button key={r.id} onClick={r.onClick} style={s(r.style)}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={s('padding:18px 20px')}>
              {act.loading && !act.data && <ActivityTilesSkeleton />}
              {!act.loading && act.error && <StateNote tone="danger">{act.error}</StateNote>}
              {(act.data || (!act.loading && !act.error)) && (
                <>
                  <div style={s(`display:grid;grid-template-columns:repeat(7,1fr);gap:11px;opacity:${act.loading ? '.55' : '1'};transition:opacity .2s`)}>
                    {activityTiles.map((t) => (
                      <div key={t.label} style={s('padding:13px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);text-align:center')}>
                        <div style={s(t.iconStyle)}><Icon name={t.icon} size={16} /></div>
                        <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:19px;line-height:1.15;min-height:22px;margin-top:9px")}>{t.value}</div>
                        <div style={s('font-size:11px;color:var(--muted);margin-top:2px')}>{t.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={s('margin-top:14px;padding:13px 16px;border-radius:var(--radius-md);background:linear-gradient(120deg,rgba(var(--accent-rgb),.08),transparent);border:1px solid var(--border2);display:flex;align-items:center;gap:16px;flex-wrap:wrap')}>
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
              <div style={s('display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px')}><div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><Icon name={ICO.bolt} size={17} /></span>Quick Actions</div><button onClick={goAuto} className="ss-tab-x" style={s('background:none;border:none;color:var(--accent);font-weight:700;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:var(--radius-md)')}>All guides →</button></div>
              <div style={s('display:flex;flex-direction:column;gap:12px')}>
                {ctaCards.map((c) => (
                  <div key={c.name} {...clickable(goAuto)} className="ss-card-h" style={s('padding:16px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
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
              <div style={s('display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px')}><div style={s('display:flex;align-items:center;gap:9px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase')}><span style={s('color:var(--accent);display:flex')}><Icon name="inbox" size={17} /></span>Recent Inbox</div><button onClick={goInbox} className="ss-tab-x" style={s('background:none;border:none;color:var(--accent);font-weight:700;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:var(--radius-md)')}>View all →</button></div>
              <div style={s('display:flex;flex-direction:column;gap:10px')}>
                {inbox.error && <StateNote tone="danger">{inbox.error}</StateNote>}
                {!inbox.error && inboxData.length === 0 && <StateNote tone="muted">No messages</StateNote>}
                {inboxPreview.map((i) => (
                  <div key={i.id} {...clickable(i.onClick)} className="ss-card-h" style={s('display:flex;gap:12px;padding:13px 14px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm);position:relative;overflow:hidden')}>
                    <div style={s(`position:absolute;left:0;top:0;bottom:0;width:3px;background:${i.barColor}`)}></div>
                    <div style={s(i.iconStyle)}><Icon name={i.icon} size={15} /></div>
                    <div style={s('min-width:0;flex:1')}>
                      <div style={s('display:flex;justify-content:space-between;gap:8px')}><span style={s('font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{i.title}</span><span style={s('font-size:11px;color:var(--muted);white-space:nowrap')}>{i.time}</span></div>
                      <div style={s('font-size:12px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{i.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
