import { Fragment, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useCachedLoad } from '../_shared/swrCache';
import {
  getClientEfsLoads,
  getClientMoneyCodes,
  getMoneyCodeDetail,
  rollingRange,
  type EfsRange,
  type MoneyCodeStatus,
} from '../../api/finance';
import {
  Badge,
  CacheBar,
  financeKeys,
  PanelState,
  RangePicker,
  STALE,
  statusTone,
} from './panelBits';
import { dateTime, money, money0, num } from './financeFormat';

/**
 * Finance client modal → EFS and Money Codes tabs.
 *
 * Both read LIVE EFS state through servercrm's `/api/efs/touchpoints/*`, so they are seconds rather
 * than milliseconds (money-code history is parent-wide upstream, ~7s). They live in their own file
 * because modalPanels.tsx is at 585 of the 600-line cap.
 *
 * The EFS tab is DELIBERATELY only top-ups and sweeps. Contract and card inventory used to sit here
 * and answered a question nobody opens this tab to ask; `GET /v1/finance/clients/:id/efs` still
 * serves the carrier's balance/contracts/cards if that is ever wanted back.
 *
 * Read-only. Initiating a movement or issuing/voiding a code needs servercrm's
 * `EFS_TOUCHPOINTS_WRITES_ENABLED` gate plus an audited, role-gated endpoint of ours.
 *
 * ⚠️ There is no full money code on this page and there must never be one. The API returns
 * `codeLast4` only — an unredeemed code is a bearer instrument, and the value reaches the carrier via
 * the CMP notification, not a screen. Don't "just add" the digits so someone can read one out.
 *
 * NOTE the modal is portalled to <body>, outside `.fi-root` — every class here must be styled by an
 * unscoped rule in finance.css.
 */

/** Filter chips. Goes quiet — not disabled — while a background revalidation is in flight. */
function ChipBar<T extends string | number>({
  label,
  options,
  value,
  busy,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  busy: boolean;
  onChange: (id: T) => void;
}) {
  return (
    <div className="fi-subbar">
      <span className="fi-subbar-l">{label}</span>
      <div className={`fi-chiprow${busy ? ' is-busy' : ''}`}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="fi-chip"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One line of plain English above a panel. Both tabs show VENDOR concepts, not our vocabulary. */
function Lede({ children }: { children: ReactNode }) {
  return <p className="fi-lede">{children}</p>;
}

/** Headline figure + caption. `tone` colours the number; the caption says what it counts. */
function BigStat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className="fi-bigstat" style={tone ? { ['--p' as string]: tone } : undefined}>
      <div className="fi-bigstat-l">{label}</div>
      <div className="fi-bigstat-v">{value}</div>
      {sub ? <div className="fi-bigstat-s">{sub}</div> : null}
    </div>
  );
}

/** Signed money, with the sign always explicit — '−$1,119' reads unambiguously, '($1,119)' doesn't. */
const signed = (v: number, whole = true): string =>
  `${v < 0 ? '−' : '+'}${whole ? money0(Math.abs(v)) : money(Math.abs(v))}`;

// ─── EFS: top-ups & sweeps ───────────────────────────────────────────────────────────────────

/** Calendar day of an EFS timestamp. Zoned strings are read as sent, never re-parsed. */
const dayOf = (when: string | null): string => (when ?? '').slice(0, 10);

/** '2026-08-01' → 'Sat 01 Aug'. Parsed by hand: `new Date('2026-08-01')` is UTC midnight, which
 *  renders as the previous day west of UTC. */
