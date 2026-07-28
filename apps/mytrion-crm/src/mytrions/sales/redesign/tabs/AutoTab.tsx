/**
 * Automations tab — catalog + runner modal (deal/card pickers, touchpoint dispatch).
 */
import { useEffect, useRef, useState } from 'react';
import type { MoneyCodePreview } from '@/api/touchpointTypes';
import { callTouchpoint, logAutomation } from '@/api/touchpoints';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { deptStyle, iconBox, nyDaysAgo, nyToday } from '../salesData';
import { useLoad, money } from '../live';
import {
  AUTO_LIST, LIMITTYPES, LIMIT_CHANGE_MAX, MONEY_CODE_REASONS, RUNNABLE, PHASE_MAP,
  autoIconColor, loadDeals, loadCards, loadMoneyCodePreview, str,
  type Automation, type Deal, type Card, type InvRow,
  type DonePayload, type Addr, type UnitDriverForm, type MoneyCodeForm,
} from '../autoLive';
import { runAutomation, type AutoPriority } from '../autoRunners';
import { AutoCatalog } from '../AutoCatalog';
import { AutoDealPicklist, AutoCardPicklist, AutoMacroLoader, cardStatusBadge } from '../AutoPicklist';
import { AutoBocaCloseForm } from '../AutoBocaCloseForm';
import { AutoDoneStep, hasWideAutoResult } from '../AutoDoneStep';
import { AutoWexPanel } from '../AutoWexPanel';
import { TXN_RANGE_PRESETS, type TxnReportState } from '../txnReport';

type Step = 'config' | 'running' | 'done';
type LimitDir = 'increase' | 'decrease';
const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
/** Surface (not alt) — light-mode picklists stay clean white, not grey wash. */
const inp42 = 'width:100%;height:42px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px';
const labelCss = 'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const noteWarn = 'padding:14px 16px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);font-size:14px;color:var(--text2);line-height:1.5';
const noteErr = 'padding:12px 14px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--danger) 12%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);font-size:14px;color:var(--danger);line-height:1.5';
const invRanges = [
  { label: 'Last 7 Days', range: 'last_7' },
  { label: 'Last 30 Days', range: 'last_30' },
  { label: 'Last 90 Days', range: 'last_90' },
  { label: 'Custom Range', range: 'custom' },
];
const invStatuses = [
  { value: 'all', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
];
const txnRanges = TXN_RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label }));
// Date defaults/bounds follow the NY calendar (the sales floor's day), not the viewer's/UTC —
// toISOString() here used to show "tomorrow" for late-evening ET users.
const todayIso = () => nyToday();
const daysAgoIso = (n: number) => nyDaysAgo(n);
const limitBtn = (on: boolean, col: string): string =>
  `flex:1;padding:9px;border-radius:var(--radius-md);border:1px solid ${on ? col : 'var(--border)'};background:${on ? `color-mix(in srgb,${col} 16%,transparent)` : 'var(--surface)'};color:${on ? col : 'var(--muted)'};font-size:14px;font-weight:700;cursor:pointer;transition:all .14s`;
const btnP = (extra: string): string => `border:none;background:${grad};color:#fff;font-weight:700;cursor:pointer;${extra}`;
function Lbl({ t }: { t: string }) { return <div style={s(labelCss)}>{t}</div>; }
const closeX16 = (
  <Icon name="close" size={16} strokeWidth={2.4} />
);
const UD0: UnitDriverForm = { unitNumber: '', driverName: '', driverId: '' };
// Reason starts EMPTY on purpose: pre-selecting the first option let an agent draw without ever
// choosing why, and the reason ends up on the EFS check. `moneyReady` already requires it.
const MC0: MoneyCodeForm = { amount: '', reason: '', unitNumber: '' };

