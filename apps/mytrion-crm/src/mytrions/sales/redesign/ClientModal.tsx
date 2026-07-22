/**
 * Client drilldown modal — Overview / Cards / Activity / Manage (registration links).
 */
import { useEffect, useState, type ReactNode } from 'react';

import { ClientManagePanel } from './ClientManagePanel';
import {
  loadClientCards,
  loadClientActivity,
  loadClientBilling,
  CLIENT_ACTIVITY_PAGE,
  type ClientActivityVM,
  type ClientBillingVM,
} from './clientDrilldown';
import type { ClientRecord } from './ctx';
import { s } from './dc';
import { Icon } from './icons';
import { useLoad, numFmt } from './live';
import { badge } from './salesData';
import {
  resolveTier,
  tierRewards,
  tierColor,
  tierTextColor,
  tierLabel,
  trackCaption,
  type TierResult,
} from './loyalty';

export type ClientModalTab = 'overview' | 'loyalty' | 'cards' | 'activity' | 'billing' | 'manage';

// ---- Billing & Account tab ----
function BillingField({ label, value, soon }: { label: string; value?: string; soon?: boolean }) {
  return (
    <div style={s('padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
      <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      {soon ? (
        <div style={s('margin-top:7px')}>
          <span style={s('font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)')}>Coming soon</span>
        </div>
      ) : (
        <div style={s("font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;margin-top:6px")}>{value ?? '—'}</div>
      )}
    </div>
  );
}

function BillingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:10px')}>{title}</div>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>{children}</div>
    </div>
  );
}

/** Per-client billing/account view. DWH-backed fields (billing cycle, terms, credit limit, min
 *  balance, debt, status) render live; fields not yet in the DWH (fees, payment method, discounts,
 *  bonus, notes, scheduled dates) show a "Coming soon" chip until Accounting/CMP wires them in. */
function BillingPanel({ data, loading, error, statusLabel, owed }: {
  data: ClientBillingVM | null;
  loading: boolean;
  error: string | null;
  statusLabel: string;
  owed: number;
}) {
  if (loading) return <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>Loading billing…</div>;
  if (error) return <div style={s('font-size:13px;color:var(--danger);padding:8px 2px')}>Couldn't load billing — {error}</div>;
  const b = data;
  const dash = (v?: string | null): string => (v && String(v).trim() ? String(v) : '—');
  const money = (v?: string | number | null): string =>
    v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? `$${Math.round(Number(v)).toLocaleString('en-US')}` : '—';
  const cyc = b?.billingCycle ? `${b.billingCycle}${b.billingCycleTag ? ` · ${b.billingCycleTag}` : ''}` : null;
  return (
    <div style={s('display:flex;flex-direction:column;gap:18px')}>
      <BillingSection title="Client Profile">
        <BillingField label="Billing cycle" value={dash(cyc)} />
        <BillingField label="Payment terms" value={dash(b?.paymentTerms)} />
        <BillingField label="Fee status" soon />
        <BillingField label="Payment method" soon />
      </BillingSection>
      <BillingSection title="Discount & Bonus">
        <BillingField label="TA discount" soon />
        <BillingField label="Additional discounts" soon />
        <BillingField label="Bonus eligibility" soon />
        <BillingField label="Account notes" soon />
      </BillingSection>
      <BillingSection title="Billing Summary">
        <BillingField label="Credit limit" value={money(b?.creditLimit)} />
        <BillingField label="Min. required balance" value={money(b?.minimumRequiredBalance)} />
        <BillingField label="Payment day" value={dash(b?.paymentDay)} />
        <BillingField label="Account status" value={statusLabel} />
        <BillingField label="Current debt" value={owed >= 1 ? money(owed) : '$0'} />
        <BillingField label="Last / upcoming payment" soon />
      </BillingSection>
      <div style={s('font-size:11.5px;color:var(--muted);line-height:1.5')}>
        Fee, payment-method, discount, bonus, and scheduled-payment fields aren't in the data warehouse
        yet — they light up once Accounting/CMP wires them in.
      </div>
    </div>
  );
}

