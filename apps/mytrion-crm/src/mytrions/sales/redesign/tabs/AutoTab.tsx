/**
 * Automations tab — catalog + runner modal (deal/card pickers, touchpoint / Desk dispatch).
 */
import { useEffect, useRef, useState } from 'react';
import type { MoneyCodePreview } from '@/api/touchpointTypes';
import { logAutomation } from '@/api/touchpoints';
import { s, Svg, Badge } from '../dc';
import { badge, deptStyle, iconBox, nyDaysAgo, nyToday, type BadgeVM } from '../salesData';
import { useLoad, money } from '../live';
import {
  AUTO_LIST, LIMITTYPES, MONEY_CODE_REASONS, RUNNABLE, PHASE_MAP,
  loadDeals, loadCards, loadMoneyCodePreview,
  type Automation, type Deal, type Card, type InvRow,
  type DonePayload, type Addr, type UnitDriverForm, type MoneyCodeForm,
} from '../autoLive';
import { runAutomation } from '../autoRunners';
import { AutoInvoicesPanel, AutoTransactionsPanel } from '../AutoResultPanels';
import { AutoCatalog } from '../AutoCatalog';
import { AutoFloatingDrop } from '../AutoFloatingDrop';
import { AutoWexPanel } from '../AutoWexPanel';
import { TXN_RANGE_PRESETS, type TxnReportState } from '../txnReport';

type Step = 'config' | 'running' | 'done';
type LimitDir = 'increase' | 'decrease';

const DEPT_COL: Record<string, string> = { C: 'var(--orange)', Q: 'var(--accent)', V: 'var(--ok)', M: 'var(--violet)' };
const cardCol: Record<string, string> = { active: 'var(--ok)', fraud: 'var(--danger)', inactive: 'var(--muted)' };
const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
/** Surface (not alt) — light-mode picklists stay clean white, not grey wash. */
const inp42 = 'width:100%;height:42px;padding:0 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const inp44 = 'width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const pickLabelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';
const dropMsg = 'padding:14px;font-size:12.5px;color:var(--muted);text-align:center';
const dropErr = 'padding:14px;font-size:12.5px;color:var(--danger);text-align:center';
const dropRow = 'padding:12px 15px;cursor:pointer;border-bottom:1px solid var(--border2);background:var(--surface)';
const noteWarn = 'padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);font-size:12.5px;color:var(--text2);line-height:1.5';
const noteErr = 'padding:12px 14px;border-radius:11px;background:color-mix(in srgb,var(--danger) 12%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);font-size:12.5px;color:var(--danger);line-height:1.5';
const mono = "font-family:'JetBrains Mono',monospace";
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
  `flex:1;padding:9px;border-radius:9px;border:1px solid ${on ? col : 'var(--border)'};background:${on ? `color-mix(in srgb,${col} 16%,transparent)` : 'var(--surface)'};color:${on ? col : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;transition:all .14s`;
const btnP = (extra: string): string => `border:none;background:${grad};color:#fff;font-weight:700;cursor:pointer;${extra}`;
function Lbl({ t }: { t: string }) { return <div style={s(labelCss)}>{t}</div>; }
const closeX16 = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const UD0: UnitDriverForm = { unitNumber: '', driverName: '', driverId: '' };
const MC0: MoneyCodeForm = { amount: '', reason: MONEY_CODE_REASONS[0], unitNumber: '' };