function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return 'Undated';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function EfsPanel({ carrierId }: { carrierId: string }) {
  const [range, setRange] = useState<EfsRange>(rollingRange(30));
  // Cached per carrier AND per window, so flipping 30d → 7d → 30d costs one call, not three, and
  // leaving the tab and coming back costs none. A custom range gets its own cache entry too.
  const load = useCachedLoad(
    financeKeys.efsLoads(carrierId, range),
    () => getClientEfsLoads(carrierId, range),
    { staleMs: STALE.EFS_LOADS },
  );
  const shown = load.data;
  /** What the server actually covered — for a custom range this is the picked span, not a preset. */
  const spanDays = shown?.window.days ?? (range.kind === 'days' ? range.days : 0);

  const inAmt = shown?.summary.topupAmount ?? 0;
  const outAmt = shown?.summary.sweepAmount ?? 0;
  const net = shown?.summary.net ?? 0;
  const gross = inAmt + outAmt;
  // Share of the window's GROSS flow that came in. Guarded so a zero-flow window renders an empty
  // track rather than a NaN% width.
  const inPct = gross > 0 ? Math.round((inAmt / gross) * 100) : 0;

  // Grouped by day: top-ups and sweeps cluster heavily on a few dates, and "what happened on the
  // 1st" is the question — not a flat list of 40 timestamps.
  const groups: { day: string; rows: NonNullable<typeof shown>['loads'] }[] = [];
  for (const row of shown?.loads ?? []) {
    const day = dayOf(row.when);
    const tail = groups[groups.length - 1];
    if (tail && tail.day === day) tail.rows.push(row);
    else groups.push({ day, rows: [row] });
  }

  return (
    <div className="fi-stack">
      <Lede>
        Money moved between Octane&rsquo;s parent EFS account and this carrier.{' '}
        <strong className="fi-in-w">Top-ups</strong> push funds onto their contract;{' '}
        <strong className="fi-out-w">sweeps</strong> pull unspent funds back out.
      </Lede>

      <RangePicker value={range} busy={load.revalidating} onChange={setRange} />
      <CacheBar cachedAt={load.cachedAt} revalidating={load.revalidating} onRefresh={load.reload} />

      <PanelState
        loading={load.loading}
        error={load.error}
        empty={!!shown && shown.loads.length === 0}
        emptyTitle="No fund movements"
        emptyMsg="Nothing moved between the parent account and this carrier in this window. EFS keeps only 90 days of history, so try the widest range before concluding there is none."
      >
        {shown ? (
          <div className={`fi-stack${load.revalidating ? ' is-busy' : ''}`}>
            <div className="fi-flow">
              <div className="fi-flow-stats">
                <BigStat
                  label="Money in"
                  value={money0(inAmt)}
                  tone="var(--fi-paid)"
                  sub={`${num(shown.summary.topupCount)} top-up${shown.summary.topupCount === 1 ? '' : 's'}`}
                />
                <BigStat
                  label="Money out"
                  value={money0(outAmt)}
                  tone="var(--fi-pending)"
                  sub={`${num(shown.summary.sweepCount)} sweep${shown.summary.sweepCount === 1 ? '' : 's'}`}
                />
                <BigStat
                  label="Net change"
                  value={signed(net)}
                  tone={net < 0 ? 'var(--fi-debt)' : 'var(--fi-paid)'}
                  sub={net < 0 ? 'more came out than went in' : 'more went in than came out'}
                />
              </div>

              {/* How the gross flow split. Both segments are labelled below, so the split never
                  depends on colour alone. */}
              {gross > 0 ? (
                <>
                  <div className="fi-flowbar" aria-hidden="true">
                    <span className="fi-flowbar-in" style={{ width: `${inPct}%` }} />
                    <span className="fi-flowbar-out" style={{ width: `${100 - inPct}%` }} />
                  </div>
                  <div className="fi-flowkey">
                    <span>
                      <i className="fi-keydot" style={{ ['--p' as string]: 'var(--fi-paid)' }} />
                      In {inPct}% · {money0(inAmt)}
                    </span>
                    <span>
                      <i className="fi-keydot" style={{ ['--p' as string]: 'var(--fi-pending)' }} />
                      Out {100 - inPct}% · {money0(outAmt)}
                    </span>
                  </div>
                </>
              ) : null}
            </div>

            <div className="fi-tablewrap">
              <div className="fi-tablescroll">
                <table className="fi-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Movement</th>
                      <th>Contract</th>
                      <th>Reference</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  {groups.map((g) => {
                    const daySum = g.rows.reduce((s, r) => s + r.amount, 0);
                    return (
                      <tbody key={g.day || 'undated'}>
                        <tr className="fi-daygroup">
                          <td colSpan={4}>
                            {dayLabel(g.day)}
                            <span className="fi-daygroup-n">
                              {num(g.rows.length)} movement{g.rows.length === 1 ? '' : 's'}
                            </span>
                          </td>
                          <td className={`fi-num ${daySum < 0 ? 'fi-outv' : 'fi-paid'}`}>
                            {signed(daySum)}
                          </td>
                        </tr>
                        {g.rows.map((row, i) => {
                          const up = row.direction === 'TOPUP';
                          // Sweeps often carry neither responseId nor refNum and two can share a
                          // timestamp to the minute — the index keeps the key unique.
                          return (
                            <tr key={`${row.responseId ?? row.refNum ?? row.when ?? 'row'}-${i}`}>
                              <td className="fi-mono fi-time">
                                {(row.when ?? '').slice(11, 16) || '—'}
                              </td>
                              <td>
                                <span className={`fi-dir${up ? ' is-in' : ' is-out'}`}>
                                  {up ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
                                  {up ? 'Top-up' : 'Sweep'}
                                </span>
                              </td>
                              <td className="fi-mono">{row.contractId || '—'}</td>
                              {/* refNum is ours (set when we initiate); responseId is EFS's own key. */}
                              <td className="fi-mono fi-ref">{row.refNum || row.responseId || '—'}</td>
                              <td className={`fi-num ${up ? 'fi-paid' : 'fi-outv'}`}>
                                {signed(row.amount, false)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        {num(shown.loads.length)} movements over {num(spanDays)} days
                        {shown.window.custom
                          ? ` · ${shown.window.from.slice(0, 10)} → ${shown.window.to.slice(0, 10)}`
                          : ''}
                      </td>
                      <td className={`fi-num ${net < 0 ? 'fi-outv' : 'fi-paid'}`}>
                        {signed(net, false)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </PanelState>
    </div>
  );
}

// ─── Money codes ─────────────────────────────────────────────────────────────────────────────

/** EFS's statuses in plain words — OPEN/PARTIAL/USED read as jargon in a finance table. */
const MC_STATUS: { id: MoneyCodeStatus; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'OPEN', label: 'Not drawn' },
  { id: 'PARTIAL', label: 'Part drawn' },
  { id: 'USED', label: 'Drawn' },
  { id: 'VOIDED', label: 'Voided' },
];

function codeLabel(status: string, voided: boolean): { label: string; tone: string } {
  if (voided) return { label: 'Voided', tone: 'var(--fi-debt)' };
  switch (status.toUpperCase()) {
    case 'OPEN':
      return { label: 'Not drawn', tone: 'var(--fi-pending)' };
    case 'PARTIAL':
      return { label: 'Part drawn', tone: 'var(--fi-pending)' };
    case 'USED':
      return { label: 'Drawn', tone: 'var(--fi-paid)' };
    case 'VOIDED':
      return { label: 'Voided', tone: 'var(--fi-debt)' };
    default:
      return { label: status || 'unknown', tone: statusTone(status) };
  }
}

/**
 * One code's redemptions, fetched on expand — EFS bills a call per code, so never up front.
 *
 * Cached by code id: collapsing and reopening a row, or coming back to the tab, is free. A fully-drawn
 * code's redemption history is immutable, which is why STALE.MONEY_CODE is the longest window here.
 */
function UsesRow({ codeId, span }: { codeId: string; span: number }) {
  const load = useCachedLoad(financeKeys.moneyCode(codeId), () => getMoneyCodeDetail(codeId), {
    staleMs: STALE.MONEY_CODE,
  });
  const d = load.data;
  return (
    <tr>
      <td colSpan={span} className="fi-uses">
        {/* One loader, sized to this region — the table above stays put behind it. */}
        {load.loading ? <div className="fi-sk fi-sk-line" /> : null}
        {load.error ? <div className="fi-error">{load.error}</div> : null}
        {d ? (
          d.uses.length === 0 ? (
            <div className="fi-uses-empty">
              Not drawn yet — EFS shows no redemptions against this code.
            </div>
          ) : (
            <>
              <div className="fi-uses-head">
                {num(d.uses.length)} draw{d.uses.length === 1 ? '' : 's'} · {money(d.amountUsed)} of{' '}
                {money(d.amount)} redeemed
              </div>
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Drawn</th>
                    <th>EFS check #</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.uses.map((u, i) => (
                    <tr key={`${u.checkNumber}-${i}`}>
                      <td>{dateTime(u.at) || '—'}</td>
                      <td className="fi-mono">{u.checkNumber || '—'}</td>
                      <td className="fi-num fi-paid">{money(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        ) : null}
      </td>
    </tr>
  );
}

export function MoneyCodesPanel({ carrierId }: { carrierId: string }) {
  const [range, setRange] = useState<EfsRange>(rollingRange(30));
  const [status, setStatus] = useState<MoneyCodeStatus>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  // Keyed on carrier + window + status. This is the expensive one (~7s, parent-wide upstream), so it
  // is also the read that most needed to stop refiring on every tab switch.
  const load = useCachedLoad(
    financeKeys.moneyCodes(carrierId, range, status),
    () => getClientMoneyCodes(carrierId, range, status),
    { staleMs: STALE.MONEY_CODES },
  );
  const shown = load.data;
  const COLS = 7;

  const issued = shown?.codes.reduce((s, c) => s + c.amount, 0) ?? 0;
  const drawn = shown?.codes.reduce((s, c) => s + c.amountUsed, 0) ?? 0;
  /**
   * What the carrier can still redeem — cash we are on the hook for.
   *
   * Summed from the rows rather than the upstream summary: `issued − drawn` would count voided codes
   * as outstanding, and the summary reports `partial.amount` (the code's face value) rather than the
   * part still undrawn. `amountRemaining` is already 0 on a fully-drawn code, so this is exact.
   */
  const stillOut = shown?.codes.reduce((s, c) => s + (c.voided ? 0 : c.amountRemaining), 0) ?? 0;
  const stillOutCount = shown?.codes.filter((c) => !c.voided && c.amountRemaining > 0).length ?? 0;

  return (
    <div className="fi-stack">
      <Lede>
        Cash codes drawn on Octane&rsquo;s main contract and issued to this carrier — a driver
        redeems one at a truck stop. <strong className="fi-out-w">Not drawn</strong> means the cash is
        still outstanding.
      </Lede>

      <RangePicker value={range} busy={load.revalidating} onChange={setRange} />
      <ChipBar
        label="Status"
        options={MC_STATUS}
        value={status}
        busy={load.revalidating}
        onChange={setStatus}
      />
      <CacheBar cachedAt={load.cachedAt} revalidating={load.revalidating} onRefresh={load.reload} />

      <PanelState
        loading={load.loading}
        error={load.error}
        empty={!!shown && shown.codes.length === 0}
        emptyTitle="No money codes"
        emptyMsg="No codes were issued to this carrier in this window. EFS keeps only 90 days of history, so widen the range before concluding there are none."
      >
        {shown ? (
          <div className={`fi-stack${load.revalidating ? ' is-busy' : ''}`}>
            <div className="fi-flow">
              <div className="fi-flow-stats">
                <BigStat
                  label="Issued"
                  value={money0(issued)}
                  sub={`${num(shown.summary.total)} code${shown.summary.total === 1 ? '' : 's'}`}
                />
                <BigStat
                  label="Drawn"
                  value={money0(drawn)}
                  tone="var(--fi-paid)"
                  sub={`${num(shown.summary.usedCount)} fully redeemed`}
                />
                <BigStat
                  label="Still out"
                  value={money0(stillOut)}
                  tone="var(--fi-pending)"
                  sub={`${num(stillOutCount)} code${stillOutCount === 1 ? '' : 's'} not fully drawn`}
                />
                <BigStat
                  label="EFS fees"
                  value={money(shown.summary.feeTotal)}
                  tone="var(--fi-debt)"
                  sub="charged on these codes"
                />
              </div>
            </div>

            {/* Say why the digits aren't here, so nobody files it as a missing column. */}
            <div className="fi-note">
              <ShieldCheck size={13} />
              <span>
                Codes show their last four digits only. The full value is never sent to a browser —
                it reaches the carrier through the CMP app notification.
              </span>
            </div>

            <div className="fi-tablewrap">
              <div className="fi-tablescroll">
                <table className="fi-table">
                  <thead>
                    <tr>
                      <th>Issued</th>
                      <th>Code</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Drawn</th>
                      <th style={{ textAlign: 'right' }}>EFS fee</th>
                      <th>Issued by &amp; reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.codes.map((c) => {
                      const expanded = open === c.id;
                      const st = codeLabel(c.status, c.voided);
                      const part = c.amountUsed > 0 && c.amountRemaining > 0;
                      return (
                        <Fragment key={c.id}>
                          <tr
                            className="fi-clickrow"
                            aria-expanded={expanded}
                            onClick={() => setOpen(expanded ? null : c.id)}
                            title="Show redemptions"
                          >
                            <td>{dateTime(c.createdAt) || '—'}</td>
                            <td className="fi-mono fi-masked">•••• {c.codeLast4 || '????'}</td>
                            <td>
                              <Badge label={st.label} tone={st.tone} />
                            </td>
                            <td className="fi-num">{money(c.amount)}</td>
                            <td className="fi-num">
                              {c.amountUsed > 0 ? (
                                <span className="fi-paid">{money(c.amountUsed)}</span>
                              ) : (
                                '—'
                              )}
                              {/* A part-drawn code is the one case where "how much is left" matters at
                                  a glance — spell it out rather than making them subtract. */}
                              {part ? (
                                <div className="fi-subnote">{money(c.amountRemaining)} left</div>
                              ) : null}
                            </td>
                            <td className="fi-num">{c.feeAmount > 0 ? money(c.feeAmount) : '—'}</td>
                            <td>
                              <div className="fi-who">{c.issuedBy || '—'}</div>
                              {c.notes ? <div className="fi-subnote">{c.notes}</div> : null}
                            </td>
                          </tr>
                          {expanded ? <UsesRow codeId={c.id} span={COLS} /> : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>{num(shown.codes.length)} codes</td>
                      <td className="fi-num">{money(issued)}</td>
                      <td className="fi-num fi-paid">{money(drawn)}</td>
                      <td className="fi-num">{money(shown.summary.feeTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </PanelState>
    </div>
  );
}
