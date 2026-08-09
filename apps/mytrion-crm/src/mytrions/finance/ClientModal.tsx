import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useCachedLoad } from '../_shared/swrCache';
import { getFinanceClient, type FinanceClient } from '../../api/finance';
import { financeKeys, STALE } from './panelBits';
import {
  DetailsPanel,
  InvoicesPanel,
  PANEL_ICONS,
  PaymentsPanel,
  TransactionsPanel,
} from './modalPanels';
import { EfsPanel, MoneyCodesPanel } from './efsPanels';
import { money0, num } from './financeFormat';

/**
 * Finance → client modal. Wide on purpose: the Invoices / Payments / Transactions tables are 7–9
 * columns of financial history, and squeezing those into a narrow sheet costs the horizontal
 * scanning that makes them readable. Capped at 1320px so it stays a modal rather than a page.
 *
 * Rendered through a portal so the fixed-position scrim escapes the module's scroll container.
 *
 * Loading is per tab: only the mounted panel fetches, so opening the modal costs the Details read
 * alone and the other three never fire unless you click them.
 */

type TabId = 'details' | 'invoices' | 'payments' | 'transactions' | 'efs' | 'moneyCodes';

const TABS: { id: TabId; label: string; icon: keyof typeof PANEL_ICONS; soon?: boolean }[] = [
  { id: 'details', label: 'Details', icon: 'details' },
  { id: 'invoices', label: 'Invoices', icon: 'invoices' },
  { id: 'payments', label: 'Payments', icon: 'payments' },
  { id: 'transactions', label: 'Transactions', icon: 'transactions' },
  { id: 'efs', label: 'EFS', icon: 'efs' },
  { id: 'moneyCodes', label: 'Money Codes', icon: 'moneyCodes' },
];

/** Two initials from the company name — the modal's identity chip. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.charAt(0) ?? '';
  const b = parts[1]?.charAt(0) ?? '';
  return (a + b).toUpperCase() || '—';
}

export function ClientModal({ client, onClose }: { client: FinanceClient; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('details');

  // Details is the landing tab, so its fetch starts with the modal rather than on tab click. Cached,
  // so reopening the same carrier — the common case when working down the debtor list and back — is
  // instant instead of another round-trip.
  const detail = useCachedLoad(
    financeKeys.client(client.carrierId),
    () => getFinanceClient(client.carrierId),
    { staleMs: STALE.CLIENT },
  );

  /*
   * Escape closes, and the page behind must not scroll while the scrim is up.
   *
   * Mount/unmount ONLY — the dep list is deliberately empty and `onClose` is read through a ref.
   *
   * It used to depend on [onClose], and the call site passes `onClose={() => setOpenCarrier(null)}`
   * — a fresh function identity on every parent render. So this effect tore down and re-ran
   * constantly, and each cycle set `document.body.style.overflow` back to '' and then to 'hidden'
   * again. Un-hiding the body for even one frame brings the scrollbar back, which changes the page
   * width by ~15px and shifts everything under the scrim. That is the flicker: not a re-fetch, a
   * scroll-lock being released and re-taken on every render.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  /**
   * The portal mounts on <body>, OUTSIDE `.fi-root` — so the wrapper must re-establish both the
   * Finance token scope (`.fi-scope` carries --fi-debt / --fi-paid / radii) and the module accent
   * (`data-mytrion="finance"` sets --accent). Without it the modal renders with the global accent
   * and no money colours, which is exactly how the badges and red balances went missing.
   */
  const body = (
    <div className="fi-scope" data-mytrion="finance">
      <div
        className="fi-modal-scrim"
        role="presentation"
        // Backdrop click closes; clicks inside the panel must not bubble out to it.
        onClick={onClose}
      >
      <div
        className="fi-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${client.companyName} — finance detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fi-modal-head">
          <span className="fi-modal-avatar">{initials(client.companyName)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="fi-modal-title">{client.companyName}</div>
            <div className="fi-modal-sub">
              <span>#{client.carrierId}</span>
              <span>·</span>
              <span>{client.paymentTerms || 'terms not set'}</span>
              <span>·</span>
              <span>
                {num(client.activeCards)} card{client.activeCards === 1 ? '' : 's'}
              </span>
              {client.isDebtor ? (
                <>
                  <span>·</span>
                  <span className="fi-pill" style={{ ['--p' as string]: 'var(--fi-debt)' }}>
                    {money0(client.computedDebt)} owed
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <button type="button" className="fi-btn fi-btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="fi-modal-tabs" role="tablist">
          {TABS.map((t) => {
            const Icon = PANEL_ICONS[t.icon];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="fi-modal-tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                <Icon size={14} />
                {t.label}
                {t.soon ? <span className="fi-soon">Soon</span> : null}
              </button>
            );
          })}
        </div>

        <div className="fi-modal-body">
          {tab === 'details' ? (
            <DetailsPanel detail={detail.data} loading={detail.loading} error={detail.error} />
          ) : null}
          {tab === 'invoices' ? <InvoicesPanel carrierId={client.carrierId} /> : null}
          {tab === 'payments' ? <PaymentsPanel carrierId={client.carrierId} /> : null}
          {tab === 'transactions' ? <TransactionsPanel carrierId={client.carrierId} /> : null}
          {/* Both read live EFS state and are read-only — initiating a load or issuing/voiding a
              code still needs an audited, role-gated endpoint. See efsPanels.tsx. */}
          {tab === 'efs' ? <EfsPanel carrierId={client.carrierId} /> : null}
          {tab === 'moneyCodes' ? <MoneyCodesPanel carrierId={client.carrierId} /> : null}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