export function AutoTab() {
  const { focusAutomationId, clearFocusAutomation } = useSales();
  const [autoSearch, setAutoSearch] = useState('');
  const [autoModal, setAutoModal] = useState<Automation | null>(null);
  const [autoStep, setAutoStep] = useState<Step>('config');
  const [autoDeal, setAutoDeal] = useState<Deal | null>(null);
  const [autoCard, setAutoCard] = useState<Card | null>(null);
  const [autoDealQuery, setAutoDealQuery] = useState('');
  const [autoShowDrop, setAutoShowDrop] = useState(false);
  const [autoCardQuery, setAutoCardQuery] = useState('');
  const [autoShowCardDrop, setAutoShowCardDrop] = useState(false);
  const [autoLimitType, setAutoLimitType] = useState<string>(LIMITTYPES[0].value);
  const [autoLimitValue, setAutoLimitValue] = useState('');
  const [autoLimitDir, setAutoLimitDir] = useState<LimitDir>('increase');
  const [autoPhase, setAutoPhase] = useState('');
  const [autoResult, setAutoResult] = useState<DonePayload | null>(null);
  const [autoAddr, setAutoAddr] = useState<Addr>({ address: '', city: '', state: '', zip: '' });
  const [autoDue, setAutoDue] = useState('');
  const [autoPriority, setAutoPriority] = useState<AutoPriority>('');
  const [autoAssignedTo, setAutoAssignedTo] = useState('');
  const [autoOwnerLoading, setAutoOwnerLoading] = useState(false);
  const [unitDriver, setUnitDriver] = useState<UnitDriverForm>(UD0);
  const [moneyForm, setMoneyForm] = useState<MoneyCodeForm>(MC0);
  const [mcPreview, setMcPreview] = useState<MoneyCodePreview | null>(null);
  const [mcPreviewErr, setMcPreviewErr] = useState<string | null>(null);
  const [mcPreviewLoading, setMcPreviewLoading] = useState(false);
  const [autoInvStatus, setAutoInvStatus] = useState('all');
  const [autoInvRange, setAutoInvRange] = useState('Last 30 Days');
  const [autoInvFrom, setAutoInvFrom] = useState(daysAgoIso(30));
  const [autoInvTo, setAutoInvTo] = useState(todayIso());
  const [autoTxnRange, setAutoTxnRange] = useState('month');
  const [autoTxnFrom, setAutoTxnFrom] = useState(daysAgoIso(30));
  const [autoTxnTo, setAutoTxnTo] = useState(todayIso());
  const [autoRunErr, setAutoRunErr] = useState<string | null>(null);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [txnReport, setTxnReport] = useState<TxnReportState | null>(null);

  const progTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /**
   * Run token. Every start bumps it and the handlers below ignore any result whose token is stale,
   * so a slow response that lands after the user cancelled, closed, or switched automation can no
   * longer overwrite the current view. NOTE: the HTTP request itself is not aborted — callTouchpoint
   * takes no AbortSignal and threading one through every autoRunners branch is a separate change —
   * so a cancelled run finishes in the background and its result is discarded.
   */
  const runSeq = useRef(0);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dealInputRef = useRef<HTMLInputElement | null>(null);
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { clearInterval(progTimer.current); clearTimeout(fetchTimer.current); }, []);

  // ESC closes the runner, at any step. Previously there was no keyboard exit at all: during a run
  // the backdrop and X both no-opped, so a hung automation could only be escaped by reloading.
  useEffect(() => {
    if (!autoModal) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeAuto();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // closeAuto is stable enough for this purpose (it only touches refs + setState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoModal]);

  const dealsLoad = useLoad(loadDeals, []);
  const DEAL_LIST = dealsLoad.data ?? [];
  const cardCarrier = autoModal?.kind === 'card' && autoDeal?.carrier ? autoDeal.carrier : '';
  const cardsLoad = useLoad(() => (cardCarrier ? loadCards(cardCarrier) : Promise.resolve<Card[]>([])), [cardCarrier]);
  const CARD_LIST = cardsLoad.data ?? [];

  useEffect(() => {
    if (autoModal?.id !== 'money-code' || !autoDeal?.carrier) {
      setMcPreview(null); setMcPreviewErr(null); setMcPreviewLoading(false);
      return;
    }
    let off = false;
    setMcPreviewLoading(true); setMcPreviewErr(null); setMcPreview(null);
    loadMoneyCodePreview(autoDeal.carrier)
      .then((p) => { if (!off) setMcPreview(p); })
      .catch((e: unknown) => { if (!off) setMcPreviewErr(e instanceof Error ? e.message : 'Preview failed'); })
      .finally(() => { if (!off) setMcPreviewLoading(false); });
    return () => { off = true; };
  }, [autoModal?.id, autoDeal?.carrier]);

  // BOCA / Close — lock Assigned To to the WEX SF application owner (widget fetchBocaOwner).
  useEffect(() => {
    const needsOwner = autoModal?.id === 'boca-boe-link' || autoModal?.id === 'close-app';
    const appId = autoDeal?.app?.trim();
    if (!needsOwner || !appId || appId === '—') {
      setAutoAssignedTo('');
      setAutoOwnerLoading(false);
      return;
    }
    let off = false;
    setAutoOwnerLoading(true);
    setAutoAssignedTo('');
    callTouchpoint('wex.application', { appId })
      .then((res) => {
        if (off) return;
        const app = (res.application ?? {}) as Record<string, unknown>;
        const name = str(app.ownerName) || str(app['Owner.Name']) || '';
        if (name) setAutoAssignedTo(name);
      })
      .catch(() => { /* non-blocking — field stays empty */ })
      .finally(() => { if (!off) setAutoOwnerLoading(false); });
    return () => { off = true; };
  }, [autoModal?.id, autoDeal?.app]);

  const openAuto = (a: Automation): void => {
    if (a.soon) return;
    abandonRun();
    setAutoModal(a); setAutoStep('config'); setAutoDeal(null); setAutoCard(null);
    setAutoDealQuery(''); setAutoShowDrop(false); setAutoCardQuery(''); setAutoShowCardDrop(false);
    setAutoLimitType(LIMITTYPES[0].value); setAutoLimitValue(''); setAutoLimitDir('increase');
    setAutoPhase(''); setAutoResult(null); setAutoRunErr(null);
    setInvRows([]); setTxnReport(null); setUnitDriver(UD0); setMoneyForm(MC0);
    setAutoAddr({ address: '', city: '', state: '', zip: '' });
    setAutoDue(''); setAutoPriority(''); setAutoAssignedTo(''); setAutoOwnerLoading(false);
    // WEX search state lives in <AutoWexPanel/>, which remounts per modal open.
  };

  // Create Ticket Instant redirect (and similar) lands here with a catalog id to open.
  useEffect(() => {
    if (!focusAutomationId) return;
    const target = AUTO_LIST.find((a) => a.id === focusAutomationId && a.soon !== true) ?? null;
    clearFocusAutomation();
    if (target) openAuto(target);
  }, [focusAutomationId, clearFocusAutomation]);
  /** Invalidate any in-flight run and stop its timers. */
  const abandonRun = (): void => {
    runSeq.current += 1;
    clearInterval(progTimer.current);
    clearTimeout(fetchTimer.current);
  };
  /**
   * Closing is always allowed — including mid-run. It used to early-return while `running`, and
   * since this was the handler for BOTH the backdrop and the X, a hung automation left the agent
   * with no exit but a page reload.
   */
  const closeAuto = (): void => { abandonRun(); setAutoModal(null); };
  /** Cancel from the running step: keep the modal open, go back to the form. */
  const cancelRun = (): void => { abandonRun(); setAutoPhase(''); setAutoStep('config'); };
  const setDealQuery = (v: string): void => { setAutoDealQuery(v); setAutoShowDrop(true); };
  const selectDeal = (d: Deal): void => {
    setAutoDeal(d); setAutoShowDrop(false); setAutoDealQuery(''); setAutoCard(null); setAutoCardQuery('');
    // Card actions: open the card picklist so the micro-loader shows while cards fetch.
    setAutoShowCardDrop(autoModal?.kind === 'card');
  };
  const clearDeal = (): void => { setAutoDeal(null); setAutoCard(null); };
  const setCardQuery = (v: string): void => { setAutoCardQuery(v); setAutoShowCardDrop(true); };
  const selectCard = (c: Card): void => {
    setAutoCard(c); setAutoShowCardDrop(false); setAutoCardQuery('');
    setUnitDriver({ unitNumber: c.unit || '', driverName: c.driver || '', driverId: '' });
  };
  const clearCard = (): void => setAutoCard(null);
  const setAddr = (k: keyof Addr, v: string): void => setAutoAddr((a) => ({ ...a, [k]: v }));
  const setUd = (k: keyof UnitDriverForm, v: string): void => setUnitDriver((f) => ({ ...f, [k]: v }));
  const setMc = (k: keyof MoneyCodeForm, v: string): void => setMoneyForm((f) => ({ ...f, [k]: v }));

  const resetAuto = (): void => {
    abandonRun();
    setAutoStep('config'); setAutoPhase(''); setAutoResult(null); setAutoCard(null);
    setAutoRunErr(null); setInvRows([]); setTxnReport(null);
  };

  const runAuto = (): void => {
    const bm = autoModal;
    if (!bm) return;
    setAutoRunErr(null); setAutoResult(null); setAutoStep('running'); setTxnReport(null);
    const phases = PHASE_MAP[bm.kind ?? ''] ?? ['Working…', 'Finishing…'];
    abandonRun();
    const seq = runSeq.current;
    setAutoPhase(phases[0] ?? 'Working…');
    // Advance the PHASE LABEL only — there is no real progress figure to report (see AutoMacroLoader).
    let phaseIdx = 0;
    progTimer.current = setInterval(() => {
      phaseIdx = Math.min(phases.length - 1, phaseIdx + 1);
      setAutoPhase(phases[phaseIdx] ?? '');
      if (phaseIdx === phases.length - 1) clearInterval(progTimer.current);
    }, 2500);
    // Watchdog: a run that never settles becomes a real error instead of an endless spinner.
    const watchdog = setTimeout(() => {
      if (seq !== runSeq.current) return;
      abandonRun();
      setAutoRunErr('This is taking longer than expected. It may still be processing — check the record before retrying.');
      setAutoStep('done');
    }, 90_000);
    runAutomation({
      action: bm, deal: autoDeal, card: autoCard,
      invRange: autoInvRange, invStatus: autoInvStatus,
      invFrom: autoInvFrom, invTo: autoInvTo,
      txnRange: autoTxnRange, txnFrom: autoTxnFrom, txnTo: autoTxnTo,
      limitId: autoLimitType, limitValue: autoLimitValue, limitDir: autoLimitDir,
      addr: autoAddr, note: '', due: autoDue,
      assignedTo: autoAssignedTo, priority: autoPriority,
      unitDriver, moneyCode: moneyForm,
      setInvRows, setTxnReport,
    })
      .then((payload) => {
        clearTimeout(watchdog);
        if (seq !== runSeq.current) return; // cancelled / closed / another run started
        clearInterval(progTimer.current);
        setAutoResult(payload);
        fetchTimer.current = setTimeout(() => setAutoStep('done'), 240);
        if (payload.kind === 'link') window.open(payload.url, '_blank', 'noopener');
        logAutomation(bm.id);
      })
      .catch((e: unknown) => {
        clearTimeout(watchdog);
        if (seq !== runSeq.current) return;
        clearInterval(progTimer.current);
        setAutoRunErr(e instanceof Error ? e.message : 'The action failed — try again.');
        setAutoStep('done');
      });
  };

  const aq = autoSearch.toLowerCase();
  const autoCatalog = AUTO_LIST.filter((a) => !aq || `${a.title} ${a.desc} ${a.codes.join(' ')}`.toLowerCase().includes(aq));
  const b = autoModal;
  const kind = b?.kind;
  const hasDeal = !!autoDeal;
  const hasCard = !!autoCard;
  const dq = autoDealQuery.toLowerCase();
  const needsAppOnly = b?.id === 'boca-boe-link' || b?.id === 'close-app' || b?.id === 'wex-tasks';
  const dealPool = DEAL_LIST.filter((d) => {
    if (needsAppOnly) return d.app && d.app !== '—';
    if (kind === 'form' || kind === 'ticket' || kind === 'wex-tasks') return true;
    return !!d.carrier;
  });
  const filteredDeals = dealPool.filter((d) => !dq || `${d.name} ${d.company} ${d.app} ${d.carrier} ${d.phone}`.toLowerCase().includes(dq));
  const cardPool = b?.id === 'fraud-hold-release' || b?.id === 'override-card' ? CARD_LIST.filter((c) => c.status === 'fraud') : CARD_LIST;
  const cq = autoCardQuery.toLowerCase();
  const filteredCards = cardPool.filter((c) => !cq || c.number.includes(cq));
  const needsDeal = !!kind && kind !== 'search' && kind !== 'link';
  const needsCard = kind === 'card' && hasDeal;
  const isLimits = !!b?.limits && hasCard;
  const showUnitDriver = hasCard && (b?.id === 'unit-driver' || b?.id === 'card-activation');
  const unavailable = !!b && !RUNNABLE.has(b.id);
  const moneyReady = !!mcPreview?.eligible && moneyForm.amount.trim().length > 0 && moneyForm.reason.trim().length > 0 && moneyForm.unitNumber.trim().length > 0;
  const unitReady = b?.id !== 'unit-driver' || [unitDriver.unitNumber, unitDriver.driverId, unitDriver.driverName].some((v) => v.trim());
  const addrReady = b?.id !== 'card-replacement' || [autoAddr.address, autoAddr.city, autoAddr.state, autoAddr.zip].every((v) => v.trim());
  const limitDelta = Number(autoLimitValue);
  const limitReady = Number.isFinite(limitDelta) && limitDelta > 0 && limitDelta <= LIMIT_CHANGE_MAX;
  const canRun = !unavailable && (
    kind === 'link' ? true
      : kind === 'invoices' || kind === 'transactions' || kind === 'simple' || kind === 'wex-tasks' ? hasDeal
        : kind === 'money' ? hasDeal && moneyReady
          : kind === 'card' ? hasCard && (!b?.limits || limitReady) && unitReady
            : kind === 'form' || kind === 'ticket' ? hasDeal && addrReady
              : false);
  const runVerb = kind === 'invoices' ? 'Get Invoices' : kind === 'transactions' ? 'Fetch Transactions' : b?.verb || 'Submit';
  const successMsg = autoResult?.kind === 'message' ? autoResult.message
    : autoResult?.kind === 'link' ? autoResult.label
      : `${runVerb} completed for ${autoDeal?.name ?? 'the selected client'}.`;
  const autoCardDisplay = autoCard ? `•••• ${autoCard.number.slice(-4)}` : '';
  const autoCardBadge = autoCard ? cardStatusBadge(autoCard.status) : { text: '', style: '' };
  const wideResult = autoStep === 'done' && hasWideAutoResult(autoResult, invRows, txnReport);
  const modalMaxW = wideResult ? '820px' : '640px';
  const bodyTxnSplit = wideResult && autoResult?.kind === 'transactions';

  return (
    <>
      <div className="ss-fu">
        <div style={s('margin-bottom:16px')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase')}>Self-Service Actions</div>
          <div style={s('font-size:14px;color:var(--muted);margin-top:2px')}>Handle Customer Service, Billing &amp; Verification yourself — no ticket needed. <strong style={s('color:var(--text2)')}>{String(autoCatalog.length)}</strong> actions available.</div>
        </div>
        <div style={s('position:relative;margin-bottom:18px')}>
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={autoSearch} onChange={(e) => setAutoSearch(e.target.value)} placeholder="Search by name, code (e.g. C-16), or keyword…" className="ss-in" style={s('width:100%;height:46px;padding:0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;box-shadow:var(--shadow-sm)')} />
          {autoSearch && <button onClick={() => setAutoSearch('')} aria-label="Clear" className="ss-ico-btn" style={s('position:absolute;right:11px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:var(--radius-md);border:none;background:var(--alt);color:var(--muted);cursor:pointer')}>✕</button>}
        </div>
        <AutoCatalog items={autoCatalog} onOpen={openAuto} />
      </div>

      {/* Scrim matches dataCenterSheet (.78 / blur 6) — .62 / blur 3 left the catalog legible through
          the dialog. The panel takes the shared `ss-modal-box` recipe (accent rail +
          --hz-modal-surface + blur) instead of an inline --surface, which at 0.66 alpha was the main
          reason the modal read as translucent in dark mode. */}
      {b && (
        <div onClick={closeAuto} style={s('position:fixed;inset:0;z-index:115;background:rgba(3,7,14,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px')}>
          <div className="ss-modal-box" onClick={(e) => e.stopPropagation()} style={s(`position:relative;width:100%;max-width:${modalMaxW};max-height:88vh;display:flex;flex-direction:column;border-radius:var(--radius-md);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
            <div style={s('flex-shrink:0;padding:24px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:16px;background:linear-gradient(180deg,rgba(var(--accent-rgb),0.03),transparent)')}>
              <div style={s(iconBox(autoIconColor(b), 48))}>
                <Icon name={b.icon} size={22} strokeWidth={1.75} />
              </div>
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:21px;letter-spacing:.03em;text-transform:uppercase;color:var(--text)')}>{b.title}</div>
                <div style={s('display:flex;gap:6px;margin-top:6px;flex-wrap:wrap')}>{b.codes.map((c) => <span key={c} style={s(deptStyle(c, autoIconColor(b)))}>{c}</span>)}</div>
                <div style={s('font-size:14px;color:var(--muted);margin-top:8px;line-height:1.5')}>{b.desc}</div>
              </div>
              <button onClick={closeAuto} aria-label="Close" className="ss-ico-btn" style={s('width:36px;height:36px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background .15s')}>{closeX16}</button>
            </div>
            <div
              className={bodyTxnSplit ? undefined : 'ss-scroll'}
              style={s(bodyTxnSplit
                ? 'flex:1;min-height:0;padding:24px;display:flex;flex-direction:column;overflow:hidden'
                : 'flex:1;min-height:0;padding:24px')}
            >
              {autoStep === 'config' && (
                <div style={s('display:flex;flex-direction:column;gap:18px')}>
                  {kind === 'search' && <AutoWexPanel />}

                  {kind === 'link' && (
                    <div style={s('padding:14px 16px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:14px;color:var(--text2);line-height:1.5')}>Opens the WEX EFS eManager credentials guide PDF in a new tab.</div>
                  )}

                  {needsDeal && (
                    <AutoDealPicklist
                      deal={autoDeal}
                      query={autoDealQuery}
                      showDrop={autoShowDrop}
                      inputRef={dealInputRef}
                      loading={dealsLoad.loading}
                      error={dealsLoad.error}
                      deals={filteredDeals}
                      onQuery={setDealQuery}
                      onFocus={() => setAutoShowDrop(true)}
                      onCloseDrop={() => setAutoShowDrop(false)}
                      onSelect={selectDeal}
                      onClear={clearDeal}
                    />
                  )}

                  {needsCard && (
                    <AutoCardPicklist
                      card={autoCard}
                      query={autoCardQuery}
                      showDrop={autoShowCardDrop}
                      inputRef={cardInputRef}
                      loading={cardsLoad.loading}
                      error={cardsLoad.error}
                      cards={filteredCards}
                      displayNumber={autoCardDisplay}
                      statusBadge={autoCardBadge}
                      onQuery={setCardQuery}
                      onFocus={() => setAutoShowCardDrop(true)}
                      onCloseDrop={() => setAutoShowCardDrop(false)}
                      onSelect={selectCard}
                      onClear={clearCard}
                    />
                  )}

                  {showUnitDriver && (
                    <div style={s('display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px')}>
                      <div><Lbl t="Unit #" /><input value={unitDriver.unitNumber} onChange={(e) => setUd('unitNumber', e.target.value)} placeholder="Unit" className="ss-in" style={s(inp42)} /></div>
                      <div><Lbl t="Driver ID" /><input value={unitDriver.driverId} onChange={(e) => setUd('driverId', e.target.value)} placeholder="Driver ID" className="ss-in" style={s(inp42)} /></div>
                      <div><Lbl t="Driver Name" /><input value={unitDriver.driverName} onChange={(e) => setUd('driverName', e.target.value)} placeholder="Name" className="ss-in" style={s(inp42)} /></div>
                    </div>
                  )}

                  {isLimits && (
                    <div style={s('display:flex;flex-direction:column;gap:14px')}>
                      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                        <div><Lbl t="Limit Type" /><select value={autoLimitType} onChange={(e) => setAutoLimitType(e.target.value)} className="ss-in" style={s(inp42)}>{LIMITTYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                        <div><Lbl t="Change amount (gallons)" /><input value={autoLimitValue} onChange={(e) => setAutoLimitValue(e.target.value)} type="number" min="1" max={LIMIT_CHANGE_MAX} step="1" placeholder="e.g. 100" className="ss-in" style={s(inp42)} /></div>
                      </div>
                      <div style={s(`font-size:12px;color:${autoLimitValue && !limitReady ? 'var(--danger)' : 'var(--muted)'}`)}>Added to or subtracted from the card&apos;s existing limit. Maximum {LIMIT_CHANGE_MAX} gallons per run.</div>
                      <div>
                        <Lbl t="Direction" />
                        <div style={s('display:flex;gap:9px')}>
                          <button onClick={() => setAutoLimitDir('increase')} style={s(limitBtn(autoLimitDir === 'increase', 'var(--ok)'))}>▲ Increase</button>
                          <button onClick={() => setAutoLimitDir('decrease')} style={s(limitBtn(autoLimitDir === 'decrease', 'var(--danger)'))}>▼ Decrease</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {kind === 'invoices' && (
                    <div style={s('display:flex;flex-direction:column;gap:12px')}>
                      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                        <div>
                          <Lbl t="Quick Date Range" />
                          <select value={autoInvRange} onChange={(e) => setAutoInvRange(e.target.value)} className="ss-in" style={s(inp42)}>
                            {invRanges.map((o) => <option key={o.range} value={o.label}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <Lbl t="Status" />
                          <select value={autoInvStatus} onChange={(e) => setAutoInvStatus(e.target.value)} className="ss-in" style={s(inp42)}>
                            {invStatuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      </div>
                      {autoInvRange === 'Custom Range' && (
                        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                          <div><Lbl t="Start Date" /><input type="date" value={autoInvFrom} onChange={(e) => setAutoInvFrom(e.target.value)} className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="End Date" /><input type="date" value={autoInvTo} min={autoInvFrom} max={todayIso()} onChange={(e) => setAutoInvTo(e.target.value)} className="ss-in" style={s(inp42)} /></div>
                        </div>
                      )}
                    </div>
                  )}

                  {kind === 'transactions' && (
                    <div style={s('display:flex;flex-direction:column;gap:12px')}>
                      <div>
                        <Lbl t="Date Range" />
                        <select value={autoTxnRange} onChange={(e) => setAutoTxnRange(e.target.value)} className="ss-in" style={s(inp42)}>
                          {txnRanges.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      {autoTxnRange === 'custom' && (
                        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                          <div><Lbl t="Start Date" /><input type="date" value={autoTxnFrom} max={todayIso()} onChange={(e) => setAutoTxnFrom(e.target.value)} className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="End Date" /><input type="date" value={autoTxnTo} min={autoTxnFrom} max={todayIso()} onChange={(e) => setAutoTxnTo(e.target.value)} className="ss-in" style={s(inp42)} /></div>
                        </div>
                      )}
                    </div>
                  )}

                  {kind === 'money' && hasDeal && (
                    <div style={s('display:flex;flex-direction:column;gap:14px')}>
                      {mcPreviewLoading && (
                        <div role="status" aria-busy="true" style={s('padding:8px 0')}>
                          <div className="ss-skel" style={s('width:100%;height:48px;border-radius:var(--radius-md)')} />
                        </div>
                      )}
                      {mcPreviewErr && <div style={s(noteErr)}>{mcPreviewErr}</div>}
                      {mcPreview && (
                        <div style={s(`padding:14px 16px;border-radius:var(--radius-md);background:${mcPreview.eligible ? 'rgba(var(--accent-rgb),.08)' : 'color-mix(in srgb,var(--warn) 12%,transparent)'};border:1px solid ${mcPreview.eligible ? 'rgba(var(--accent-rgb),.2)' : 'color-mix(in srgb,var(--warn) 30%,transparent)'};font-size:14px;color:var(--text2);line-height:1.5`)}>
                          {mcPreview.eligible
                            ? <>Eligible — <strong style={s('color:var(--text)')}>{money(mcPreview.available)}</strong> available of a {money(mcPreview.credit_limit)} line{mcPreview.billing_cycle_label ? ` (${mcPreview.billing_cycle_label})` : ''}.</>
                            : <>Not eligible right now{mcPreview.available != null ? ` — ${money(mcPreview.available)} available` : ''}.</>}
                        </div>
                      )}
                      {mcPreview?.eligible && (
                        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                          <div><Lbl t="Amount" /><input value={moneyForm.amount} onChange={(e) => setMc('amount', e.target.value)} type="number" placeholder="e.g. 150" className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="Unit #" /><input value={moneyForm.unitNumber} onChange={(e) => setMc('unitNumber', e.target.value)} placeholder="Unit" className="ss-in" style={s(inp42)} /></div>
                          <div style={s('grid-column:1 / -1')}><Lbl t="Reason" /><select value={moneyForm.reason} onChange={(e) => setMc('reason', e.target.value)} aria-label="Why is this money code needed?" className="ss-in" style={s(inp42)}>
                            {/* Server list wins — servercrm validates against its own set, so the
                                fallback constant is only for a preview that has not landed yet. */}
                            <option value="" disabled>Why is this money code needed?</option>
                            {(mcPreview?.moneycode_reasons?.length ? mcPreview.moneycode_reasons : MONEY_CODE_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
                          </select></div>
                        </div>
                      )}
                    </div>
                  )}

                  {(b.id === 'boca-boe-link' || b.id === 'close-app') && hasDeal && (
                    <AutoBocaCloseForm
                      mode={b.id === 'boca-boe-link' ? 'boca' : 'close'}
                      assignedTo={autoAssignedTo}
                      assignedToLoading={autoOwnerLoading}
                      priority={autoPriority}
                      due={autoDue}
                      minDue={todayIso()}
                      onPriority={setAutoPriority}
                      onDue={setAutoDue}
                    />
                  )}

                  {b.id === 'reactivation' && hasDeal && (
                    <div style={s('padding:14px 16px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:14px;color:var(--text2);line-height:1.5')}>
                      Submits a reactivation email request for <strong style={s('color:var(--text)')}>{autoDeal?.name}</strong>. You will receive the answer by email.
                    </div>
                  )}

                  {b.id === 'card-replacement' && hasDeal && (
                    <div>
                      <div style={s('font-size:14px;color:var(--text2);margin-bottom:12px')}>Confirm the shipping address for the replacement cards.</div>
                      <div style={s('display:grid;grid-template-columns:2fr 1fr;gap:12px')}>
                        <div style={s('grid-column:1 / -1')}><Lbl t="Street Address" /><input value={autoAddr.address} onChange={(e) => setAddr('address', e.target.value)} placeholder="123 Fleet Way" className="ss-in" style={s(inp42)} /></div>
                        <div><Lbl t="City" /><input value={autoAddr.city} onChange={(e) => setAddr('city', e.target.value)} placeholder="City" className="ss-in" style={s(inp42)} /></div>
                        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                          <div><Lbl t="State" /><input value={autoAddr.state} onChange={(e) => setAddr('state', e.target.value)} placeholder="ST" className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="Zip" /><input value={autoAddr.zip} onChange={(e) => setAddr('zip', e.target.value)} placeholder="00000" className="ss-in" style={s(inp42)} /></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(kind === 'simple' || kind === 'wex-tasks') && hasDeal && (
                    <div style={s('padding:14px 16px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:14px;color:var(--text2);line-height:1.5')}><strong style={s('color:var(--text)')}>Ready.</strong> This will run against <strong style={s('color:var(--text)')}>{autoDeal?.name}</strong> and return an instant result.</div>
                  )}

                  {kind !== 'search' && (
                    <div style={s('display:flex;flex-direction:column;gap:12px;padding-top:2px')}>
                      {unavailable && <div style={s(noteWarn)}>This action isn&apos;t available for self-service yet — file a ticket and the team will handle it.</div>}
                      <div style={s('display:flex;justify-content:flex-end')}>
                        {canRun
                          ? <button onClick={runAuto} className="ss-btn-p" style={s(btnP('height:44px;padding:0 24px;border-radius:var(--radius-md);font-size:14px;box-shadow:0 6px 18px rgba(var(--accent-rgb),.35)'))}>{runVerb}</button>
                          : <button disabled style={s('height:44px;padding:0 24px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:14px;cursor:not-allowed')}>{runVerb}</button>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {autoStep === 'running' && (
                <>
                  <AutoMacroLoader phase={autoPhase} />
                  <div style={s('display:flex;justify-content:center;padding:0 20px 28px')}>
                    <button
                      type="button"
                      onClick={cancelRun}
                      style={s('height:38px;padding:0 20px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:13px;cursor:pointer')}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {autoStep === 'done' && (
                <AutoDoneStep
                  error={autoRunErr}
                  result={autoResult}
                  invoiceRows={invRows}
                  txnReport={txnReport}
                  runVerb={runVerb}
                  successMessage={successMsg}
                  splitTransactions={bodyTxnSplit}
                  onDone={closeAuto}
                  onReset={resetAuto}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