export function AutoTab() {
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
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoPhase, setAutoPhase] = useState('');
  const [autoResult, setAutoResult] = useState<DonePayload | null>(null);
  const [autoAddr, setAutoAddr] = useState<Addr>({ address: '', city: '', state: '', zip: '' });
  const [autoNote, setAutoNote] = useState('');
  const [autoDue, setAutoDue] = useState('');
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
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dealInputRef = useRef<HTMLInputElement | null>(null);
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { clearInterval(progTimer.current); clearTimeout(fetchTimer.current); }, []);

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

  const openAuto = (a: Automation): void => {
    if (a.soon) return;
    setAutoModal(a); setAutoStep('config'); setAutoDeal(null); setAutoCard(null);
    setAutoDealQuery(''); setAutoShowDrop(false); setAutoCardQuery(''); setAutoShowCardDrop(false);
    setAutoLimitType(LIMITTYPES[0].value); setAutoLimitValue(''); setAutoLimitDir('increase');
    setAutoProgress(0); setAutoPhase(''); setAutoResult(null); setAutoRunErr(null);
    setInvRows([]); setTxnReport(null); setUnitDriver(UD0); setMoneyForm(MC0);
    setAutoAddr({ address: '', city: '', state: '', zip: '' }); setAutoNote(''); setAutoDue('');
    // WEX search state lives in <AutoWexPanel/>, which remounts per modal open.
  };
  const closeAuto = (): void => { if (autoStep === 'running') return; clearInterval(progTimer.current); setAutoModal(null); };
  const setDealQuery = (v: string): void => { setAutoDealQuery(v); setAutoShowDrop(true); };
  const selectDeal = (d: Deal): void => { setAutoDeal(d); setAutoShowDrop(false); setAutoDealQuery(''); setAutoCard(null); };
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
    setAutoStep('config'); setAutoProgress(0); setAutoResult(null); setAutoCard(null);
    setAutoRunErr(null); setInvRows([]); setTxnReport(null);
  };

  const runAuto = (): void => {
    const bm = autoModal;
    if (!bm) return;
    setAutoRunErr(null); setAutoResult(null); setAutoStep('running'); setTxnReport(null);
    const phases = PHASE_MAP[bm.kind ?? ''] ?? ['Working…', 'Finishing…'];
    let p = 6; setAutoProgress(6); setAutoPhase(phases[0] ?? 'Working…');
    clearInterval(progTimer.current);
    progTimer.current = setInterval(() => {
      p = Math.min(92, p + (3 + Math.random() * 6));
      const idx = Math.min(phases.length - 1, Math.floor((p / 100) * phases.length));
      setAutoProgress(Math.round(p)); setAutoPhase(phases[idx] ?? '');
    }, 160);
    runAutomation({
      action: bm, deal: autoDeal, card: autoCard,
      invRange: autoInvRange, invStatus: autoInvStatus,
      invFrom: autoInvFrom, invTo: autoInvTo,
      txnRange: autoTxnRange, txnFrom: autoTxnFrom, txnTo: autoTxnTo,
      limitId: autoLimitType, limitValue: autoLimitValue, limitDir: autoLimitDir,
      addr: autoAddr, note: autoNote, due: autoDue, unitDriver, moneyCode: moneyForm,
      setInvRows, setTxnReport,
    })
      .then((payload) => {
        clearInterval(progTimer.current); setAutoProgress(100); setAutoResult(payload);
        fetchTimer.current = setTimeout(() => setAutoStep('done'), 240);
        if (payload.kind === 'link') window.open(payload.url, '_blank', 'noopener');
        logAutomation(bm.id);
      })
      .catch((e: unknown) => {
        clearInterval(progTimer.current); setAutoProgress(0);
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
  const canRun = !unavailable && (
    kind === 'link' ? true
      : kind === 'invoices' || kind === 'transactions' || kind === 'simple' || kind === 'wex-tasks' ? hasDeal
        : kind === 'money' ? hasDeal && moneyReady
          : kind === 'card' ? hasCard && (!b?.limits || autoLimitValue.length > 0) && unitReady
            : kind === 'form' || kind === 'ticket' ? hasDeal && addrReady
              : false);
  const runVerb = kind === 'invoices' ? 'Get Invoices' : kind === 'transactions' ? 'Fetch Transactions' : b?.verb || 'Submit';
  const successMsg = autoResult?.kind === 'message' ? autoResult.message
    : autoResult?.kind === 'link' ? autoResult.label
      : `${runVerb} completed for ${autoDeal?.name ?? 'the selected client'}.`;
  const autoCardDisplay = autoCard ? `•••• ${autoCard.number.slice(-4)}` : '';
  const autoCardBadge: BadgeVM = autoCard ? badge(autoCard.status.toUpperCase(), cardCol[autoCard.status] ?? 'var(--muted)') : { text: '', style: '' };
  const autoResultInvoices = autoResult?.kind === 'invoices';
  const autoResultTxn = autoResult?.kind === 'transactions';
  const autoResultTable = autoResult?.kind === 'table' ? autoResult : null;
  const autoIsResultTable = autoResultInvoices || autoResultTxn || !!autoResultTable;
  const modalMaxW = autoStep === 'done' && (autoResultTxn || autoResultInvoices) ? '820px' : '640px';
  const bodyTxnSplit = autoStep === 'done' && autoResultTxn;

  return (
    <>
      <div className="ss-fu">
        <div style={s('margin-bottom:16px')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Self-Service Actions</div>
          <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>Handle Customer Service, Billing &amp; Verification yourself — no ticket needed. <strong style={s('color:var(--text2)')}>{String(autoCatalog.length)}</strong> actions available.</div>
        </div>
        <div style={s('position:relative;margin-bottom:18px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input value={autoSearch} onChange={(e) => setAutoSearch(e.target.value)} placeholder="Search by name, code (e.g. C-16), or keyword…" className="ss-in" style={s('width:100%;height:46px;padding:0 44px;border-radius:13px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
          {autoSearch && <button onClick={() => setAutoSearch('')} aria-label="Clear" className="ss-ico-btn" style={s('position:absolute;right:11px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:7px;border:none;background:var(--alt);color:var(--muted);cursor:pointer')}>✕</button>}
        </div>
        <AutoCatalog items={autoCatalog} onOpen={openAuto} />
      </div>

      {b && (
        <div onClick={closeAuto} style={s('position:fixed;inset:0;z-index:115;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
          <div onClick={(e) => e.stopPropagation()} style={s(`width:100%;max-width:${modalMaxW};max-height:88vh;display:flex;flex-direction:column;border-radius:24px;background:var(--surface);border:1px solid var(--border);box-shadow:0 24px 48px rgba(0,0,0,0.2);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
            <div style={s('flex-shrink:0;padding:24px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:16px;background:linear-gradient(180deg,rgba(var(--accent-rgb),0.03),transparent)')}>
              <div style={s(iconBox(DEPT_COL[b.dept] ?? 'var(--accent)', 48))}>
                <Svg d={b.icon} size={22} strokeWidth={1.75} />
              </div>
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:20px;letter-spacing:.03em;text-transform:uppercase;color:var(--text)')}>{b.title}</div>
                <div style={s('display:flex;gap:6px;margin-top:6px;flex-wrap:wrap')}>{b.codes.map((c) => <span key={c} style={s(deptStyle(c))}>{c}</span>)}</div>
                <div style={s('font-size:13px;color:var(--muted);margin-top:8px;line-height:1.5')}>{b.desc}</div>
              </div>
              <button onClick={closeAuto} aria-label="Close" className="ss-ico-btn" style={s('width:36px;height:36px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background .15s')}>{closeX16}</button>
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
                    <div style={s('padding:14px 16px;border-radius:12px;background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:12.5px;color:var(--text2);line-height:1.5')}>Opens the WEX EFS eManager credentials guide PDF in a new tab.</div>
                  )}

                  {needsDeal && (
                    <div>
                      <div style={s(pickLabelCss)}>Select Deal</div>
                      {autoDeal ? (
                        <div style={s('display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:linear-gradient(120deg,rgba(var(--accent-rgb),.08),transparent);border:1px solid var(--border)')}>
                          <div style={s('flex:1;min-width:0')}>
                            <div style={s('font-size:13.5px;font-weight:700')}>{autoDeal.name}</div>
                            <div style={s(`font-size:11.5px;color:var(--muted);margin-top:4px;${mono}`)}>{autoDeal.company} · App {autoDeal.app} · {autoDeal.carrier || 'no carrier'}</div>
                          </div>
                          <button onClick={clearDeal} aria-label="Clear deal" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer')}>✕</button>
                        </div>
                      ) : (
                        <div>
                          <input
                            ref={dealInputRef}
                            value={autoDealQuery}
                            onChange={(e) => setDealQuery(e.target.value)}
                            onFocus={() => setAutoShowDrop(true)}
                            placeholder="Search by name, company, app ID, carrier or phone…"
                            className="ss-in"
                            style={s(inp44)}
                          />
                          <AutoFloatingDrop open={autoShowDrop} anchorRef={dealInputRef} maxHeight={230} onClose={() => setAutoShowDrop(false)}>
                            {dealsLoad.loading && <div style={s(dropMsg)}>Loading clients…</div>}
                            {dealsLoad.error && <div style={s(dropErr)}>{dealsLoad.error}</div>}
                            {!dealsLoad.loading && !dealsLoad.error && filteredDeals.map((d) => (
                              <div key={d.id} onMouseDown={() => selectDeal(d)} className="ss-row-h" style={s(dropRow)}>
                                <div style={s('font-size:13px;font-weight:700')}>{d.name}</div>
                                <div style={s(`font-size:11px;color:var(--muted);margin-top:3px;${mono}`)}>{d.company} · App {d.app} · {d.phone}</div>
                              </div>
                            ))}
                            {!dealsLoad.loading && !dealsLoad.error && filteredDeals.length === 0 && autoDealQuery.length > 0 && <div style={s(dropMsg)}>No matching deals</div>}
                          </AutoFloatingDrop>
                        </div>
                      )}
                    </div>
                  )}

                  {needsCard && (
                    <div>
                      <div style={s(pickLabelCss)}>Select Card</div>
                      {autoCard ? (
                        <div style={s('display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:var(--surface);border:1px solid var(--border)')}>
                          <span style={s(`${mono};font-size:14px;font-weight:600;letter-spacing:.06em`)}>{autoCardDisplay}</span>
                          <Badge vm={autoCardBadge} />
                          <div style={s('flex:1')}></div>
                          <button onClick={clearCard} aria-label="Clear card" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer')}>✕</button>
                        </div>
                      ) : (
                        <div>
                          <input
                            ref={cardInputRef}
                            value={autoCardQuery}
                            onChange={(e) => setCardQuery(e.target.value)}
                            onFocus={() => setAutoShowCardDrop(true)}
                            placeholder="Search card number…"
                            className="ss-in"
                            style={s(inp44)}
                          />
                          <AutoFloatingDrop open={autoShowCardDrop} anchorRef={cardInputRef} maxHeight={220} onClose={() => setAutoShowCardDrop(false)}>
                            {cardsLoad.loading && <div style={s(dropMsg)}>Loading cards…</div>}
                            {cardsLoad.error && <div style={s(dropErr)}>{cardsLoad.error}</div>}
                            {!cardsLoad.loading && !cardsLoad.error && filteredCards.map((c) => (
                              <div key={c.id} onMouseDown={() => selectCard(c)} className="ss-row-h" style={s(`display:flex;align-items:center;gap:10px;${dropRow}`)}>
                                <span style={s(`${mono};font-size:13px;font-weight:600`)}>{`•••• ${c.number.slice(-4)}`}</span>
                                <Badge vm={badge(c.status.toUpperCase(), cardCol[c.status] ?? 'var(--muted)')} />
                                <span style={s('font-size:11px;color:var(--muted);margin-left:auto')}>{`${c.driver || 'No driver'} · Unit ${c.unit || '—'}`}</span>
                              </div>
                            ))}
                            {!cardsLoad.loading && !cardsLoad.error && filteredCards.length === 0 && <div style={s(dropMsg)}>No matching cards</div>}
                          </AutoFloatingDrop>
                        </div>
                      )}
                    </div>
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
                        <div><Lbl t="New Value" /><input value={autoLimitValue} onChange={(e) => setAutoLimitValue(e.target.value)} type="number" placeholder="e.g. 2500" className="ss-in" style={s(inp42)} /></div>
                      </div>
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
                      {mcPreviewLoading && <div style={s(dropMsg)}>Checking eligibility…</div>}
                      {mcPreviewErr && <div style={s(noteErr)}>{mcPreviewErr}</div>}
                      {mcPreview && (
                        <div style={s(`padding:14px 16px;border-radius:12px;background:${mcPreview.eligible ? 'rgba(var(--accent-rgb),.08)' : 'color-mix(in srgb,var(--warn) 12%,transparent)'};border:1px solid ${mcPreview.eligible ? 'rgba(var(--accent-rgb),.2)' : 'color-mix(in srgb,var(--warn) 30%,transparent)'};font-size:12.5px;color:var(--text2);line-height:1.5`)}>
                          {mcPreview.eligible
                            ? <>Eligible — <strong style={s('color:var(--text)')}>{money(mcPreview.available)}</strong> available of a {money(mcPreview.credit_limit)} line{mcPreview.billing_cycle_label ? ` (${mcPreview.billing_cycle_label})` : ''}.</>
                            : <>Not eligible right now{mcPreview.available != null ? ` — ${money(mcPreview.available)} available` : ''}.</>}
                        </div>
                      )}
                      {mcPreview?.eligible && (
                        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                          <div><Lbl t="Amount" /><input value={moneyForm.amount} onChange={(e) => setMc('amount', e.target.value)} type="number" placeholder="e.g. 150" className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="Unit #" /><input value={moneyForm.unitNumber} onChange={(e) => setMc('unitNumber', e.target.value)} placeholder="Unit" className="ss-in" style={s(inp42)} /></div>
                          <div style={s('grid-column:1 / -1')}><Lbl t="Reason" /><select value={moneyForm.reason} onChange={(e) => setMc('reason', e.target.value)} className="ss-in" style={s(inp42)}>{MONEY_CODE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
                        </div>
                      )}
                    </div>
                  )}

                  {(kind === 'form' || kind === 'ticket') && hasDeal && b.id !== 'card-replacement' && (
                    <div style={s('display:flex;flex-direction:column;gap:14px')}>
                      {kind === 'form' && (
                        <>
                          <div><div style={s(labelCss)}>Due Date <span style={s('font-weight:400;text-transform:none')}>(optional)</span></div><input value={autoDue} onChange={(e) => setAutoDue(e.target.value)} type="date" className="ss-in" style={s(inp42)} /></div>
                          <div><Lbl t="Note" /><textarea value={autoNote} onChange={(e) => setAutoNote(e.target.value)} placeholder="Add a note for the team…" className="ss-in" style={s('width:100%;min-height:74px;padding:11px 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;resize:vertical')}></textarea></div>
                        </>
                      )}
                      {kind === 'ticket' && b.id === 'reactivation' && (
                        <div><Lbl t="Note" /><textarea value={autoNote} onChange={(e) => setAutoNote(e.target.value)} placeholder="Why reactivate?" className="ss-in" style={s('width:100%;min-height:74px;padding:11px 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;resize:vertical')}></textarea></div>
                      )}
                      <div style={s(noteWarn)}>This files a Customer Service ticket with the matching type code — same outcome as the Create tab, without leaving Automations.</div>
                    </div>
                  )}

                  {b.id === 'card-replacement' && hasDeal && (
                    <div>
                      <div style={s('font-size:12.5px;color:var(--text2);margin-bottom:12px')}>Confirm the shipping address for the replacement cards.</div>
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
                    <div style={s('padding:14px 16px;border-radius:12px;background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:12.5px;color:var(--text2);line-height:1.5')}><strong style={s('color:var(--text)')}>Ready.</strong> This will run against <strong style={s('color:var(--text)')}>{autoDeal?.name}</strong> and return an instant result.</div>
                  )}

                  {kind !== 'search' && (
                    <div style={s('display:flex;flex-direction:column;gap:12px;padding-top:2px')}>
                      {unavailable && <div style={s(noteWarn)}>This action isn&apos;t available for self-service yet — file a ticket and the team will handle it.</div>}
                      <div style={s('display:flex;justify-content:flex-end')}>
                        {canRun
                          ? <button onClick={runAuto} className="ss-btn-p" style={s(btnP('height:44px;padding:0 24px;border-radius:12px;font-size:13.5px;box-shadow:0 6px 18px rgba(var(--accent-rgb),.35)'))}>{runVerb}</button>
                          : <button disabled style={s('height:44px;padding:0 24px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13.5px;cursor:not-allowed')}>{runVerb}</button>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {autoStep === 'running' && (
                <div style={s('padding:40px 20px;display:flex;flex-direction:column;align-items:center;text-align:center')}>
                  <div style={s('position:relative;width:64px;height:64px;margin-bottom:24px')}>
                    <div style={s('position:absolute;inset:0;border-radius:50%;border:3px solid var(--border);opacity:0.5')}></div>
                    <div style={s('position:absolute;inset:0;border-radius:50%;border:3px solid transparent;border-top-color:var(--accent);animation:ss-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite')}></div>
                    <div style={s(`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${mono};font-size:13px;font-weight:700;color:var(--accent)`)}>{autoProgress}%</div>
                  </div>
                  <div style={s('font-family:Rajdhani,sans-serif;font-size:20px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;margin-bottom:6px')}>{autoPhase}</div>
                  <div style={s('font-size:13px;color:var(--muted);max-width:280px;line-height:1.5')}>Keep this window open. Closing now loses task status.</div>
                  <div style={s('width:100%;max-width:320px;height:6px;border-radius:99px;background:var(--raised);overflow:hidden;margin-top:24px')}>
                    <div style={s(`height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:${autoProgress}%;transition:width .2s ease-out`)}></div>
                  </div>
                </div>
              )}

              {autoStep === 'done' && (autoRunErr ? (
                <div style={s('text-align:center;padding:32px 10px')}>
                  <div style={s('width:64px;height:64px;border-radius:50%;background:color-mix(in srgb,var(--danger) 12%,transparent);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;color:var(--danger);box-shadow:0 0 0 8px color-mix(in srgb,var(--danger) 4%,transparent)')}>
                    <Svg d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={32} strokeWidth={2.2} />
                  </div>
                  <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;text-transform:uppercase;letter-spacing:.03em;color:var(--text)')}>{`${runVerb} Failed`}</div>
                  <div style={s('font-size:14px;color:var(--text2);margin-top:10px;max-width:360px;margin-left:auto;margin-right:auto;line-height:1.6')}>{autoRunErr}</div>
                  <div style={s('display:flex;justify-content:center;gap:12px;margin-top:28px')}>
                    <button onClick={resetAuto} className="ss-btn-p" style={s(btnP('height:44px;padding:0 24px;border-radius:12px;font-size:13.5px;box-shadow:0 4px 12px rgba(var(--accent-rgb),.2)'))}>Try again</button>
                  </div>
                </div>
              ) : autoIsResultTable ? (
                <div style={s(bodyTxnSplit ? 'flex:1;min-height:0;display:flex;flex-direction:column;gap:14px' : '')}>
                  {autoResultInvoices && <AutoInvoicesPanel rows={invRows} />}
                  {autoResultTxn && (
                    <AutoTransactionsPanel report={txnReport} splitLayout />
                  )}
                  {autoResultTable && (
                    <div style={s('border-radius:13px;border:1px solid var(--border);overflow:hidden')}>
                      <div style={s('padding:11px 15px;background:var(--alt);font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>{autoResultTable.title}</div>
                      <div style={s(`display:grid;grid-template-columns:repeat(${autoResultTable.columns.length},1fr);gap:8px;padding:10px 15px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--border2)`)}>
                        {autoResultTable.columns.map((c) => <span key={c}>{c}</span>)}
                      </div>
                      {autoResultTable.rows.map((row, i) => (
                        <div key={i} className="ss-row-h" style={s(`display:grid;grid-template-columns:repeat(${autoResultTable.columns.length},1fr);gap:8px;padding:12px 15px;border-top:1px solid var(--border2);font-size:12.5px`)}>
                          {row.map((cell, j) => <span key={j} style={s(j === 0 ? mono : 'color:var(--text2)')}>{cell}</span>)}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={s(`display:flex;justify-content:flex-end;gap:10px;${bodyTxnSplit ? 'flex-shrink:0;padding-top:4px' : 'margin-top:18px'}`)}>
                    <button onClick={resetAuto} className="ss-ico-btn" style={s('height:42px;padding:0 18px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>↩ Run another</button>
                    <button onClick={closeAuto} className="ss-btn-p" style={s(btnP('height:42px;padding:0 22px;border-radius:11px;font-size:12.5px'))}>Done</button>
                  </div>
                </div>
              ) : (
                <div style={s('text-align:center;padding:32px 10px')}>
                  <div style={s('width:64px;height:64px;border-radius:50%;background:color-mix(in srgb,var(--ok) 12%,transparent);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;color:var(--ok);box-shadow:0 0 0 8px color-mix(in srgb,var(--ok) 4%,transparent)')}>
                    <Svg d="M20 6L9 17l-5-5" size={32} strokeWidth={2.5} />
                  </div>
                  <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;text-transform:uppercase;letter-spacing:.03em;color:var(--text)')}>{`${runVerb} complete`}</div>
                  <div style={s('font-size:14px;color:var(--text2);margin-top:10px;max-width:360px;margin-left:auto;margin-right:auto;line-height:1.6')}>{successMsg}</div>
                  <div style={s('display:flex;justify-content:center;gap:12px;margin-top:28px')}>
                    <button onClick={resetAuto} className="ss-ico-btn" style={s('height:44px;padding:0 20px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:13.5px;cursor:pointer;transition:background .15s')}>Run another</button>
                    <button onClick={closeAuto} className="ss-btn-p" style={s(btnP('height:44px;padding:0 28px;border-radius:12px;font-size:13.5px;box-shadow:0 4px 12px rgba(var(--accent-rgb),.2)'))}>Done</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
