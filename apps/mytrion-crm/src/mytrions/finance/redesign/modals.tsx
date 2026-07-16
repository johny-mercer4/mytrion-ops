import { Badge, s, Svg } from './dc';
import {
  badge,
  galC,
  initials,
  invoiceStatusLabel,
  moneyC,
  paymentStatusLabel,
} from './financeData';
import { ICONS, KvGroup } from './financeUi';
import {
  dateFull,
  dateTimeFull,
  fmtCurrency,
  maskCard,
  type Client,
  type ClientFuel,
  type ClientInvoice,
  type ClientPayment,
  type TransactionLine,
} from '../data';
import type { ClientDrillTab } from './financeData';

export function TxModal({ tx, onClose }: { tx: TransactionLine; onClose: () => void }) {
  const mono = "font-family:'JetBrains Mono',monospace";
  const rows1 = [
    { k: 'Transaction ID', v: tx.txId, mono },
    { k: 'Date', v: dateTimeFull(tx.date), mono: '' },
    { k: 'Carrier ID', v: tx.carrier, mono },
    { k: 'Card', v: maskCard(tx.card), mono },
    { k: 'Payment Terms', v: tx.terms, mono: '' },
  ];
  const rows2 = [
    { k: 'Fuel Grade', v: tx.grade, mono: '' },
    { k: 'Quantity', v: `${galC(tx.gal)} gal`, mono },
    { k: 'Price / Unit', v: `$${tx.ppu.toFixed(3)}`, mono },
    { k: 'Retail / Unit', v: `$${tx.retail.toFixed(3)}`, mono },
    { k: 'Discount', v: `−${fmtCurrency(tx.disc)}`, mono },
    { k: 'Location', v: `${tx.loc}, ${tx.state}`, mono: '' },
  ];

  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;animation:mf-up .2s ease both')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:88vh;overflow-y:auto;border-radius:16px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:mf-pop .26s cubic-bezier(.2,0,0,1) both')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:2')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:.02em')}>{tx.company}</div>
          <CloseBtn onClose={onClose} />
        </div>
        <div style={s('padding:18px 20px')}>
          <div style={s('display:flex;align-items:baseline;gap:10px;margin-bottom:18px')}>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:30px;color:var(--accent)")}>{fmtCurrency(tx.amount)}</div>
            <span style={s("font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:var(--orange-s);color:var(--orange);font-family:'JetBrains Mono',monospace")}>{galC(tx.gal)} gal</span>
          </div>
          <KvGroup title="Transaction" rows={rows1} />
          <div style={s('height:16px')} />
          <KvGroup title="Fuel & Location" rows={rows2} />
        </div>
      </div>
    </div>
  );
}

