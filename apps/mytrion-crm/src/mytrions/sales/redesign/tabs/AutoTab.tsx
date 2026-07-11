/**
 * Automations tab — Sales Mytrion redesign. Self-service catalog over the (static) AUTOMATIONS
 * action catalog: search box + dept-colored card grid, then a multi-variant runner modal (WEX
 * search, deal/card pickers, limit fields, invoice / transaction filters, address / note forms).
 * LIVE data: the deal picker searches the agent's real clients (clients.by_agent), the card picker
 * lists live cards (dwh.cards / efs.cards), and RUN dispatches the matching touchpoint per action
 * (balance→dwh.carrier_balance, transactions→dwh.transactions, invoices→sales_mytrion.fetch_invoices,
 * money-code→dwh.money_code, card actions→cards.status / cards.limits / efs.card_override, verify→
 * dwh.carrier_overview, wex→wex.application), rendering the returned rows in the existing markup and
 * firing pushToast + logAutomation. Actions with no self-service touchpoint show a "not available"
 * note (no fake result). View-model / JSX preserved from the reference prototype.
 */
import { useEffect, useRef, useState } from 'react';
import { s, Svg, Badge } from '../dc';
import { badge, deptStyle, iconBox, type BadgeVM } from '../salesData';
import { callTouchpoint, logAutomation } from '@/api/touchpoints';
import { getSession } from '@/api/session';
import { useLoad, money } from '../live';
import { useSales } from '../ctx';
import {
  AUTO_LIST, LIMITTYPES, RUNNABLE, PHASE_MAP,
  loadDeals, loadCards, mapWex,
  str, gal, shortCard, fmtDate, titleStatus, mapInvRange, daysWindow,
  type Automation, type Deal, type Card, type WexResult, type InvRow, type TxnRow, type DonePayload,
} from '../autoLive';

// ---------- local UI types ----------

interface Addr { address: string; city: string; state: string; zip: string; }
interface WexQ { appId: string; last: string; mc: string; }
type Step = 'config' | 'running' | 'done';
type LimitDir = 'increase' | 'decrease';

// ---------- constants / pure helpers (from renderVals) ----------

const DEPT_COL: Record<string, string> = { C: 'var(--orange)', Q: 'var(--accent)', V: 'var(--ok)', M: 'var(--violet)' };
const cardCol: Record<string, string> = { active: 'var(--ok)', fraud: 'var(--danger)', inactive: 'var(--muted)' };
const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
const inp40 = 'width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px';
const inp42 = 'width:100%;height:42px;padding:0 12px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px';
const inp44 = 'width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const pickLabelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';
const dropCss = 'position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:5;border-radius:12px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);overflow:hidden';
const dropMsg = 'padding:14px;font-size:12.5px;color:var(--muted);text-align:center';
const dropErr = 'padding:14px;font-size:12.5px;color:var(--danger);text-align:center';
const noteWarn = 'padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);font-size:12.5px;color:var(--text2);line-height:1.5';
const noteErr = 'padding:12px 14px;border-radius:11px;background:color-mix(in srgb,var(--danger) 12%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);font-size:12.5px;color:var(--danger);line-height:1.5';
const mono = "font-family:'JetBrains Mono',monospace";

const invRanges = ['Last 30 days', 'Last 90 days', 'This year', 'Custom range'];
const invStatuses = [{ value: 'all', label: 'All' }, { value: 'paid', label: 'Paid only' }, { value: 'overdue', label: 'Overdue only' }];
const txnRanges = [{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'custom', label: 'Custom range' }];
const skel8 = [1, 2, 3, 4, 5, 6, 7, 8];

const catalogCard = (soon: boolean): string =>
  `text-align:left;padding:17px;border-radius:15px;background:var(--surface);border:1px solid var(--border);cursor:${soon ? 'default' : 'pointer'};box-shadow:var(--shadow-sm);position:relative;overflow:hidden;opacity:${soon ? 0.55 : 1};width:100%;display:flex;flex-direction:column;gap:11px`;
const limitBtn = (on: boolean, col: string): string =>
  `flex:1;padding:9px;border-radius:9px;border:1px solid ${on ? col : 'var(--border)'};background:${on ? `color-mix(in srgb,${col} 16%,transparent)` : 'var(--alt)'};color:${on ? col : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;transition:all .14s`;
const btnP = (extra: string): string => `border:none;background:${grad};color:#fff;font-weight:700;cursor:pointer;${extra}`;