const REC_STATUS: Record<ClientRecord['status'], [string, string]> = {
  active: ['Active', 'var(--ok)'],
  attention: ['Needs attention', 'var(--orange)'],
  debtor: ['Debtor', 'var(--danger)'],
};

/** Fill % of the gallons-vs-next-threshold bar (100 at Gold / when there's no next tier). */
function progressPct(t: TierResult): number {
  const th = t.thresholds;
  if (!th || !t.nextLevel) return 100;
  const floor = t.level === 'none' ? 0 : th[t.level];
  const ceil = th[t.nextLevel];
  if (ceil <= floor) return 100;
  return Math.min(100, Math.max(0, ((t.gallons - floor) / (ceil - floor)) * 100));
}

export function ClientModal({
  client,
  clientTab,
  setClientTab,
  onClose,
  onRun,
}: {
  client: ClientRecord;
  clientTab: ClientModalTab;
  setClientTab: (t: ClientModalTab) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const [lbl, col] = REC_STATUS[client.status];
  const statusBadge = badge(lbl, col);
  const initials = client.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  // Tier level = this-calendar-month gallons (program basis), falling back to this-cycle gallons when
  // the client has no current-month pumps yet (matches RecordsTab's tierGallons).
  const tier = resolveTier(client.active, client.gallonsThisMonth > 0 ? client.gallonsThisMonth : client.cycleGallons);
  const rewards = tierRewards(tier.level);
  const cardsL = useLoad(() => loadClientCards(client.id), [client.id]);
  const billingL = useLoad(() => loadClientBilling(client.id), [client.id]);
  const [actRows, setActRows] = useState<ClientActivityVM[]>([]);
  const [actLimit, setActLimit] = useState(CLIENT_ACTIVITY_PAGE);
  const [actHasMore, setActHasMore] = useState(false);
  const [actLoading, setActLoading] = useState(false);
  const [actLoadingMore, setActLoadingMore] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setActRows([]);
    setActLimit(CLIENT_ACTIVITY_PAGE);
    setActHasMore(false);
    setActError(null);
    setActLoading(true);
    void loadClientActivity(client.id, CLIENT_ACTIVITY_PAGE)
      .then((page) => {
        if (off) return;
        setActRows(page.rows);
        setActHasMore(page.hasMore);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => {
        if (!off) setActError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!off) setActLoading(false);
      });
    return () => {
      off = true;
    };
  }, [client.id]);

  const loadMoreActivity = (): void => {
    if (actLoadingMore || !actHasMore) return;
    const next = actLimit + CLIENT_ACTIVITY_PAGE;
    setActLoadingMore(true);
    void loadClientActivity(client.id, next)
      .then((page) => {
        setActRows(page.rows);
        setActHasMore(page.hasMore && page.rows.length > actRows.length);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => setActError(e instanceof Error ? e.message : 'Failed to load more'))
      .finally(() => setActLoadingMore(false));
  };

  const avStyle = `width:52px;height:52px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
  const tabs: Array<[ClientModalTab, string]> = [
    ['overview', 'Overview'],
    ['loyalty', 'Loyalty'],
    ['cards', 'Cards'],
    ['activity', 'Activity'],
    ['billing', 'Billing'],
    ['manage', 'Manage'],
  ];
  const tile = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
  const tLbl = 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em';
  const tVal = "font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px";
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:118;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('flex-shrink:0;padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle)}>{initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{client.name}</div>
            <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.carrier} · MC {client.mc} · DOT {client.dot}</div>
          </div>
          {tier.level !== 'none' && (
            <span style={s(badge(tierLabel(tier.level), tierColor(tier.level)).style + `;color:${tierTextColor(tier.level)};display:inline-flex;align-items:center;gap:4px`)}>
              <Icon name="star" size={11} />{tierLabel(tier.level)}
            </span>
          )}
          <span style={s(statusBadge.style)}>{statusBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div style={s('flex-shrink:0;display:flex;gap:4px;padding:0 22px;border-bottom:1px solid var(--border);overflow-x:auto;background:var(--surface)')}>
          {tabs.map(([id, label]) => {
            const on = clientTab === id;
            return (
              <button key={id} onClick={() => setClientTab(id)} style={s(`padding:8px 15px;border:none;background:none;border-bottom:2px solid ${on ? 'var(--accent)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap`)}>{label}</button>
            );
          })}
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          {clientTab === 'overview' && (
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              <div style={s(`grid-column:1 / span 2;${tile}`)}>
                <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Primary Contact</div>
                <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{client.contact}</div>
                <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.phone}</div>
              </div>
              <div style={s(tile)}>
                <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Cards</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px")}>{client.active}<span style={s('color:var(--muted);font-size:14px')}>/{client.cards}</span> active</div>
              </div>
              <div style={s(tile)}>
                <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Gallons · Cycle</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px;color:var(--violet)")}>{client.gallons}</div>
              </div>
            </div>
          )}
          {clientTab === 'loyalty' &&
            (tier.track === null ? (
              <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>
                No active fuel cards yet — the loyalty tier appears once this client has active cards.
              </div>
            ) : (
              <div style={s('display:flex;flex-direction:column;gap:14px')}>
                <div style={s(`${tile};display:flex;align-items:center;gap:14px`)}>
                  <div style={s(`width:46px;height:46px;flex-shrink:0;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${tierColor(tier.level)} 16%,transparent);color:${tierColor(tier.level)}`)}>
                    <Icon name="star" size={22} />
                  </div>
                  <div style={s('flex:1;min-width:0')}>
                    <div style={s(`font-family:Rajdhani,sans-serif;font-size:22px;font-weight:700;line-height:1;color:${tierTextColor(tier.level)}`)}>{tierLabel(tier.level)}</div>
                    <div style={s('font-size:11.5px;color:var(--muted);margin-top:4px')}>{trackCaption(tier)}</div>
                  </div>
                  {tier.grace && <span style={s(badge('Grace · 1 mo', 'var(--warn)').style)}>Grace · 1 mo</span>}
                </div>

                <div style={s(tile)}>
                  <div style={s('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px')}>
                    <span style={s('font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>Gallons · This month</span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text)")}>{numFmt(tier.gallons)}</span>
                  </div>
                  <div style={s('position:relative;height:8px;border-radius:99px;background:var(--raised);overflow:hidden')}>
                    <div style={s(`position:absolute;inset:0 auto 0 0;width:${progressPct(tier)}%;border-radius:99px;background:${tierColor(tier.nextLevel ?? tier.level)};transition:width .5s ease`)} />
                  </div>
                  <div style={s('font-size:11px;margin-top:7px;color:var(--muted)')}>
                    {tier.nextLevel ? `${numFmt(tier.gallonsToNext)} gal to ${tierLabel(tier.nextLevel)}` : 'Top tier reached'}
                  </div>
                </div>

                <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                  <div style={s(tile)}><div style={s(tLbl)}>Active cards</div><div style={s(tVal)}>{client.active}<span style={s('color:var(--muted);font-size:14px')}>/{client.cards}</span></div></div>
                  <div style={s(tile)}><div style={s(tLbl)}>Cards used · This month</div><div style={s(tVal)}>{client.activeCardsThisMonth}</div></div>
                  <div style={s(tile)}><div style={s(tLbl)}>Gallons · Cycle</div><div style={s(`${tVal};color:var(--violet)`)}>{numFmt(client.cycleGallons)}</div></div>
                  <div style={s(tile)}><div style={s(tLbl)}>Gallons · This month</div><div style={s(`${tVal};color:var(--accent)`)}>{numFmt(client.gallonsThisMonth)}</div></div>
                </div>

                <div>
                  <div style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:2px 0 4px')}>Rewards</div>
                  {rewards.map((r) => (
                    <div key={r.title} style={s(`display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border2);opacity:${r.active ? '1' : '.5'}`)}>
                      <div style={s(`width:26px;height:26px;flex-shrink:0;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${r.active ? tierColor(tier.level) : 'var(--muted)'} 14%,transparent);color:${r.active ? tierColor(tier.level) : 'var(--muted)'}`)}>
                        <Icon name={r.active ? 'check' : 'close'} size={13} />
                      </div>
                      <div style={s('flex:1;min-width:0')}>
                        <div style={s(`font-size:13px;font-weight:600;color:${r.active ? 'var(--text)' : 'var(--muted)'}`)}>{r.title}</div>
                        <div style={s('font-size:10.5px;color:var(--muted);margin-top:1px')}>{r.desc}</div>
                      </div>
                      <span style={s(`font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;white-space:nowrap;color:${r.active ? tierTextColor(tier.level) : 'var(--muted)'}`)}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          {clientTab === 'cards' && (
            <div style={s('display:flex;flex-direction:column;gap:10px')}>
              {cardsL.loading && <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>Loading cards…</div>}
              {cardsL.error && <div style={s('font-size:13px;color:var(--danger);padding:8px 2px')}>Couldn't load cards — {cardsL.error}</div>}
              {!cardsL.loading && !cardsL.error && (cardsL.data?.length ?? 0) === 0 && (
                <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>No cards on file for this carrier.</div>
              )}
              {(cardsL.data ?? []).map((card, i) => (
                <div key={`${card.num}-${i}`} style={s('display:flex;flex-direction:column;gap:8px;padding:13px 15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                  <div style={s('display:flex;align-items:center;gap:12px')}>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600")}>{card.num}</span>
                    {card.cardType && <span style={s('font-size:11px;color:var(--muted)')}>{card.cardType}</span>}
                    <span style={s(`margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${card.tone} 16%,transparent);color:${card.tone}`)}>{card.status}</span>
                  </div>
                  {(card.unit || card.driverName || card.driverId) && (
                    <div style={s('display:flex;flex-wrap:wrap;gap:14px;font-size:11.5px;color:var(--text2)')}>
                      {card.unit && <span><span style={s('color:var(--muted)')}>Unit</span> {card.unit}</span>}
                      {card.driverName && <span><span style={s('color:var(--muted)')}>Driver</span> {card.driverName}</span>}
                      {card.driverId && <span><span style={s('color:var(--muted)')}>Driver ID</span> {card.driverId}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {clientTab === 'billing' && (
            <BillingPanel
              data={billingL.data ?? null}
              loading={billingL.loading}
              error={billingL.error}
              statusLabel={statusBadge.text}
              owed={client.owed ?? 0}
            />
          )}
          {clientTab === 'activity' && (
            <div style={s('display:flex;flex-direction:column;gap:0')}>
              {actLoading && <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>Loading activity…</div>}
              {actError && <div style={s('font-size:13px;color:var(--danger);padding:8px 2px')}>Couldn't load activity — {actError}</div>}
              {!actLoading && !actError && actRows.length === 0 && (
                <div style={s('font-size:13px;color:var(--muted);padding:8px 2px')}>No transactions for this carrier.</div>
              )}
              {actRows.map((ev, i, arr) => {
                const line = i < arr.length - 1;
                return (
                  <div key={`${ev.title}-${i}`} style={s('display:flex;gap:12px')}>
                    <div style={s('display:flex;flex-direction:column;align-items:center')}>
                      <div style={s(`width:9px;height:9px;border-radius:50%;background:${ev.tone}`)} />
                      {line ? <div style={s('width:2px;flex:1;background:var(--border)')} /> : null}
                    </div>
                    <div style={s(line ? 'padding-bottom:18px' : '')}>
                      <div style={s('font-size:13px;font-weight:700')}>{ev.title}</div>
                      <div style={s('font-size:11px;color:var(--muted);margin-top:2px')}>{ev.sub}</div>
                    </div>
                  </div>
                );
              })}
              {actHasMore && (
                <button
                  type="button"
                  disabled={actLoadingMore}
                  onClick={loadMoreActivity}
                  style={s('margin-top:16px;height:36px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12px;cursor:pointer;opacity:' + (actLoadingMore ? '.6' : '1'))}
                >
                  {actLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
          {clientTab === 'manage' && (
            <ClientManagePanel carrierId={client.id} companyName={client.name} />
          )}
        </div>
        <div style={s('flex-shrink:0;padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:13px;cursor:pointer')}>Close</button>
          {clientTab !== 'manage' && (
            <button onClick={onRun} className="ss-btn-p" style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer')}>Run an action</button>
          )}
        </div>
      </div>
    </div>
  );
}