export function ClientModal({
  client,
  tab,
  setTab,
  drillLoading,
  onClose,
}: {
  client: Client;
  tab: ClientDrillTab;
  setTab: (t: ClientDrillTab) => void;
  drillLoading: boolean;
  onClose: () => void;
}) {
  const billed = client.invoices.reduce((s, i) => s + i.total, 0);
  const paid = client.invoices.reduce((s, i) => s + i.paid, 0);
  const openBal = client.invoices.reduce((s, i) => s + i.open, 0);
  const badges = [
    badge(client.active ? 'Active' : 'Inactive', client.active ? 'ok' : 'muted'),
    badge(client.terms, 'blue'),
  ];
  if (client.suspended) badges.push(badge('LOC SUSPENDED', 'danger'));
  if (client.wex) badges.push(badge('WEX FUNDED', 'violet'));
  if (client.debt > 0) badges.push(badge(`DEBT ${moneyC(client.debt)}`, 'danger'));

  const stats = [
    { k: 'Total Billed', v: moneyC(billed), color: 'var(--text)' },
    { k: 'Paid', v: moneyC(paid), color: 'var(--ok)' },
    { k: 'Open Balance', v: moneyC(openBal), color: openBal > 0 ? 'var(--danger)' : 'var(--muted)' },
  ];

  const tabs: { id: ClientDrillTab; label: string; count: number }[] = [
    { id: 'invoices', label: 'Invoices', count: client.invoices.length },
    { id: 'payments', label: 'Payments', count: client.payments.length },
    { id: 'fuel', label: 'Recent Fuel', count: client.fuel.length },
    { id: 'info', label: 'Info', count: 0 },
  ];

  const avBg = client.suspended ? 'var(--danger-s)' : 'var(--accent-s)';
  const avFg = client.suspended ? 'var(--danger)' : 'var(--accent)';

  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;animation:mf-up .2s ease both')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:760px;max-height:90vh;display:flex;flex-direction:column;border-radius:16px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:mf-pop .26s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('padding:18px 20px 14px;border-bottom:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
            <div style={s('display:flex;align-items:center;gap:13px;min-width:0')}>
              <div style={s(`width:46px;height:46px;border-radius:12px;background:${avBg};color:${avFg};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;flex-shrink:0`)}>
                {initials(client.company)}
              </div>
              <div style={s('min-width:0')}>
                <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{client.company}</div>
                <div style={s("font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>#{client.carrier} · DOT {client.dot}</div>
              </div>
            </div>
            <CloseBtn onClose={onClose} />
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:6px;margin-top:13px')}>
            {badges.map((b, i) => (
              <Badge key={i} vm={b} />
            ))}
          </div>
        </div>

        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-bottom:1px solid var(--border)')}>
          {stats.map((st) => (
            <div key={st.k} style={s('padding:13px 16px;background:var(--surface-2)')}>
              <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:16px;color:${st.color}`)}>{st.v}</div>
              <div style={s('font-size:10px;color:var(--muted);margin-top:2px')}>{st.k}</div>
            </div>
          ))}
        </div>

        <div style={s('display:flex;gap:2px;padding:10px 14px 0;border-bottom:1px solid var(--border)')}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={s(
                tab === t.id
                  ? 'padding:9px 13px;border:none;background:transparent;border-bottom:2px solid var(--accent);color:var(--text);font-size:12.5px;font-weight:700;cursor:pointer'
                  : 'padding:9px 13px;border:none;background:transparent;border-bottom:2px solid transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer',
              )}
            >
              {t.label}
              {t.count > 0 ? (
                <span style={s('margin-left:6px;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:99px;background:var(--raised);color:var(--muted)')}>{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="mf-scroll" style={s('flex:1;min-height:0;padding:16px 18px')}>
          {drillLoading ? (
            <div>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="mf-skel" style={s(`height:38px;margin-bottom:${i < 3 ? 8 : 0}px`)} />
              ))}
            </div>
          ) : tab === 'info' ? (
            <ClientInfo client={client} />
          ) : (
            <ClientTable tab={tab} client={client} />
          )}
        </div>
      </div>
    </div>
  );
}

function ClientInfo({ client }: { client: Client }) {
  const mono = "font-family:'JetBrains Mono',monospace";
  const groups = [
    {
      label: 'Company',
      rows: [
        { k: 'Carrier ID', v: client.carrier, mono },
        { k: 'DOT', v: client.dot, mono },
        { k: 'Email', v: client.email, mono: '' },
        { k: 'Phone', v: client.phone, mono },
        { k: 'Address', v: `${client.city}, ${client.state}`, mono: '' },
      ],
    },
    {
      label: 'Credit & Sales',
      rows: [
        { k: 'Credit Limit', v: client.credit === 'WEX' ? 'WEX' : fmtCurrency(parseFloat(client.credit.replace(/,/g, '')) || 0), mono: '' },
        { k: 'Payment Terms', v: client.terms, mono: '' },
        { k: 'Agent', v: client.agent, mono: '' },
        { k: 'Deal Stage', v: client.stage, mono: '' },
      ],
    },
  ];
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      {groups.map((g) => (
        <KvGroup key={g.label} title={g.label} rows={g.rows} />
      ))}
    </div>
  );
}

function ClientTable({ tab, client }: { tab: ClientDrillTab; client: Client }) {
  if (tab === 'invoices') {
    return client.invoices.length ? (
      <DrillRows rows={client.invoices.map((iv) => invoiceRow(iv))} />
    ) : (
      <Empty msg="No invoices on file." />
    );
  }
  if (tab === 'payments') {
    return client.payments.length ? (
      <DrillRows rows={client.payments.map((p) => paymentRow(p))} />
    ) : (
      <Empty msg="No payment transactions found." />
    );
  }
  return client.fuel.length ? (
    <DrillRows rows={client.fuel.map((f) => fuelRow(f))} />
  ) : (
    <Empty msg="No recent fueling." />
  );
}

function invoiceRow(iv: ClientInvoice) {
  const st = iv.st === 'PAID' ? 'ok' : iv.st === 'OVERDUE' ? 'danger' : iv.st === 'PARTIALLY_PAID' ? 'warn' : 'blue';
  return {
    title: iv.n,
    sub: `Due ${dateFull(iv.due)}${iv.over > 0 ? ` · ${iv.over}d overdue` : ''}`,
    amount: fmtCurrency(iv.open),
    amountColor: iv.open > 0 ? 'var(--danger)' : 'var(--muted)',
    status: invoiceStatusLabel(iv.st),
    statusStyle: badge(invoiceStatusLabel(iv.st), st).style,
  };
}

function paymentRow(p: ClientPayment) {
  const srcShort = p.src.split(' ')[0] ?? p.src;
  const srcKind = p.src === 'Zelle' ? 'violet' : p.src === 'Chase' ? 'blue' : p.src === 'Stripe' ? 'orange' : 'accent';
  const stKind = p.st === 'APPROVED' || p.st === 'SUCCESS' || p.st === 'POSTED' ? 'ok' : p.st === 'DECLINED' ? 'danger' : 'warn';
  return {
    title: p.src,
    sub: `${p.det} · ${dateFull(p.date)}`,
    badge: srcShort,
    badgeStyle: badge(srcShort, srcKind).style,
    status: paymentStatusLabel(p.st),
    statusStyle: badge(paymentStatusLabel(p.st), stKind).style,
    amount: fmtCurrency(p.amt),
    amountColor: 'var(--ok)',
  };
}

function fuelRow(f: ClientFuel) {
  return {
    title: f.loc,
    sub: `${dateTimeFull(f.date)} · ${f.grade}`,
    badge: `${galC(f.gal)} gal`,
    badgeStyle: badge(`${galC(f.gal)} gal`, 'orange').style,
    amount: fmtCurrency(f.amt),
    amountColor: 'var(--accent)',
  };
}

function DrillRows({
  rows,
}: {
  rows: {
    title: string;
    sub: string;
    amount: string;
    amountColor: string;
    badge?: string;
    badgeStyle?: string;
    status?: string;
    statusStyle?: string;
  }[];
}) {
  return (
    <div style={s('display:flex;flex-direction:column;gap:7px')}>
      {rows.map((r, i) => (
        <div key={i} style={s('display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:10px;background:var(--alt);border:1px solid var(--border2)')}>
          {r.badge ? <span style={s(r.badgeStyle ?? '')}>{r.badge}</span> : null}
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.title}</div>
            <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.sub}</div>
          </div>
          {r.status ? <span style={s(r.statusStyle ?? '')}>{r.status}</span> : null}
          <div style={s(`font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:${r.amountColor};text-align:right;flex-shrink:0`)}>{r.amount}</div>
        </div>
      ))}
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label="Close" className="mf-ico" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
      <Svg d={ICONS.close} size={15} strokeWidth={2.2} />
    </button>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={s('padding:36px;text-align:center;color:var(--muted);font-size:12.5px')}>{msg}</div>;
}