function Lbl({ t }: { t: string }) { return <div style={s(labelCss)}>{t}</div>; }

const closeX16 = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

export function AutoTab() {
  const { pushToast } = useSales();

  // ---------- local state (reference auto* / wex* state) ----------
  const [autoSearch, setAutoSearch] = useState('');
  const [autoModal, setAutoModal] = useState<Automation | null>(null);
  const [autoStep, setAutoStep] = useState<Step>('config');
  const [autoDeal, setAutoDeal] = useState<Deal | null>(null);
  const [autoCard, setAutoCard] = useState<Card | null>(null);
  const [autoDealQuery, setAutoDealQuery] = useState('');
  const [autoShowDrop, setAutoShowDrop] = useState(false);
  const [autoCardQuery, setAutoCardQuery] = useState('');
  const [autoShowCardDrop, setAutoShowCardDrop] = useState(false);
  const [autoLimitType, setAutoLimitType] = useState<string>(LIMITTYPES[0]);
  const [autoLimitValue, setAutoLimitValue] = useState('');
  const [autoLimitDir, setAutoLimitDir] = useState<LimitDir>('increase');
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoPhase, setAutoPhase] = useState('');
  const [autoResult, setAutoResult] = useState<DonePayload | null>(null);
  const [autoAddr, setAutoAddr] = useState<Addr>({ address: '', city: '', state: '', zip: '' });
  const [autoNote, setAutoNote] = useState('');
  const [autoDue, setAutoDue] = useState('');
  const [autoInvStatus, setAutoInvStatus] = useState('all');
  const [autoInvRange, setAutoInvRange] = useState('Last 30 days');
  const [autoTxnRange, setAutoTxnRange] = useState('30');
  const [autoRunErr, setAutoRunErr] = useState<string | null>(null);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [txnRows, setTxnRows] = useState<TxnRow[]>([]);
  const [wexQ, setWexQ] = useState<WexQ>({ appId: '', last: '', mc: '' });
  const [wexSearching, setWexSearching] = useState(false);
  const [wexResults, setWexResults] = useState<readonly WexResult[] | null>(null);
  const [wexErr, setWexErr] = useState<string | null>(null);

  const progTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearInterval(progTimer.current); clearTimeout(fetchTimer.current); }, []);

  // ---------- live data (real clients + cards) ----------
  const dealsLoad = useLoad(loadDeals, []);
  const DEAL_LIST = dealsLoad.data ?? [];
  const cardCarrier = autoModal?.kind === 'card' && autoDeal ? autoDeal.carrier : '';
  const cardsLoad = useLoad(() => (cardCarrier ? loadCards(cardCarrier) : Promise.resolve<Card[]>([])), [cardCarrier]);
  const CARD_LIST = cardsLoad.data ?? [];

  // ---------- handlers (reference auto* methods) ----------
  const openAuto = (a: Automation): void => {
    if (a.soon) return;
    setAutoModal(a); setAutoStep('config'); setAutoDeal(null); setAutoCard(null);
    setAutoDealQuery(''); setAutoShowDrop(false); setAutoCardQuery(''); setAutoShowCardDrop(false);
    setAutoLimitType(LIMITTYPES[0]); setAutoLimitValue(''); setAutoLimitDir('increase');
    setAutoProgress(0); setAutoPhase(''); setAutoResult(null); setAutoRunErr(null);
    setInvRows([]); setTxnRows([]);
    setAutoAddr({ address: '', city: '', state: '', zip: '' }); setAutoNote(''); setAutoDue('');
    setWexQ({ appId: '', last: '', mc: '' }); setWexSearching(false); setWexResults(null); setWexErr(null);
  };
  const closeAuto = (): void => { if (autoStep === 'running') return; clearInterval(progTimer.current); setAutoModal(null); };
  const setDealQuery = (v: string): void => { setAutoDealQuery(v); setAutoShowDrop(true); };
  const selectDeal = (d: Deal): void => { setAutoDeal(d); setAutoShowDrop(false); setAutoDealQuery(''); };
  const clearDeal = (): void => { setAutoDeal(null); setAutoCard(null); };
  const setCardQuery = (v: string): void => { setAutoCardQuery(v); setAutoShowCardDrop(true); };
  const selectCard = (c: Card): void => { setAutoCard(c); setAutoShowCardDrop(false); setAutoCardQuery(''); };
  const clearCard = (): void => setAutoCard(null);
  const setAddr = (k: keyof Addr, v: string): void => setAutoAddr((a) => ({ ...a, [k]: v }));
  const setWexField = (k: keyof WexQ, v: string): void => setWexQ((q) => ({ ...q, [k]: v }));
  const downloadAuto = (): void => pushToast('Download started', 'Your file is being prepared');
  const runWex = (): void => {
    const appId = wexQ.appId.trim();
    setWexResults(null); setWexErr(null);
    if (!appId) { setWexErr("Enter an Application ID — name / MC-only search isn't available."); return; }
    setWexSearching(true);
    callTouchpoint('wex.application', { appId })
      .then((res) => { if (!res || res.found === false) setWexResults([]); else setWexResults([mapWex(res, appId)]); })
      .catch((e: unknown) => { setWexErr(e instanceof Error ? e.message : 'Search failed.'); setWexResults([]); })
      .finally(() => setWexSearching(false));
  };
  const resetAuto = (): void => {
    setAutoStep('config'); setAutoProgress(0); setAutoResult(null); setAutoCard(null);
    setAutoRunErr(null); setInvRows([]); setTxnRows([]);
  };

  const carrierIdOf = (): string => {
    const c = autoDeal?.carrier?.trim();
    if (!c) throw new Error('This client has no carrier id yet — pick a converted client.');
    return c;
  };

  const runTouchpoint = async (bm: Automation): Promise<DonePayload> => {
    const cid = carrierIdOf();
    const card = autoCard?.number ?? '';
    switch (bm.id) {
      case 'invoices': {
        const res = await callTouchpoint('sales_mytrion.fetch_invoices', {
          carrierId: cid, range: mapInvRange(autoInvRange),
          ...(autoInvStatus !== 'all' ? { status: autoInvStatus } : {}),
        });
        setInvRows((res.data ?? []).map((inv, i) => {
          const r = inv as Record<string, unknown>;
          return {
            inv: str(r.invoice_ref ?? r.invoice_number ?? r.invoice_id ?? r.id) || `INV-${i + 1}`,
            date: fmtDate(r.period ?? r.created_date ?? r.createdDate ?? r.invoice_date),
            amount: money(r.total_amount ?? r.amount),
            status: titleStatus(r.status),
          };
        }));
        return { kind: 'invoices' };
      }
      case 'transactions': {
        const { from, to } = daysWindow(autoTxnRange);
        const res = await callTouchpoint('dwh.transactions', { carrierId: cid, range: 'custom', from, to, limit: 200 });
        setTxnRows((res.data ?? []).slice(0, 100).map((tx) => {
          const r = tx as Record<string, unknown>;
          return {
            date: fmtDate(r.transaction_date ?? r.date),
            card: shortCard(r.card_number),
            driver: str(r.driver_name ?? r.driver ?? r.location_name) || '—',
            gallons: gal(r.transaction_fuel_quantity ?? r.line_item_fuel_quantity ?? r.fuel_quantity),
            amount: money(r.net_total ?? r.line_item_amount ?? r.amount),
          };
        }));
        return { kind: 'transactions' };
      }
      case 'balance': {
        const bal = await callTouchpoint('dwh.carrier_balance', { carrierId: cid });
        const parts = [`available balance ${money(bal.efs_balance ?? bal.balance)}`];
        if (bal.credit_limit != null) parts.push(`on a ${money(bal.credit_limit)} line`);
        if (bal.credit_remaining != null) parts.push(`${money(bal.credit_remaining)} remaining`);
        if (bal.efs_error) parts.push(`(EFS: ${bal.efs_error})`);
        return { kind: 'message', message: `${str(bal.company_name) || 'This carrier'} — ${parts.join(', ')}.` };
      }
      case 'money-code': {
        const mc = await callTouchpoint('dwh.money_code', { carrierId: cid });
        const msg = mc.eligible
          ? `eligible — ${money(mc.available)} available of a ${money(mc.credit_limit)} line${mc.billing_cycle_label ? ` (${mc.billing_cycle_label})` : ''}.`
          : `not eligible for a money code right now${mc.available != null ? ` — ${money(mc.available)} available.` : '.'}`;
        return { kind: 'message', message: `${str(mc.company_name) || 'This carrier'} is ${msg}` };
      }
      case 'verification': {
        const ov = await callTouchpoint('dwh.carrier_overview', { carrierId: cid });
        return {
          kind: 'message',
          message: `${str(ov.company_name) || 'This carrier'}: account ${ov.is_active ? 'active' : 'inactive'}, ${ov.cards?.active_count ?? 0} active cards, open debt ${money(ov.cmp_debt?.total_debt ?? 0)}.`,
        };
      }
      case 'card-activation': {
        const res = await callTouchpoint('cards.status', { carrierId: cid, cardNumber: card, action: 'ACTIVATE' });
        return { kind: 'message', message: str(res.message) || `Card ${shortCard(card)} set to ${str(res.newStatus) || 'ACTIVE'}.` };
      }
      case 'limits-change': {
        const res = await callTouchpoint('cards.limits', {
          carrierId: cid, cardNumber: card, limitId: autoLimitType, limitValue: autoLimitValue,
          action: autoLimitDir === 'increase' ? 'INCREASE' : 'DECREASE',
        });
        return { kind: 'message', message: str(res.message) || `${autoLimitType} ${autoLimitDir}d to ${autoLimitValue} on card ${shortCard(card)}.` };
      }
      case 'fraud-hold-release': {
        const email = getSession()?.worker.email ?? '';
        if (!email) throw new Error('Your session has no email — the fraud team reply needs one.');
        await callTouchpoint('fraud.hold_release', {
          companyName: autoDeal?.name ?? '', carrierId: cid, agentEmail: email, cardNumber: card, ticketType: 'fraud_release',
        });
        return { kind: 'message', message: `Release request sent to the fraud team — they'll reply to ${email}.` };
      }
      case 'override-card': {
        const res = await callTouchpoint('efs.card_override', { carrierId: cid, cardNumber: card });
        return { kind: 'message', message: str(res.message) || `Card ${shortCard(card)} granted a temporary active window.` };
      }
      default:
        throw new Error('This action is not available for self-service.');
    }
  };

  const runAuto = (): void => {
    const bm = autoModal;
    if (!bm) return;
    setAutoRunErr(null); setAutoResult(null); setAutoStep('running');
    const phases = PHASE_MAP[bm.kind ?? ''] ?? ['Working…', 'Finishing…'];
    let p = 6; setAutoProgress(6); setAutoPhase(phases[0] ?? 'Working…');
    clearInterval(progTimer.current);
    progTimer.current = setInterval(() => {
      p = Math.min(92, p + (3 + Math.random() * 6));
      const idx = Math.min(phases.length - 1, Math.floor((p / 100) * phases.length));
      setAutoProgress(Math.round(p)); setAutoPhase(phases[idx] ?? '');
    }, 160);
    runTouchpoint(bm)
      .then((payload) => {
        clearInterval(progTimer.current); setAutoProgress(100); setAutoResult(payload);
        fetchTimer.current = setTimeout(() => setAutoStep('done'), 240);
        pushToast(`${bm.title} complete`, autoDeal ? `Ran for ${autoDeal.name}` : 'Done');
        logAutomation(bm.id);
      })
      .catch((e: unknown) => {
        clearInterval(progTimer.current); setAutoProgress(0);
        setAutoRunErr(e instanceof Error ? e.message : 'The action failed — try again.');
        setAutoStep('config');
      });
  };

  // ---------- view-model (mirrors renderVals) ----------
  const aq = autoSearch.toLowerCase();
  const autoCatalog = AUTO_LIST.filter((a) => !aq || `${a.title} ${a.desc} ${a.codes.join(' ')}`.toLowerCase().includes(aq));

  const b = autoModal;
  const kind = b?.kind;
  const hasDeal = !!autoDeal;
  const hasCard = !!autoCard;
  const dq = autoDealQuery.toLowerCase();
  const filteredDeals = DEAL_LIST.filter((d) => !dq || `${d.name} ${d.company} ${d.app} ${d.carrier} ${d.phone}`.toLowerCase().includes(dq));
  const cardPool = b?.id === 'fraud-hold-release' || b?.id === 'override-card' ? CARD_LIST.filter((c) => c.status === 'fraud') : CARD_LIST;
  const cq = autoCardQuery.toLowerCase();
  const filteredCards = cardPool.filter((c) => !cq || c.number.includes(cq));

  const needsDeal = !!kind && kind !== 'search';
  const needsCard = kind === 'card' && hasDeal;
  const isLimits = !!b?.limits && hasCard;
  const unavailable = !!b && kind !== 'search' && !RUNNABLE.has(b.id);
  const canRun = !unavailable && (
    kind === 'invoices' || kind === 'transactions' ? hasDeal
      : kind === 'card' ? hasCard && (!b?.limits || autoLimitValue.length > 0)
        : kind === 'form' || kind === 'simple' || kind === 'ticket' ? hasDeal
          : false);
  const runVerb = kind === 'invoices' ? 'Get Invoices' : kind === 'transactions' ? 'Fetch Transactions' : b?.verb || 'Submit';
  const successMsg = autoResult?.message ?? `${runVerb} completed for ${autoDeal?.name ?? 'the selected client'}.`;

  const autoCardDisplay = autoCard ? `•••• ${autoCard.number.slice(-4)}` : '';
  const autoCardBadge: BadgeVM = autoCard ? badge(autoCard.status.toUpperCase(), cardCol[autoCard.status] ?? 'var(--muted)') : { text: '', style: '' };
  const wexResultsVM = (wexResults ?? []).map((r) => ({ ...r, statusBadge: badge(r.group, r.group === 'Complete' ? 'var(--ok)' : 'var(--warn)') }));
  const wexShow = wexResults !== null && !wexSearching;
  const invRowsVM = invRows.map((r) => ({ ...r, statusBadge: badge(r.status, r.status === 'Paid' ? 'var(--ok)' : 'var(--danger)') }));
  const autoResultInvoices = autoResult?.kind === 'invoices';
  const autoResultTxn = autoResult?.kind === 'transactions';
  const autoIsResultTable = autoResultInvoices || autoResultTxn;

  // ---------- render ----------
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
        {autoCatalog.length === 0 && (
          <div style={s('text-align:center;padding:56px 20px;color:var(--muted)')}>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;text-transform:uppercase;color:var(--text)')}>No actions match your search</div>
            <div style={s('font-size:13px;margin-top:5px')}>Try a code like <strong style={s('color:var(--text2)')}>C-16</strong> or a keyword like <strong style={s('color:var(--text2)')}>fraud</strong>.</div>
          </div>
        )}
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
          {autoCatalog.map((a) => (
            <button key={a.id} onClick={() => openAuto(a)} className="ss-card-h" style={s(catalogCard(!!a.soon))}>
              <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
                <div style={s(iconBox(DEPT_COL[a.dept] ?? 'var(--accent)', 42))}><Svg d={a.icon} size={21} strokeWidth={1.8} /></div>
                {a.soon && <span style={s('font-size:9px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--muted)')}>SOON</span>}
              </div>
              <div>
                <div style={s('font-size:14px;font-weight:700')}>{a.title}</div>
                <div style={s('display:flex;gap:5px;margin-top:6px')}>{a.codes.map((c) => <span key={c} style={s(deptStyle(c))}>{c}</span>)}</div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:8px;line-height:1.45')}>{a.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {b && (
        <div onClick={closeAuto} style={s('position:fixed;inset:0;z-index:115;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
          <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;border-radius:20px;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
            <div style={s('flex-shrink:0;padding:20px 22px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px')}>
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;letter-spacing:.03em;text-transform:uppercase')}>{b.title}</div>
                <div style={s('display:flex;gap:6px;margin-top:7px')}>{b.codes.map((c) => <span key={c} style={s(deptStyle(c))}>{c}</span>)}</div>
                <div style={s('font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5')}>{b.desc}</div>
              </div>
              <button onClick={closeAuto} aria-label="Close" className="ss-ico-btn" style={s('width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>{closeX16}</button>
            </div>
            <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
              {autoStep === 'config' && (
                <div style={s('display:flex;flex-direction:column;gap:18px')}>
                  {kind === 'search' && (
                    <div>
                      <div style={s('font-size:12.5px;color:var(--text2);margin-bottom:12px')}>Search WEX applications directly. Enter an Application ID.</div>
                      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                        <div><Lbl t="Application ID" /><input value={wexQ.appId} onChange={(e) => setWexField('appId', e.target.value)} placeholder="e.g. 872228" className="ss-in" style={s(inp40)} /></div>
                        <div><Lbl t="Last Name" /><input value={wexQ.last} onChange={(e) => setWexField('last', e.target.value)} placeholder="e.g. Crossan" className="ss-in" style={s(inp40)} /></div>
                        <div><Lbl t="MC Number" /><input value={wexQ.mc} onChange={(e) => setWexField('mc', e.target.value)} placeholder="e.g. 285921" className="ss-in" style={s(inp40)} /></div>
                        <div style={s('display:flex;align-items:flex-end')}><button onClick={runWex} className="ss-btn-p" style={s(btnP('width:100%;height:40px;border-radius:10px;font-size:13px'))}>Search</button></div>
                      </div>
                      {wexSearching && (
                        <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>
                          {skel8.map((sk) => <div key={sk} style={s('display:flex;gap:10px;padding:13px;border-radius:11px;background:var(--alt);border:1px solid var(--border2)')}><div className="ss-skel" style={s('flex:1;height:14px')}></div><div className="ss-skel" style={s('width:60px;height:14px')}></div></div>)}
                        </div>
                      )}
                      {wexErr && <div style={s(`margin-top:16px;${dropErr}`)}>{wexErr}</div>}
                      {wexShow && wexResultsVM.length === 0 && !wexErr && <div style={s(`margin-top:16px;${dropMsg}`)}>No application found for that ID.</div>}
                      {wexShow && wexResultsVM.length > 0 && (
                        <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>
                          {wexResultsVM.map((r) => (
                            <div key={r.appId} className="ss-card-h" style={s('padding:13px 15px;border-radius:12px;background:var(--alt);border:1px solid var(--border);cursor:pointer')}>
                              <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px')}><span style={s('font-size:13.5px;font-weight:700')}>{r.company}</span><Badge vm={r.statusBadge} /></div>
                              <div style={s(`font-size:11.5px;color:var(--muted);margin-top:5px;${mono}`)}>App #{r.appId} · {r.contact} · {r.status}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {needsDeal && (
                    <div>
                      <div style={s(pickLabelCss)}>Select Deal</div>
                      {autoDeal ? (
                        <div style={s('display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:linear-gradient(120deg,rgba(var(--accent-rgb),.08),transparent);border:1px solid var(--border)')}>
                          <div style={s('flex:1;min-width:0')}>
                            <div style={s('font-size:13.5px;font-weight:700')}>{autoDeal.name}</div>
                            <div style={s(`font-size:11.5px;color:var(--muted);margin-top:4px;${mono}`)}>{autoDeal.company} · App {autoDeal.app} · {autoDeal.carrier}</div>
                          </div>
                          <button onClick={clearDeal} aria-label="Clear deal" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer')}>✕</button>
                        </div>
                      ) : (
                        <div style={s('position:relative')}>
                          <input value={autoDealQuery} onChange={(e) => setDealQuery(e.target.value)} onFocus={() => setAutoShowDrop(true)} placeholder="Search by name, company, app ID, carrier or phone…" className="ss-in" style={s(inp44)} />
                          {autoShowDrop && (
                            <div style={s(`${dropCss};max-height:230px;overflow-y:auto`)}>
                              {dealsLoad.loading && <div style={s(dropMsg)}>Loading clients…</div>}
                              {dealsLoad.error && <div style={s(dropErr)}>{dealsLoad.error}</div>}
                              {!dealsLoad.loading && !dealsLoad.error && filteredDeals.map((d) => (
                                <div key={d.id} onMouseDown={() => selectDeal(d)} className="ss-tab-x" style={s('padding:12px 15px;cursor:pointer;border-bottom:1px solid var(--border2)')}>
                                  <div style={s('font-size:13px;font-weight:700')}>{d.name}</div>
                                  <div style={s(`font-size:11px;color:var(--muted);margin-top:3px;${mono}`)}>{d.company} · App {d.app} · {d.phone}</div>
                                </div>
                              ))}
                              {!dealsLoad.loading && !dealsLoad.error && filteredDeals.length === 0 && autoDealQuery.length > 0 && <div style={s('padding:14px;font-size:12.5px;color:var(--muted);text-align:center')}>No matching deals</div>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {needsCard && (
                    <div>
                      <div style={s(pickLabelCss)}>Select Card</div>
                      {autoCard ? (
                        <div style={s('display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:var(--alt);border:1px solid var(--border)')}>
                          <span style={s(`${mono};font-size:14px;font-weight:600;letter-spacing:.06em`)}>{autoCardDisplay}</span>
                          <Badge vm={autoCardBadge} />
                          <div style={s('flex:1')}></div>
                          <button onClick={clearCard} aria-label="Clear card" className="ss-ico-btn" style={s('width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer')}>✕</button>
                        </div>
                      ) : (
                        <div style={s('position:relative')}>
                          <input value={autoCardQuery} onChange={(e) => setCardQuery(e.target.value)} onFocus={() => setAutoShowCardDrop(true)} placeholder="Search card number…" className="ss-in" style={s(inp44)} />
                          {autoShowCardDrop && (
                            <div style={s(`${dropCss};max-height:220px;overflow-y:auto`)}>
                              {cardsLoad.loading && <div style={s(dropMsg)}>Loading cards…</div>}
                              {cardsLoad.error && <div style={s(dropErr)}>{cardsLoad.error}</div>}
                              {!cardsLoad.loading && !cardsLoad.error && filteredCards.map((c) => (
                                <div key={c.id} onMouseDown={() => selectCard(c)} className="ss-tab-x" style={s('display:flex;align-items:center;gap:10px;padding:12px 15px;cursor:pointer;border-bottom:1px solid var(--border2)')}>
                                  <span style={s(`${mono};font-size:13px;font-weight:600`)}>{`•••• ${c.number.slice(-4)}`}</span>
                                  <Badge vm={badge(c.status.toUpperCase(), cardCol[c.status] ?? 'var(--muted)')} />
                                  <span style={s('font-size:11px;color:var(--muted);margin-left:auto')}>{`${c.driver || 'No driver'} · Unit ${c.unit || '—'}`}</span>
                                </div>
                              ))}
                              {!cardsLoad.loading && !cardsLoad.error && filteredCards.length === 0 && <div style={s('padding:14px;font-size:12.5px;color:var(--muted);text-align:center')}>No matching cards</div>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {isLimits && (
                    <div style={s('display:flex;flex-direction:column;gap:14px')}>
                      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                        <div><Lbl t="Limit Type" /><select value={autoLimitType} onChange={(e) => setAutoLimitType(e.target.value)} className="ss-in" style={s(inp42)}>{LIMITTYPES.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
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
                    <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                      <div><Lbl t="Date Range" /><select value={autoInvRange} onChange={(e) => setAutoInvRange(e.target.value)} className="ss-in" style={s(inp42)}>{invRanges.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
                      <div><Lbl t="Status" /><select value={autoInvStatus} onChange={(e) => setAutoInvStatus(e.target.value)} className="ss-in" style={s(inp42)}>{invStatuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                    </div>
                  )}

                  {kind === 'transactions' && (
                    <div><Lbl t="Date Range" /><select value={autoTxnRange} onChange={(e) => setAutoTxnRange(e.target.value)} className="ss-in" style={s(inp42)}>{txnRanges.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                  )}

                  {kind === 'form' && hasDeal && (
                    <div style={s('display:flex;flex-direction:column;gap:14px')}>
                      <div>
                        <Lbl t="Assigned To" />
                        <div style={s('display:flex;align-items:center;gap:9px;height:42px;padding:0 12px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font-size:13px')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s('color:var(--muted)')}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Application owner (locked)</div>
                      </div>
                      <div><div style={s(labelCss)}>Due Date <span style={s('font-weight:400;text-transform:none')}>(optional)</span></div><input value={autoDue} onChange={(e) => setAutoDue(e.target.value)} type="date" className="ss-in" style={s(inp42)} /></div>
                      <div><Lbl t="Note" /><textarea value={autoNote} onChange={(e) => setAutoNote(e.target.value)} placeholder="Add a note for the team…" className="ss-in" style={s('width:100%;min-height:74px;padding:11px 12px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px;resize:vertical')}></textarea></div>
                    </div>
                  )}

                  {b.id === 'card-replacement' && (
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

                  {kind === 'simple' && hasDeal && (
                    <div style={s('padding:14px 16px;border-radius:12px;background:rgba(var(--accent-rgb),.08);border:1px solid rgba(var(--accent-rgb),.2);font-size:12.5px;color:var(--text2);line-height:1.5')}><strong style={s('color:var(--text)')}>Ready.</strong> This will run against <strong style={s('color:var(--text)')}>{autoDeal?.name}</strong> and return an instant result — no ticket created.</div>
                  )}

                  {kind !== 'search' && (
                    <div style={s('display:flex;flex-direction:column;gap:12px;padding-top:2px')}>
                      {unavailable && <div style={s(noteWarn)}>This action isn&apos;t available for self-service yet — file a ticket and the team will handle it.</div>}
                      {autoRunErr && <div style={s(noteErr)}>{autoRunErr}</div>}
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
                <div style={s('padding:24px 4px')}>
                  <div style={s('display:flex;align-items:center;gap:12px;margin-bottom:16px')}>
                    <div style={s('width:22px;height:22px;border-radius:50%;border:2.5px solid var(--border);border-top-color:var(--accent);animation:ss-spin .8s linear infinite')}></div>
                    <div style={s('flex:1')}><div style={s('font-size:14px;font-weight:700')}>{autoPhase}</div><div style={s('font-size:11.5px;color:var(--muted);margin-top:2px')}>Keep this window open — closing now loses task status.</div></div>
                    <div style={s(`${mono};font-size:15px;font-weight:600;color:var(--accent)`)}>{autoProgress}%</div>
                  </div>
                  <div style={s('height:8px;border-radius:99px;background:var(--raised);overflow:hidden')}><div style={s(`height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:${autoProgress}%;transition:width .18s linear`)}></div></div>
                </div>
              )}

              {autoStep === 'done' && (autoIsResultTable ? (
                <div>
                  {autoResultInvoices && (
                    <div style={s('border-radius:13px;border:1px solid var(--border);overflow:hidden')}>
                      <div style={s('display:grid;grid-template-columns:1.4fr 1.2fr 1fr auto;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}><span>Invoice</span><span>Date</span><span style={s('text-align:right')}>Amount</span><span>Status</span></div>
                      {invRowsVM.map((r) => (
                        <div key={r.inv} style={s('display:grid;grid-template-columns:1.4fr 1.2fr 1fr auto;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}><span style={s(`${mono};color:var(--accent)`)}>{r.inv}</span><span style={s('color:var(--text2)')}>{r.date}</span><span style={s(`text-align:right;${mono};font-weight:600`)}>{r.amount}</span><Badge vm={r.statusBadge} /></div>
                      ))}
                    </div>
                  )}
                  {autoResultTxn && (
                    <div style={s('border-radius:13px;border:1px solid var(--border);overflow:hidden')}>
                      <div style={s('display:grid;grid-template-columns:0.8fr 1fr 1.2fr 1fr 1fr;gap:8px;padding:11px 15px;background:var(--alt);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}><span>Date</span><span>Card</span><span>Driver</span><span style={s('text-align:right')}>Gallons</span><span style={s('text-align:right')}>Amount</span></div>
                      {txnRows.map((r, i) => (
                        <div key={i} style={s('display:grid;grid-template-columns:0.8fr 1fr 1.2fr 1fr 1fr;gap:8px;padding:12px 15px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}><span style={s('color:var(--text2)')}>{r.date}</span><span style={s(mono)}>{r.card}</span><span style={s('color:var(--text2)')}>{r.driver}</span><span style={s(`text-align:right;${mono}`)}>{r.gallons}</span><span style={s(`text-align:right;${mono};font-weight:600`)}>{r.amount}</span></div>
                      ))}
                    </div>
                  )}
                  <div style={s('display:flex;justify-content:space-between;gap:10px;margin-top:18px')}>
                    <button onClick={resetAuto} className="ss-ico-btn" style={s('height:42px;padding:0 18px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>↩ New search</button>
                    <button onClick={downloadAuto} className="ss-btn-p" style={s(btnP('height:42px;padding:0 20px;border-radius:11px;font-size:12.5px;display:flex;align-items:center;gap:7px'))}><Svg d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" size={15} />Download</button>
                  </div>
                </div>
              ) : (
                <div style={s('text-align:center;padding:20px 10px')}>
                  <div style={s('width:66px;height:66px;border-radius:50%;background:color-mix(in srgb,var(--ok) 16%,transparent);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--ok)')}><Svg d="M20 6L9 17l-5-5" size={34} strokeWidth={2.4} /></div>
                  <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;text-transform:uppercase;letter-spacing:.04em')}>{`${runVerb} complete`}</div>
                  <div style={s('font-size:13px;color:var(--text2);margin-top:8px;max-width:400px;margin-left:auto;margin-right:auto;line-height:1.55')}>{successMsg}</div>
                  <div style={s('display:flex;justify-content:center;gap:10px;margin-top:22px')}>
                    <button onClick={resetAuto} className="ss-ico-btn" style={s('height:42px;padding:0 18px;border-radius:11px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Run another</button>
                    <button onClick={closeAuto} className="ss-btn-p" style={s(btnP('height:42px;padding:0 22px;border-radius:11px;font-size:12.5px'))}>Done</button>
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
