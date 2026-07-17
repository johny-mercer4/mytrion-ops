import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CircleAlert, LayoutGrid } from 'lucide-react';
import {
  ApiError,
  createDriverInvite,
  driverSelfRegister,
  fetchAccountStatus,
  fetchBalance,
  fetchFleet,
  fetchInvoices,
  fetchLastUsed,
  fetchMiniAppSession,
  fetchPaymentInfo,
  fetchRegistrationPreview,
  fetchTracking,
  renameDriver,
  sendServiceRequest,
  fetchTransactions,
  redeemRegistration,
  sendInvoice,
  sendTransactionsReport,
  type CarrierBalance,
  type FleetCard,
  type LastUsedResult,
  type PaymentInfoResult,
  type RegistrationPreview,
  type RegistrationView,
  type SalesInvoicesResult,
  type StatusResult,
  type TrackingResult,
  type TransactionsResult,
  type TxnExportFormat,
} from './lib/api';
import { getRegistrationId, getTelegramWebApp, haptic, type TelegramWebAppUser } from './lib/telegram';
import { getStoredTheme, initTheme, setTheme, type Theme } from './lib/theme';
import { LANGUAGES, useI18n } from './lib/i18n';
import { LogoLockup } from './components/logo';
import { BackChevron, Chevron, EyeToggle, Icon, SearchGlyph, type IconName } from './components/icons';
import { seedInbox, type InboxItem } from './lib/demo';
import type { OpenAction } from './lib/actionTarget';
import { defaultPinned, findCatalogItem } from './lib/serviceCatalog';
import { ConfirmDialog, type ConfirmConfig } from './components/ConfirmDialog';
import { Toast, type ToastKind, type ToastState } from './components/Toast';
import { TabBar, TABS as HOME_TABS, type HomeTab } from './screens/TabBar';
import { ServicesTab } from './screens/ServicesTab';
import { InboxTab } from './screens/InboxTab';
import { SlideIn } from './components/SlideIn';
import { useSlideDirection } from './lib/useSlideDirection';

const CTA_SHADOW = '0 4px 14px color-mix(in srgb, var(--primary) 34%, transparent)';

type Screen = 'loading' | 'error' | 'confirm' | 'success' | 'already' | 'home' | 'fleet' | 'login';

interface Session {
  isDriver: boolean;
  isOwner: boolean;
  isOwnerOp: boolean;
  isFleetManager: boolean;
  ownCard: string;
  /** Driver's real full fuel-card number (from the backend session), null when unresolved. */
  ownCardNumber: string | null;
  /** The carrier this session belongs to — identity, unlike companyName which is display text and
   *  is routinely null. Anything cached per account must key on this. */
  carrierId: string | null;
}

function cleanAgentName(agentName: string | null | undefined): string | null {
  const name = agentName?.trim();
  return name ? name : null;
}

function sessionFrom(reg: RegistrationView | null): Session {
  const companyType = reg?.companyType ?? null;
  const isDriver = reg?.profile === 'driver';
  const isOwner = reg?.profile === 'owner';
  const isFleetManager = reg?.profile === 'owner' && companyType === 'fleet-manager';
  const isOwnerOp = reg?.profile === 'owner' && companyType !== 'fleet-manager';
  const ownCardNumber = reg?.cardNumber?.trim() || null;
  // Prefer the real card number's last-4; fall back to the cardId's trailing digits when unresolved.
  const ownCard = (ownCardNumber ?? reg?.cardId ?? '7549').slice(-4);
  return {
    isDriver,
    isOwner,
    isOwnerOp,
    isFleetManager,
    ownCard,
    ownCardNumber,
    carrierId: reg?.carrierId ?? null,
  };
}

function initialsOf(user: TelegramWebAppUser | undefined): string {
  const s = ((user?.first_name?.[0] ?? '') + (user?.last_name?.[0] ?? '')).toUpperCase();
  return s || user?.username?.[0]?.toUpperCase() || 'OC';
}

function last4(cardNumber: string | null, cardId: string | null): string {
  const n = cardNumber?.trim();
  if (n && n.length >= 4) return n.slice(-4);
  return cardId ?? '——';
}

/** Same formatting rules as the sales admin's automation runners (apps/mytrion-crm/.../specs.ts) — servercrm figures are `number | string | null`, never pre-formatted. */
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}
/**
 * 'YYYY-MM-DD HH:MM' for a transaction. The clock time is what tells two fuel-ups at the same stop
 * on the same day apart, so it is shown rather than sliced off. The backend sends the mart's
 * `timestamp without time zone` through JSON as "2026-07-16T12:14:00" — no zone, so it is displayed
 * verbatim rather than passed through `new Date()`, which would re-interpret it in the phone's
 * timezone and shift the clock.
 */
/** 'YYYY-MM-DD' for a date input's value, in the device's own timezone. */
function isoDay(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function txnDateTime(v: unknown): string {
  const t = fmt(v);
  return t === '—' ? t : t.replace('T', ' ').slice(0, 16);
}

/**
 * Money always carries both decimal places. With only `maximumFractionDigits` the trailing zeros
 * were dropped, so a screen could show "$1,000" next to "$1,497.94", and a transaction list ran
 * "$327.37 / $324.1 / $14" — the ragged column a client reads as a bug in the numbers themselves.
 */
function money(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmt(v);
}

/**
 * Translate a raw invoice status into a localized label + a tone.
 *
 * servercrm returns PAID / PENDING / PARTIALLY_PAID / CANCELLED (uppercase, English). The list used
 * to print those verbatim in every locale. Normalized to the underscore-and-case-insensitive forms
 * the upstream actually sends; an unrecognized value falls back to its raw text rather than a blank.
 */
function invoiceStatus(raw: unknown, t: (k: string) => string): { label: string; tone: string } {
  const key = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  switch (key) {
    case 'PAID':
      return { label: t('invoice.paid'), tone: 'success' };
    case 'PENDING':
    case 'UNPAID':
      return { label: t('invoice.pending'), tone: 'muted-fg' };
    case 'PARTIALLY_PAID':
      return { label: t('invoice.partiallyPaid'), tone: 'muted-fg' };
    case 'CANCELLED':
    case 'CANCELED':
      return { label: t('invoice.cancelled'), tone: 'destructive' };
    default:
      return { label: fmt(raw), tone: 'muted-fg' };
  }
}

/** Countdown from an ISO deadline: {expired, short:"17h"/"45m"}. */
function countdown(expiresAt: string | null | undefined): { expired: boolean; short: string } {
  if (!expiresAt) return { expired: false, short: '' };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { expired: true, short: '' };
  const h = Math.floor(ms / 3_600_000);
  return { expired: false, short: h >= 1 ? `${h}h` : `${Math.max(1, Math.round(ms / 60_000))}m` };
}

const PINNED_KEY = 'octane.pinnedActions';

function loadStoredPinned(): string[] | null {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function persistPinned(list: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(list));
  } catch {
    // ignore — pins just won't persist
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Small styled primitives (match the prototype's inline styles)

function CtaButton({ children, onClick, disabled, style }: { children: ReactNode; onClick?: () => void; disabled?: boolean; style?: CSSProperties }) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        height: 52,
        border: 'none',
        borderRadius: 14,
        background: 'var(--primary)',
        color: '#FFFFFF',
        fontFamily: "'Geist'",
        fontWeight: 600,
        fontSize: 15,
        cursor: 'pointer',
        boxShadow: CTA_SHADOW,
        opacity: disabled ? 0.6 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Spinner({ size = 34 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        // Theme-adaptive track (faint in both light + dark) with a solid primary arc on top, so the
        // spinner reads clearly against the dark-default background — --secondary was too low-contrast.
        border: '3px solid color-mix(in srgb, var(--primary) 22%, transparent)',
        borderTopColor: 'var(--primary)',
        animation: 'octspin .8s linear infinite',
      }}
    />
  );
}

function Screen({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        ...(center ? { alignItems: 'center', justifyContent: 'center' } : {}),
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Auth-flow screens

/**
 * Fixed to the viewport rather than routed through <Screen>'s flex centering — loading is the one
 * screen that can render before the rest of the app-root's flex chain (header, scroll container)
 * has anything else in it to size against, so it centers itself independently instead of trusting
 * an ancestor's height.
 */
function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, background: 'var(--background)' }}>
      <LogoLockup size={40} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Spinner />
        <div style={{ fontSize: 14, color: 'var(--muted-fg)' }}>{t('loading')}</div>
      </div>
    </div>
  );
}

function SupportCard({ agentName }: { agentName?: string | null | undefined }) {
  const { t } = useI18n();
  const agent = cleanAgentName(agentName);
  return (
    <div
      style={{
        fontSize: 13,
        color: 'var(--muted-fg)',
        textAlign: 'center',
        padding: '12px 16px',
        background: 'var(--secondary)',
        borderRadius: 12,
        maxWidth: 300,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--muted-fg)',
          marginBottom: agent ? 7 : 0,
        }}
      >
        {t('support.title')}
      </div>
      {agent && (
        <>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            {t('support.salesAgent')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>{agent}</div>
        </>
      )}
      <div style={{ lineHeight: 1.5 }}>{agent ? t('support.contactAgent', { agent }) : t('support.contactGeneric')}</div>
    </div>
  );
}

function ErrorScreen({
  title,
  reason,
  agentName,
}: {
  title?: string;
  reason: string;
  agentName?: string | null | undefined;
}) {
  const { t } = useI18n();
  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <LogoLockup size={32} />
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'color-mix(in srgb, var(--destructive) 14%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'octpop .35s ease',
          }}
        >
          <CircleAlert size={30} strokeWidth={2.2} color="var(--destructive)" aria-hidden />
        </div>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>{title ?? t('error.title')}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted-fg)' }}>{reason}</div>
        </div>
        <SupportCard agentName={agentName} />
      </div>
    </Screen>
  );
}

function DetailCard({ children }: { children: ReactNode }) {
  return <div style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 16, overflow: 'hidden' }}>{children}</div>;
}

function ConfirmScreen({ preview, firstName, busy, onConfirm }: { preview: RegistrationPreview; firstName: string; busy: boolean; onConfirm: () => void }) {
  const { t } = useI18n();
  const isOwner = preview.profile === 'owner';
  const ownerLabel = preview.companyType === 'fleet-manager' ? t('role.fleet') : t('role.owner');
  const cd = countdown(preview.expiresAt);
  const agent = cleanAgentName(preview.agentName);
  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%', maxWidth: 342, animation: 'octfade .3s ease' }}>
        <LogoLockup size={40} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-.01em' }}>{t('confirm.hi', { name: firstName })}</div>
          <div style={{ fontSize: 14, color: 'var(--muted-fg)', marginTop: 5 }}>{isOwner ? t('confirm.owner') : t('confirm.driver')}</div>
        </div>
        <DetailCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '15px 16px' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('confirm.company')}</span>
            <span className="selectable" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', textAlign: 'right' }}>{preview.companyName ?? '—'}</span>
          </div>
          <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '15px 16px' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)' }}>{isOwner ? t('confirm.accountType') : t('confirm.role')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', padding: '5px 11px', borderRadius: 8, background: 'var(--secondary)' }}>
              {isOwner ? ownerLabel : t('role.driver')}
            </span>
          </div>
          {agent && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '15px 16px' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('confirm.agentLabel')}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', textAlign: 'right' }}>{agent}</span>
              </div>
            </>
          )}
        </DetailCard>
        <CtaButton onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner size={20} /> : t('confirm.cta')}
        </CtaButton>
        {!cd.expired && cd.short && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--link-accent)', fontSize: 12, fontWeight: 600 }}>
            <Icon name="clock" size={13} strokeWidth={2} className="" />
            <span>{t('confirm.expires', { time: cd.short })}</span>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted-fg)', textAlign: 'center', lineHeight: 1.5 }}>{t('confirm.footnote')}</div>
        <SupportCard agentName={preview.agentName} />
      </div>
    </Screen>
  );
}

/**
 * Onboarding entry when there's no invite link + no prior registration: choose Driver or Company.
 * Driver self-registers by fuel-card number (the number is on the physical card); Company accounts
 * are invite-only, so that branch just points to the registration link.
 */
function LoginScreen({
  firstName,
  defaultName,
  onDriverRegister,
}: {
  firstName: string;
  /** The Telegram profile name, used to prefill — not to decide. See `name` below. */
  defaultName: string;
  onDriverRegister: (cardNumber: string, driverName: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [role, setRole] = useState<'choose' | 'driver' | 'company'>('choose');
  const [card, setCard] = useState('');
  /**
   * Prefilled from Telegram, but the driver's to correct. This name is what their OWNER sees beside
   * this card in the fleet roster and what support reads on a ticket — and a Telegram display name
   * is whatever the person happened to set: a nickname, an emoji, the phone's default. It was being
   * taken silently.
   */
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const value = card.replace(/\s/g, '');
    if (value.length < 4) {
      setError(t('login.cardInvalid'));
      return;
    }
    const who = name.trim();
    if (!who) {
      setError(t('login.nameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    haptic('tap');
    try {
      await onDriverRegister(value, who);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('error.reason'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%', maxWidth: 342, animation: 'octfade .3s ease' }}>
        <LogoLockup size={40} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-.01em' }}>{t('confirm.hi', { name: firstName })}</div>
          <div style={{ fontSize: 14, color: 'var(--muted-fg)', marginTop: 5 }}>{t('login.subtitle')}</div>
        </div>

        {role === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            {([
              { key: 'driver', icon: 'truck' as const, label: t('login.driver'), sub: t('login.driverSub'), primary: true },
              { key: 'company', icon: 'users' as const, label: t('login.company'), sub: t('login.companySub'), primary: false },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                className="press"
                onClick={() => { haptic('tap'); setRole(opt.key); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  textAlign: 'left',
                  padding: '15px 16px',
                  border: opt.primary ? 'none' : '1px solid var(--border)',
                  borderRadius: 16,
                  background: opt.primary ? 'var(--primary)' : 'var(--card)',
                  boxShadow: opt.primary ? CTA_SHADOW : 'var(--card-shadow)',
                  color: opt.primary ? '#FFFFFF' : 'var(--fg)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: opt.primary ? 'rgba(255,255,255,.18)' : 'var(--secondary)', color: opt.primary ? '#FFFFFF' : 'var(--link-accent)' }}>
                  <Icon name={opt.icon} size={22} strokeWidth={1.9} className="" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>{opt.label}</span>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginTop: 2, color: opt.primary ? 'rgba(255,255,255,.8)' : 'var(--muted-fg)' }}>{opt.sub}</span>
                </span>
                {opt.primary ? <Chevron style={{ color: 'rgba(255,255,255,.85)' }} /> : <Chevron />}
              </button>
            ))}
          </div>
        )}

        {role === 'driver' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            <label style={{ width: '100%' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 7 }}>{t('login.cardPrompt')}</span>
              <input
                value={card}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => setCard(groupCardNumber(e.target.value.replace(/\D/g, '').slice(0, 19)))}
                placeholder={t('login.cardPlaceholder')}
                style={{ width: '100%', minWidth: 0, height: 50, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 16, fontVariantNumeric: 'tabular-nums', letterSpacing: '.04em', padding: '0 14px', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ width: '100%' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 7 }}>{t('login.namePrompt')}</span>
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value.slice(0, 200))}
                placeholder={t('login.namePlaceholder')}
                style={{ width: '100%', minWidth: 0, height: 50, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 16, padding: '0 14px', boxSizing: 'border-box' }}
              />
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted-fg)', marginTop: 6, lineHeight: 1.45 }}>{t('login.nameHint')}</span>
            </label>
            {error && <div style={{ fontSize: 13, color: 'var(--destructive)', lineHeight: 1.45 }}>{error}</div>}
            <CtaButton onClick={() => void submit()} disabled={busy}>
              {busy ? <Spinner size={20} /> : t('login.continue')}
            </CtaButton>
            <button type="button" className="press" onClick={() => { setRole('choose'); setError(''); }} style={{ border: 'none', background: 'transparent', color: 'var(--muted-fg)', fontFamily: "'Geist'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 6 }}>
              {t('common.back')}
            </button>
          </div>
        )}

        {role === 'company' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', alignItems: 'center' }}>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--muted-fg)', textAlign: 'center', padding: '14px 16px', background: 'var(--secondary)', borderRadius: 14 }}>{t('login.companyInfo')}</div>
            <button type="button" className="press" onClick={() => setRole('choose')} style={{ border: 'none', background: 'transparent', color: 'var(--muted-fg)', fontFamily: "'Geist'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 6 }}>
              {t('common.back')}
            </button>
          </div>
        )}
      </div>
    </Screen>
  );
}

function SuccessScreen({ session, company, onContinue }: { session: Session; company: string; onContinue: () => void }) {
  const { t } = useI18n();
  const sub = session.isFleetManager ? t('success.fleet', { company }) : session.isDriver ? t('success.driver', { company }) : t('success.owner', { company });
  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 78, height: 78, borderRadius: '50%', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'octpop .4s ease' }}>
          <Icon name="check" size={36} strokeWidth={2.6} className="" />
        </div>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--fg)' }}>{t('success.title')}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted-fg)', marginTop: 6 }}>{sub}</div>
        </div>
        <CtaButton onClick={onContinue} style={{ maxWidth: 300 }}>{t('continue')}</CtaButton>
      </div>
    </Screen>
  );
}

function AlreadyScreen({
  company,
  agentName,
  onContinue,
}: {
  company: string;
  agentName?: string | null | undefined;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <div style={{ width: 74, height: 74, borderRadius: '50%', background: 'var(--secondary)', color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={34} strokeWidth={2.4} className="" />
        </div>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)' }}>{t('already.title')}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted-fg)', marginTop: 6 }}>{t('already.body', { company })}</div>
        </div>
        <CtaButton onClick={onContinue} style={{ maxWidth: 300 }}>{t('continue')}</CtaButton>
        <SupportCard agentName={agentName} />
      </div>
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Signed-in header

function AppHeader({ user, onOpenProfile }: { user: TelegramWebAppUser | undefined; onOpenProfile: () => void }) {
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(13px + env(safe-area-inset-top)) 18px 13px', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
      <LogoLockup size={34} />
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Profile"
        /**
         * 44×44 tap target (Apple HIG / WCAG 2.5.5 minimum; the avatar alone was 37), with the
         * visible avatar kept at 38 inside it. The button itself is a transparent box — growing the
         * avatar to 44 would have made it the tallest thing in the header and pushed the whole bar
         * down 7px, so the extra reach overhangs into the header's padding instead.
         */
        style={{ width: 44, height: 44, margin: '-3px -3px -3px 0', border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
      >
        <span style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--card),0 0 0 3px var(--border)', background: user?.photo_url ? undefined : 'var(--primary)' }}>
          {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(user)}
        </span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Home

/** Group a raw digit string into 4s for readability (real EFS PANs are 19 digits → 5 groups). */
function groupCardNumber(n: string): string {
  const digits = n.replace(/\D/g, '');
  return digits.replace(/(.{4})/g, '$1 ').trim() || n;
}

/** Masked PAN in the physical-card style: all-but-last-4 as asterisks + the real last 4. */
/**
 * The hero card mimics the PHYSICAL card, which prints the masked number as asterisks — so this one
 * does too. The transaction rows and the exported report deliberately keep `•••• 7549`: those are
 * app and document chrome, not a picture of the card in the driver's hand.
 *
 * Not length-faithful: an EFS PAN is 19 digits, and masking to its real 4-4-4-4-3 grouping splits
 * the last four across groups as `•••7 549`, which reads as if the last four were "549".
 */
function maskedCardNumber(n: string): string {
  const digits = n.replace(/\D/g, '');
  const last4 = digits.slice(-4) || n.slice(-4);
  return `${'*'.repeat(Math.max(digits.length - last4.length, 8))} ${last4}`;
}

/** Smooth an array of anchor points into a flowing SVG path (midpoint-quadratic smoothing). */
function smoothWavePath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x},${prev.y} ${mx},${my}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * The fuel-card's signature ribbon: a dense bundle of thin lines flowing through a
 * yellow→orange→red gradient (matches the physical Octane card). The bundle is drawn by
 * interpolating each line between a TOP and BOTTOM edge curve — the two edges have different
 * shapes, so the lines fan apart and converge organically (flatter yellow left, a pronounced hump
 * on the orange-red right) instead of reading as rigidly-parallel stripes.
 */
/** Faint topographic contour lines flowing across the whole card (matches the physical card's
 * etched background). Many gently-offset copies of one wave, very low-opacity white. */
function CardContours() {
  const base = [
    { x: -20, y: 96 },
    { x: 70, y: 70 },
    { x: 150, y: 100 },
    { x: 230, y: 74 },
    { x: 310, y: 58 },
    { x: 380, y: 86 },
    { x: 420, y: 80 },
  ];
  return (
    // opacity 0.09 -> 0.045 and a thinner stroke: these were set to survive under the amber ribbon.
    // Without it they are the card's only texture, and at the old weight they compete with the
    // figures instead of sitting behind them.
    <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.045 }} viewBox="0 0 400 200" preserveAspectRatio="none" fill="none" stroke="#FFFFFF" strokeWidth={0.55}>
      {Array.from({ length: 26 }, (_, i) => (
        <path key={i} d={smoothWavePath(base.map((p) => ({ x: p.x, y: p.y - 96 + i * 8.5 })))} />
      ))}
    </svg>
  );
}

/**
 * The proportion of a real fuel card: ISO/IEC 7810 ID-1, 85.60 x 53.98 mm.
 *
 * Both heroes imitate the plastic, so the plastic decides the shape — this is not a taste number.
 * They were 1.5 (owner) and 1.55 (driver), i.e. both TALLER than the thing they depict, and the
 * owner — which carries the least content — was the tallest of the two. Because the card's height
 * is derived from the ratio and its content is laid out space-between, the surplus showed up as a
 * 64px void between the company name and the balance.
 */
const CARD_RATIO = '1.586 / 1';

const BALANCE_KEY = 'octane.lastBalance';

/**
 * Last-known balance, so coming back to Home paints the number instead of "—".
 *
 * The balance endpoint reaches live EFS through servercrm and takes 1.9–3.3s (measured), and Home
 * unmounts whenever you visit Services or Inbox — so every return trip re-ran that wait. The cached
 * value is only ever the FIRST paint: the fetch below still runs and overwrites it, so a stale
 * figure is on screen for one request, not for a session.
 *
 * Scoped by CARRIER ID, not company name. The name is display text and is routinely null — an
 * invite created without one, or any registration whose companyName never got filled. Two empty
 * names compared equal, so the scope collapsed and the cache hit across accounts: measured, after
 * re-registering from carrier 5794015 to 5791860 the hero showed KBUFF TRUCKING's $2,000 balance and
 * $70,547 credit line under EL PROSSIAH LLC for ~2s before the fetch landed. A name is also not
 * identity — it can repeat and it can change. The carrier id is both always present and the thing
 * that actually distinguishes one carrier's money from another's.
 */
/**
 * The carrier balance, painted from cache first and refreshed in the background.
 *
 * Shared by both heroes on purpose: the endpoint takes 1.9–3.3s (it reaches live EFS through
 * servercrm) and Home unmounts on every trip to Services or Inbox, so both cards need the same
 * cache-then-refresh behaviour. Two copies of it would drift.
 *
 * Returns null only until the FIRST ever response — that is the one state worth a skeleton.
 */
interface BalanceState {
  balance: CarrierBalance | null;
  /** The fetch failed AND there is no cached figure to fall back on — the card has nothing true to
   *  show and must say so rather than skeleton forever. */
  failed: boolean;
  retry: () => void;
}

function useCarrierBalance(initData: string, carrierId: string | null): BalanceState {
  const [balance, setBalance] = useState<CarrierBalance | null>(() => readCachedBalance(carrierId));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchBalance(initData)
      .then((v) => {
        if (cancelled) return;
        setBalance(v);
        writeCachedBalance(carrierId, v);
      })
      .catch(() => {
        // Previously swallowed. The card then sat on its skeleton forever, telling the driver it was
        // loading something that had already failed — measured against a real outage: the balance
        // endpoint 502'd and the hero span animated indefinitely. A cached figure for THIS carrier
        // is still theirs and worth showing; with nothing cached, the card has to admit it.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initData, carrierId, attempt]);
  return { balance, failed, retry: () => setAttempt((n) => n + 1) };
}

function readCachedBalance(carrierId: string | null): CarrierBalance | null {
  // No carrier resolved yet — there is nothing to key on, so a hit would be a guess.
  if (!carrierId) return null;
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { carrierId?: string; balance?: CarrierBalance };
    return v.carrierId === carrierId && v.balance ? v.balance : null;
  } catch {
    return null; // unparseable or storage blocked — just fetch
  }
}

function writeCachedBalance(carrierId: string | null, balance: CarrierBalance): void {
  if (!carrierId) return;
  try {
    localStorage.setItem(BALANCE_KEY, JSON.stringify({ carrierId, balance }));
  } catch {
    /* storage can be unavailable (private mode / quota) — the cache is an optimisation, not state */
  }
}

function OwnerHero({ initData, company, carrierId, onOpenDetails }: { initData: string; company: string; carrierId: string | null; onOpenDetails: () => void }) {
  const { t } = useI18n();
  const { balance, failed: balanceFailed, retry: retryBalance } = useCarrierBalance(initData, carrierId);
  const creditLimit = balance?.credit_limit != null ? Number(balance.credit_limit) : null;
  const creditRemaining = balance?.credit_remaining != null ? Number(balance.credit_remaining) : null;
  // 100 was the fallback when there is no balance, which painted a FULL bar — i.e. "all your
  // credit is available" — while the number above it was still loading or had failed outright.
  // null means the bar has nothing true to draw and is not drawn.
  const pct = creditLimit && creditRemaining != null && creditLimit > 0 ? Math.max(0, Math.min(100, (creditRemaining / creditLimit) * 100)) : null;
  const eyebrow = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.62)', textTransform: 'uppercase' } as const;
  return (
    /* Deliberately NOT the fuel-card shell DriverHero uses. That card shows a PAN and depicts the
       plastic, so the plastic's proportion belongs on it. This one shows a company name and a
       balance — an account panel, not a card. Constraining it to the card ratio invented 52px of
       void between the only two things it displays, so its height comes from its content. */
    <div style={{ position: 'relative', background: '#161719', borderRadius: 20, overflow: 'hidden', padding: '15px 17px', display: 'flex', flexDirection: 'column' }}>
      {/* Contours only. The amber ribbon is out for now, and the scrims went with it: they existed
          solely to keep text legible on top of it, and the shell is already near-black. */}
      <CardContours />

      {/* Top row: company left, Details button right */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ minWidth: 0, flex: 1, fontSize: 15, fontWeight: 700, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company || ''}</span>
        <button type="button" className="press" onClick={onOpenDetails} style={{ height: 30, flex: 'none', background: 'rgba(255,255,255,.16)', border: 'none', borderRadius: 9, padding: '0 12px', fontSize: 12.5, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer' }}>
          {t('common.details')}
        </button>
      </div>

      {/* Bottom block: balance amount + credit bar + credit-available (compact) */}
      {/* The separation from the header is this padding now, not surplus the aspect ratio had to
          dump somewhere. 10px was what the ratio left behind and reads cramped under a 30px
          header row; 22 is the breathing room the old 64px void was accidentally providing. */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={eyebrow}>{t('home.efsBalance')}</span>
          {balance ? (
            <span className="selectable" style={{ fontSize: 32, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1.02, letterSpacing: '-.01em' }}>
              {money(balance.efs_balance ?? balance.balance)}
            </span>
          ) : (
            /* Only the very first open lands here — after that the cache paints a real number. A
               shimmer reads as "loading"; a bare "—" reads as "your balance is unknown". */
            balanceFailed ? (
              /* A skeleton here would claim the number is still coming. It isn't — the fetch failed,
                 and without a retry the only way out is closing the app. */
              <button
                type="button"
                className="press"
                onClick={retryBalance}
                style={{ alignSelf: 'flex-start', marginTop: 7, display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'rgba(255,255,255,.14)', color: '#FFFFFF', borderRadius: 9, padding: '7px 12px', fontFamily: "'Geist'", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                <Icon name="refresh" size={14} strokeWidth={2.2} className="" />
                {t('home.balanceRetry')}
              </button>
            ) : (
            <span aria-label={t('home.efsBalance')} style={{ display: 'block', width: 168, height: 33, borderRadius: 9, background: 'rgba(255,255,255,.13)', animation: 'octskeleton 1.3s ease-in-out infinite' }} />
            )
          )}
        </div>
        {pct != null && (
          <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,.18)' }}>
            <div style={{ width: `${pct}%`, background: 'var(--primary)', borderRadius: 3 }} />
          </div>
        )}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.88)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {creditLimit != null && creditRemaining != null
            ? t('home.creditAvailable', { amt: money(creditRemaining) })
            : balance
              ? (balance.efs_error ?? t('home.balanceNote'))
              : '\u00A0'}
        </div>
      </div>
    </div>
  );
}

function DriverHero({
  session,
  company,
  carrierId,
  fullName,
  initData,
  revealed,
  onToggleReveal,
}: {
  session: Session;
  company: string;
  carrierId: string | null;
  fullName: string;
  initData: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  const { t } = useI18n();
  // A driver's catalog lists "Check available balance" (docx), and that service already reads this
  // same carrier balance — so the card leads with it rather than making them open a sheet for it.
  const { balance, failed: balanceFailed, retry: retryBalance } = useCarrierBalance(initData, carrierId);
  // No invented fallback: if the DWH has not resolved the real PAN there is nothing truthful to
  // show, so the number skeletons rather than displaying a fiction the Copy button would hand out.
  const realFull = session.ownCardNumber;
  const display = realFull ? (revealed ? groupCardNumber(realFull) : maskedCardNumber(realFull)) : null;
  return (
    <>
      <div style={{ position: 'relative', background: '#161719', borderRadius: 20, overflow: 'hidden', padding: '15px 17px', aspectRatio: CARD_RATIO, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <CardContours />

        {/* Top band: driver name left, company + reveal right — the toggle rides at the card's top
            corner the way a payment app puts it, and where the owner card already puts Details. */}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{fullName}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none', maxWidth: '58%' }}>
            {company && (
              <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</span>
            )}
            <button type="button" className="press" aria-label={revealed ? 'Hide card details' : 'Show card details'} onClick={onToggleReveal} style={{ width: 30, height: 30, flex: 'none', border: 'none', borderRadius: 9, background: 'rgba(255,255,255,.15)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <EyeToggle revealed={revealed} size={15} />
            </button>
          </div>
        </div>

        {/* Balance mid-card: the figure a driver opens the app for, and the same value their
            catalog's "Check available balance" reads. */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.62)', textTransform: 'uppercase' }}>{t('home.efsBalance')}</span>
          {balance ? (
            /* The eye is the card's privacy toggle, not just the number's — it covers every figure
               on the card, the way a payment app's does. `selectable` only while revealed, so a
               drag can't lift the mask characters as if they were the amount. */
            <span
              className={revealed ? 'selectable' : ''}
              style={{ fontSize: 28, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1.02, letterSpacing: '-.01em' }}
            >
              {revealed ? money(balance.efs_balance ?? balance.balance) : '• • • •'}
            </span>
          ) : (
            balanceFailed ? (
              /* A skeleton here would claim the number is still coming. It isn't. */
              <button
                type="button"
                className="press"
                onClick={retryBalance}
                style={{ alignSelf: 'flex-start', marginTop: 6, display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'rgba(255,255,255,.14)', color: '#FFFFFF', borderRadius: 9, padding: '6px 11px', fontFamily: "'Geist'", fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                <Icon name="refresh" size={13} strokeWidth={2.2} className="" />
                {t('home.balanceRetry')}
              </button>
            ) : (
            <span aria-label={t('home.efsBalance')} style={{ display: 'block', width: 148, height: 29, borderRadius: 8, background: 'rgba(255,255,255,.13)', animation: 'octskeleton 1.3s ease-in-out infinite' }} />
            )
          )}
        </div>

        {/* Card number last. The number stays `selectable`, so it can still be picked up by hand. */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.1em', color: 'rgba(255,255,255,.62)', textTransform: 'uppercase' }}>{t('card.numberLabel')}</span>
          {display ? (
            <span className={revealed ? 'selectable' : ''} style={{ fontSize: 18, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em', whiteSpace: 'nowrap' }}>{display}</span>
          ) : (
            <span aria-label={t('card.numberLabel')} style={{ display: 'block', width: 196, height: 19, borderRadius: 6, background: 'rgba(255,255,255,.13)', animation: 'octskeleton 1.3s ease-in-out infinite' }} />
          )}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted-fg)', margin: '-6px 4px 0' }}>{t('home.cardStanding')}</div>
    </>
  );
}

interface HomeProps {
  session: Session;
  tab: HomeTab;
  company: string;
  fullName: string;
  initData: string;
  pinned: string[];
  inbox: InboxItem[];
  cardRevealed: boolean;
  onToggleCardReveal: () => void;
  onTogglePin: (key: string) => void;
  onOpenAction: (target: OpenAction) => void;
  onGoToServices: () => void;
  onViewFleet: () => void;
  onMarkAllRead: () => void;
  onReadNotif: (id: string) => void;
}

function Home({
  session,
  tab,
  company,
  fullName,
  initData,
  pinned,
  inbox,
  cardRevealed,
  onToggleCardReveal,
  onTogglePin,
  onOpenAction,
  onGoToServices,
  onViewFleet,
  onMarkAllRead,
  onReadNotif,
}: HomeProps) {
  const { t } = useI18n();
  const slideDir = useSlideDirection(tab, HOME_TABS);

  if (tab === 'services') return <SlideIn key={tab} dir={slideDir}><ServicesTab isDriver={session.isDriver} pinned={pinned} onTogglePin={onTogglePin} onOpen={onOpenAction} /></SlideIn>;
  if (tab === 'inbox') return <SlideIn key={tab} dir={slideDir}><InboxTab items={inbox} onMarkAllRead={onMarkAllRead} onRead={onReadNotif} /></SlideIn>;

  const pinnedItems = pinned.map((key) => findCatalogItem(key, session.isDriver)).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <SlideIn key={tab} dir={slideDir}>
    <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {session.isDriver ? (
        <DriverHero session={session} company={company} carrierId={session.carrierId} fullName={fullName} initData={initData} revealed={cardRevealed} onToggleReveal={onToggleCardReveal} />
      ) : (
        <OwnerHero initData={initData} company={company} carrierId={session.carrierId} onOpenDetails={() => onOpenAction({ kind: 'service', key: 'status' })} />
      )}

      {/* quick actions */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, background: 'var(--secondary)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg)' }}>
            <LayoutGrid size={20} strokeWidth={2} fill="currentColor" aria-hidden />
          </div>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{t('home.quickActions')}</div>
          <button type="button" className="press" onClick={onGoToServices} style={{ height: 40, background: 'var(--secondary)', border: 'none', borderRadius: 12, padding: '0 16px', fontSize: 14, fontWeight: 600, color: 'var(--fg)', cursor: 'pointer' }}>
            {t('home.edit')}
          </button>
        </div>
        {pinnedItems.length === 0 && <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--muted-fg)', fontSize: 13 }}>{t('home.actionsEmpty')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {pinnedItems.map(({ item, groupLabelKey }) => (
            <button
              key={item.key}
              type="button"
              className="press"
              onClick={() => {
                if (item.action === 'generic') onOpenAction({ kind: 'generic', key: item.key, title: t(item.labelKey), ...(item.request ? { request: item.request } : {}) });
                else if (item.action) onOpenAction({ kind: 'service', key: item.action });
              }}
              style={{ textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', padding: '12px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%', fontFamily: "'Geist'" }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--secondary)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <Icon name={item.icon} size={19} strokeWidth={1.7} className="" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>{t(item.labelKey)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 2, lineHeight: 1.35 }}>{t(groupLabelKey)}</div>
              </div>
              <Chevron />
            </button>
          ))}
        </div>
      </div>

      {/* manage fleet */}
      {session.isFleetManager && (
        <button type="button" className="press" onClick={onViewFleet} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 24, padding: 18, cursor: 'pointer', fontFamily: "'Geist'" }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--secondary)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="card" size={22} strokeWidth={1.7} className="" />
            </span>
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>{t('home.manageFleet')}</span>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--muted-fg)', marginTop: 3 }}>{t('home.manageFleetSub')}</span>
            </span>
          </span>
          <Chevron />
        </button>
      )}
    </div>
    </SlideIn>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--muted-fg)', margin: '0 2px 11px' }}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fleet

const FILTERS = ['all', 'registered', 'pending', 'open'] as const;
type FilterKey = (typeof FILTERS)[number];
const FILTER_LABEL: Record<FilterKey, string> = { all: 'filter.all', registered: 'filter.registered', pending: 'filter.pending', open: 'filter.open' };

interface RowView extends FleetCard {
  expired: boolean;
  statusWord: string;
  statusColor: string;
  iconBg: string;
  iconColor: string;
  iconName: IconName;
}

function fleetRow(t: (k: string) => string, c: FleetCard): RowView {
  const cd = countdown(c.expiresAt);
  const expired = c.status === 'pending' && cd.expired;
  const meta =
    c.status === 'registered'
      ? { w: t('card.registered'), c: 'var(--success)', icon: 'check' as IconName }
      : expired
        ? { w: t('card.expired'), c: 'var(--destructive)', icon: 'clock' as IconName }
        : c.status === 'pending'
          ? { w: t('card.pending'), c: 'var(--link-accent)', icon: 'plane' as IconName }
          : { w: t('card.open'), c: 'var(--muted-fg)', icon: 'userplus' as IconName };
  return { ...c, expired, statusWord: meta.w, statusColor: meta.c, iconBg: 'var(--secondary)', iconColor: meta.c, iconName: meta.icon };
}

function FleetView({
  cards,
  loading,
  loadError,
  actionError,
  onBack,
  onRetry,
  onCreate,
  onRegenerate,
  onRename,
  showToast,
  askConfirm,
}: {
  cards: FleetCard[];
  loading: boolean;
  loadError: string;
  actionError: string;
  onBack: () => void;
  onRetry: () => void;
  onCreate: (cardId: string, name: string) => Promise<void>;
  onRegenerate: (cardId: string, name: string) => Promise<void>;
  onRename: (cardId: string, driverName: string) => Promise<void>;
  showToast: (msg: string, kind?: ToastKind) => void;
  askConfirm: (cfg: ConfirmConfig) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = cards.map((c) => fleetRow(t, c));
  const total = cards.length;
  const counts = {
    all: total,
    registered: rows.filter((r) => r.status === 'registered').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    open: rows.filter((r) => r.status === 'open').length,
  };
  const registeredCount = counts.registered;
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (q) {
      const hay = `${last4(r.cardNumber, r.cardId)} ${(r.driverName ?? 'unassigned')} ${r.cardType ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  function copy(link: string, id: string) {
    try {
      navigator.clipboard?.writeText(link);
    } catch {
      /* ignore */
    }
    haptic('tap');
    setCopiedId(id);
    showToast(t('toast.linkCopied'));
    setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 1600);
  }

  /** `nameOverride` covers regenerate: that flow has no name input, so it must reuse the card's existing driver name instead of an (empty) draft. */
  async function run(cardId: string, fn: (id: string, name: string) => Promise<void>, nameOverride?: string) {
    const name = nameOverride ?? (drafts[cardId] ?? '').trim();
    setBusyId(cardId);
    try {
      await fn(cardId, name);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ padding: '0 16px 44px' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 4, background: 'var(--background)', margin: '0 -16px', padding: '10px 16px 2px' }}>
        <button type="button" className="press" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--muted-fg)', fontFamily: "'Geist'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 8px 6px 0', marginBottom: 2 }}>
          <BackChevron />
          <span>{t('common.home')}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '2px 2px 12px' }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)' }}>{t('fleet.title')}</span>
          <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted-fg)' }}>{t('fleet.count', { n: registeredCount, total })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 44, padding: '0 13px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 10 }}>
          <SearchGlyph />
          <input className="selectable" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('fleet.search')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 14 }} />
        </div>
        <div className="hscroll" style={{ display: 'flex', gap: 8, marginBottom: 14, paddingBottom: 2 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button key={f} type="button" onClick={() => { haptic('tap'); setFilter(f); }} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', height: 40, padding: '0 14px', borderRadius: 11, fontFamily: "'Geist'", fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', background: active ? 'var(--primary)' : 'var(--secondary)', color: active ? '#FFFFFF' : 'var(--muted-fg)' }}>
                <span>{t(FILTER_LABEL[f])}</span>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: active ? 1 : 0.65 }}>{counts[f]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 4px', color: 'var(--muted-fg)' }}>
          <Spinner size={22} />
          <span style={{ fontSize: 14 }}>{t('fleet.loading')}</span>
        </div>
      )}
      {!loading && loadError && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: '20px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--destructive) 14%, transparent)', color: 'var(--destructive)' }}>
              <CircleAlert size={18} strokeWidth={2} aria-hidden />
            </span>
            <span style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.4 }}>{loadError}</span>
          </div>
          <button type="button" className="press" onClick={onRetry} style={{ height: 42, border: 'none', borderRadius: 11, background: 'var(--secondary)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: '0 16px' }}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && actionError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', color: 'var(--destructive)', fontSize: 13, lineHeight: 1.45 }}>
          <CircleAlert size={16} strokeWidth={2} style={{ flex: 'none' }} aria-hidden />
          <span>{actionError}</span>
        </div>
      )}
      {!loading && !loadError && total > 0 && shown.length === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('fleet.noMatch')}</div>
      )}
      {!loading && !loadError && total === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('fleet.empty')}</div>
      )}

      {!loading && !loadError && shown.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 24, overflow: 'hidden' }}>
          {shown.map((c) => {
            const id = c.cardId ?? '';
            const expanded = expandedId === id;
            const showLink = c.status === 'pending' && !c.expired && !!c.link;
            const busy = busyId === id;
            return (
              <div key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                <div onClick={() => setExpandedId((x) => (x === id ? null : id))} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', minHeight: 64, cursor: 'pointer' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 13, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.iconBg, color: c.iconColor }}>
                    <Icon name={c.iconName} size={18} strokeWidth={2} className="" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="selectable" style={{ fontWeight: 700, fontSize: 15, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em' }}>•••• {last4(c.cardNumber, c.cardId)}</span>
                      {c.cardType && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--muted-fg)', background: 'var(--secondary)', padding: '2px 6px', borderRadius: 6 }}>{c.cardType}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.driverName ?? t('card.unassigned')}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: c.statusColor, background: 'var(--secondary)', padding: '5px 10px', borderRadius: 9, flex: 'none' }}>{c.statusWord}</span>
                  <Chevron style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s ease' }} />
                </div>

                {expanded && (
                  <div style={{ padding: '0 15px 16px', animation: 'octfade .2s ease' }}>
                    {c.status === 'open' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('card.name')}</label>
                        <input className="selectable" value={drafts[id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))} placeholder={t('card.namePh')} style={{ height: 46, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 15, padding: '0 13px', width: '100%' }} />
                        <button
                          type="button"
                          className="press"
                          disabled={busy || !(drafts[id] ?? '').trim()}
                          onClick={() => void run(id, onCreate)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, border: 'none', borderRadius: 12, background: 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: busy || !(drafts[id] ?? '').trim() ? 0.6 : 1 }}
                        >
                          {busy ? <Spinner size={18} /> : t('card.create')}
                        </button>
                      </div>
                    )}
                    {showLink && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('card.linkFor', { name: c.driverName ?? '' })}</div>
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                          <div className="selectable" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '0 12px', height: 46, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', fontSize: 12.5, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.link}</div>
                          <button type="button" className="press" onClick={() => copy(c.link!, id)} style={{ height: 46, border: 'none', borderRadius: 12, fontFamily: "'Geist'", fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: '0 16px', flex: 'none', background: copiedId === id ? 'var(--success)' : 'var(--primary)', color: '#FFFFFF' }}>
                            {copiedId === id ? t('card.copied') : t('card.copy')}
                          </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--link-accent)' }}>
                          <Icon name="clock" size={13} strokeWidth={2} className="" />
                          <span>{t('card.expiresIn', { time: countdown(c.expiresAt).short })}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted-fg)', lineHeight: 1.45 }}>{t('card.share')}</div>
                      </div>
                    )}
                    {c.status === 'pending' && c.expired && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', borderRadius: 12 }}>
                          <span style={{ flex: 'none', color: 'var(--destructive)' }}><Icon name="clock" size={16} strokeWidth={2} className="" /></span>
                          <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>{t('card.expiredNotice', { name: c.driverName ?? '' })}</div>
                        </div>
                        <button
                          type="button"
                          className="press"
                          disabled={busy}
                          onClick={() =>
                            askConfirm({
                              title: t('confirm.regenTitle'),
                              body: t('confirm.regenBody'),
                              okLabel: t('confirm.regenOk'),
                              onConfirm: () => void run(id, onRegenerate, c.driverName ?? ''),
                            })
                          }
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, border: 'none', borderRadius: 12, background: 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                        >
                          {busy ? <Spinner size={18} /> : t('card.regenerate')}
                        </button>
                      </div>
                    )}
                    {c.status === 'registered' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--background)', borderRadius: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', flex: 'none' }} />
                        <div style={{ fontSize: 13, color: 'var(--fg)' }}>{t('card.registeredInfo', { name: c.driverName ?? '' })}</div>
                      </div>
                    )}
                    {/* Rename, for a card that HAS a driver. A self-registering driver types their own
                        name, and a pending invite carries whatever was typed when it was issued —
                        either can be wrong, and this roster is what the owner reads. */}
                    {c.cardId && (c.status === 'registered' || c.status === 'pending') && (
                      <RenameDriver
                        cardId={c.cardId}
                        currentName={c.driverName ?? ''}
                        onRename={onRename}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Inline driver rename on a fleet card. Collapsed to a link until tapped — the roster is read far
 *  more often than it is corrected, so an always-open input would be noise on every row. */
function RenameDriver({
  cardId,
  currentName,
  onRename,
}: {
  cardId: string;
  currentName: string;
  onRename: (cardId: string, driverName: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const next = value.trim();
    if (!next) {
      setError(t('card.renameRequired'));
      return;
    }
    if (next === currentName) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onRename(cardId, next);
      haptic('success');
      setOpen(false);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('error.reason'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="press"
        onClick={() => { haptic('tap'); setValue(currentName); setError(''); setOpen(true); }}
        style={{ marginTop: 10, border: 'none', background: 'transparent', color: 'var(--link-accent)', fontFamily: "'Geist'", fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}
      >
        {t('card.renameCta')}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('card.name')}</label>
      <input
        value={value}
        autoComplete="name"
        onChange={(e) => setValue(e.target.value.slice(0, 200))}
        placeholder={t('login.namePlaceholder')}
        style={{ width: '100%', minWidth: 0, height: 46, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 15, padding: '0 13px', boxSizing: 'border-box' }}
      />
      {error && <div style={{ fontSize: 12.5, color: 'var(--destructive)', lineHeight: 1.45 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={() => void save()} disabled={busy} style={{ flex: 1, height: 44, border: 'none', borderRadius: 12, background: 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? <Spinner size={17} /> : t('card.renameSave')}
        </button>
        <button type="button" className="press" onClick={() => setOpen(false)} disabled={busy} style={{ flex: 'none', height: 44, padding: '0 16px', border: '1px solid var(--border)', borderRadius: 12, background: 'transparent', color: 'var(--muted-fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          {t('common.back')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Profile bottom sheet

function ProfileSheet({
  user,
  company,
  theme,
  onTheme,
  onClose,
}: {
  user: TelegramWebAppUser | undefined;
  company: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onClose: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Octane user';
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.42)', animation: 'octfade .2s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 41, background: 'var(--card)', borderRadius: '24px 24px 0 0', padding: '10px 20px calc(34px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 40px rgba(0,0,0,.28)', animation: 'octsheet .28s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 22 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', background: user?.photo_url ? undefined : 'var(--primary)', color: '#FFFFFF', fontWeight: 700, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(user)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('menu.theme')}</div>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 12, marginBottom: 20 }}>
          {(['light', 'dark'] as Theme[]).map((opt) => (
            <button key={opt} type="button" onClick={() => onTheme(opt)} style={{ flex: 1, height: 42, border: 'none', borderRadius: 9, fontFamily: "'Geist'", fontWeight: 700, fontSize: 14, cursor: 'pointer', background: theme === opt ? 'var(--primary)' : 'transparent', color: theme === opt ? '#FFFFFF' : 'var(--muted-fg)' }}>
              {t(opt === 'light' ? 'menu.light' : 'menu.dark')}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('menu.language')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {LANGUAGES.map((l) => {
            const active = lang === l.code;
            return (
              <button key={l.code} type="button" onClick={() => { haptic('tap'); setLang(l.code); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, height: 46, padding: '0 14px', borderRadius: 10, fontFamily: "'Geist'", fontSize: 14, color: 'var(--fg)', cursor: 'pointer', fontWeight: active ? 600 : 500, background: active ? 'var(--secondary)' : 'transparent', border: active ? '1px solid var(--primary)' : '1px solid var(--border)' }}>
                <span>{l.label}</span>
                <Check size={14} strokeWidth={2.6} color="var(--link-accent)" style={{ opacity: active ? 1 : 0, flex: 'none' }} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Service action sheet

// Driver row-scoping is the BACKEND's job — /carrier/mini-app/{transactions,last-used,status} filter
// to the driver's own card by full number before responding. Do not re-add a client-side filter: it
// can only hide rows the device already received, and matching on last-4 (what this used to do) is
// wrong anyway — last-4 is not unique within a carrier.

/** Transaction period vocabulary — mirrors servercrm's DWH range param + the zoho-octane
 * self-service transactions presets (Today / This Week / … / This Year), plus a custom from-to. */
type TxnRange = 'day' | 'week' | 'month' | 'quarter' | 'half_year' | 'year' | 'custom';
const TXN_RANGES: ReadonlyArray<{ value: TxnRange; key: string }> = [
  { value: 'day', key: 'txns.day' },
  { value: 'week', key: 'txns.week' },
  { value: 'month', key: 'txns.month' },
  { value: 'quarter', key: 'txns.quarter' },
  { value: 'half_year', key: 'txns.halfYear' },
  { value: 'year', key: 'txns.year' },
  { value: 'custom', key: 'txns.custom' },
];

/**
 * Invoice periods. NOT the transaction presets: invoices come from salesMytrion, whose vocabulary is
 * last_7 | last_30 | last_90 | last_365 | custom | all_time. servercrm falls back to last_30 on an
 * unknown preset *silently*, so feeding it 'month' would look wired and quietly do nothing.
 */
type InvoiceRange = 'last_7' | 'last_30' | 'last_90' | 'last_365' | 'all_time';
const INVOICE_RANGES: ReadonlyArray<{ value: InvoiceRange; key: string }> = [
  { value: 'last_7', key: 'inv.last7' },
  { value: 'last_30', key: 'inv.last30' },
  { value: 'last_90', key: 'inv.last90' },
  { value: 'last_365', key: 'inv.last365' },
  { value: 'all_time', key: 'inv.allTime' },
];

type SheetData =
  | { kind: 'balance'; v: CarrierBalance }
  | { kind: 'status'; v: StatusResult }
  | { kind: 'txns'; v: TransactionsResult }
  | { kind: 'lastused'; v: LastUsedResult }
  | { kind: 'payment'; v: PaymentInfoResult }
  | { kind: 'invoices'; v: SalesInvoicesResult }
  | { kind: 'tracking'; v: TrackingResult }
  | { kind: 'manualcode'; v: { cardNumber: string | null } };

function ActionSheet({
  target,
  session,
  initData,
  onClose,
  showToast,
  onSendGeneric,
}: {
  target: OpenAction;
  session: Session;
  initData: string;
  onClose: () => void;
  showToast: (msg: string, kind?: ToastKind) => void;
  onSendGeneric: (title: string) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<SheetData | null>(null);
  const [range, setRange] = useState<TxnRange>('month');
  const [invRange, setInvRange] = useState<InvoiceRange>('last_30');
  // Lazy init, and relative to TODAY: these were literal dates ('2026-06-01'/'2026-07-09'), so the
  // custom range opened on a window that had already gone stale — by this writing it ended 8 days
  // in the past. Last 30 days is the neutral default; the presets cover the calendar shapes.
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [genericSent, setGenericSent] = useState(false);
  const [genericBusy, setGenericBusy] = useState(false);
  const [genericError, setGenericError] = useState('');
  const [genericTicketId, setGenericTicketId] = useState('');
  const [genericComment, setGenericComment] = useState('');
  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);
  /** Phase 2 of the transactions read is in flight — rows are already shown, freshest are pending. */
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  /** Which export format is currently being built + sent to Telegram, if any. */
  const [exportBusy, setExportBusy] = useState<TxnExportFormat | null>(null);

  const service = target.kind === 'service' ? target.key : null;
  // A driver's status sheet is about their CARD, not the account — the generic svc.status title says
  // "Account status", which is the owner's framing.
  const sheetTitle =
    target.kind === 'generic'
      ? target.title
      : service === 'status' && session.isDriver
        ? t('svc.statusDriver')
        : t(`svc.${service}`);
  const dwhRange = range;

  useEffect(() => {
    if (!service) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setLiveRefreshing(false);
    async function load() {
      try {
        const txnOpts = dwhRange === 'custom' ? { range: 'custom', from, to } : { range: dwhRange };
        let next: SheetData;
        if (service === 'balance') next = { kind: 'balance', v: await fetchBalance(initData) };
        else if (service === 'status') next = { kind: 'status', v: await fetchAccountStatus(initData) };
        else if (service === 'txns') next = { kind: 'txns', v: await fetchTransactions(initData, txnOpts, false) };
        else if (service === 'lastused') next = { kind: 'lastused', v: await fetchLastUsed(initData) };
        else if (service === 'payment') next = { kind: 'payment', v: await fetchPaymentInfo(initData) };
        else if (service === 'invoices') next = { kind: 'invoices', v: await fetchInvoices(initData, { range: invRange }) };
        // No fetch: the manual entry code IS the card number the session already holds. Sending a
        // request would only ask the backend to hand back what it put in the session at sign-in.
        else if (service === 'manualcode') next = { kind: 'manualcode', v: { cardNumber: session.ownCardNumber } };
        else if (service === 'tracking') next = { kind: 'tracking', v: await fetchTracking(initData) };
        // Explicit, because this was a bare `else` that swallowed every unhandled key into a tracking
        // fetch — a new ServiceKey would silently open the wrong sheet instead of failing.
        else throw new Error(`Unhandled service: ${String(service)}`);
        if (cancelled) return;
        setData(next);
        setLoading(false);

        // Phase 2 — only transactions have a live tail worth waiting for. The list is already on
        // screen; this folds in anything the DWH mart hasn't picked up yet (its refresh lags ~3h)
        // by asking the backend for the EFS-merged truth. Seconds, so it must never block phase 1.
        if (next.kind === 'txns' && next.v.live?.pending) {
          setLiveRefreshing(true);
          try {
            const merged = await fetchTransactions(initData, txnOpts, true);
            if (!cancelled) setData({ kind: 'txns', v: merged });
          } catch (e) {
            // The fast rows are real and already rendered — a failed upgrade is not worth an error
            // screen. Drop the indicator and leave them be.
            console.warn('[ActionSheet] live refresh failed; keeping DWH rows', e);
          } finally {
            if (!cancelled) setLiveRefreshing(false);
          }
        }
      } catch (e) {
        // Backend errors here (crmGet's upstream passthrough, DB failures) are DTO/validation
        // text meant for API integrators, not the end user — never surface e.message directly.
        //
        // But the STATUS is reliable, and it decides the only thing the user cares about: will
        // pulling down help? Every failure used to say "Pull down to try again", including 4xx —
        // which fail identically forever. A driver whose account data the upstream rejects (seen
        // live: HTTP 400 "carrierId must be a positive integer") was told to retry a call that
        // could never succeed, and would pull until they gave up.
        if (!cancelled) {
          console.error('[ActionSheet] load failed', e);
          const status = e instanceof ApiError ? e.status : -1;
          setLoadError(
            status === 0
              ? t('sheet.loadErrorOffline')
              : status >= 400 && status < 500
                ? t('sheet.loadErrorAccount')
                : t('sheet.loadError'),
          );
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, dwhRange, invRange, from, to]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /**
   * The report is built server-side and delivered by the bot as a Telegram document — a WebView
   * can't reliably save a file, and the rows are re-queried on the backend anyway, so nothing from
   * this screen is uploaded. `rows` is only consulted to keep the empty case instant.
   */
  async function doExport(rows: Array<Record<string, unknown>>, format: TxnExportFormat) {
    haptic('tap');
    if (!rows.length) {
      showToast(t('txns.empty'), 'error');
      return;
    }
    if (exportBusy) return;
    setExportBusy(format);
    try {
      const opts = range === 'custom' ? { range: 'custom', from, to } : { range };
      await sendTransactionsReport(initData, opts, format);
      haptic('success');
      showToast(t('toast.reportSentToTelegram'));
    } catch (e) {
      // The backend distinguishes "you never opened the bot chat" from a genuine failure — that one
      // is actionable by the user, so it's worth its own message rather than a generic error.
      const code = e instanceof ApiError ? e.code : '';
      haptic('error');
      showToast(code === 'TELEGRAM_CHAT_UNREACHABLE' ? t('toast.openBotFirst') : t('sheet.loadError'), 'error');
    } finally {
      setExportBusy(null);
    }
  }

  /**
   * Files a real Desk ticket when the catalog item carries a `request` key; otherwise falls back to
   * the placeholder that only ever wrote a local inbox row.
   *
   * The success state is set from the RESPONSE, never optimistically — showing "Request sent" for a
   * ticket that failed to create is the exact fake this replaces.
   */
  async function sendGeneric() {
    const requestKey = target.kind === 'generic' ? target.request : undefined;
    if (!requestKey) {
      haptic('success');
      setGenericSent(true);
      onSendGeneric(sheetTitle);
      return;
    }
    if (genericBusy) return;
    setGenericBusy(true);
    setGenericError('');
    try {
      const res = await sendServiceRequest(initData, requestKey, genericComment.trim() || undefined);
      haptic('success');
      setGenericTicketId(res.ticketId);
      setGenericSent(true);
      onSendGeneric(sheetTitle);
    } catch (e) {
      haptic('error');
      setGenericError(e instanceof Error ? e.message : t('generic.sendFailed'));
    } finally {
      setGenericBusy(false);
    }
  }

  async function openInvoice(id: string) {
    haptic('tap');
    if (invoiceBusyId) return;
    setInvoiceBusyId(id);
    try {
      await sendInvoice(initData, id);
      haptic('success');
      showToast(t('toast.invoiceSentToTelegram'));
    } catch (e) {
      // "You never opened the bot chat" is the one failure the user can act on, so it keeps its own
      // message rather than being flattened into a generic error.
      const code = e instanceof ApiError ? e.code : '';
      haptic('error');
      showToast(code === 'TELEGRAM_CHAT_UNREACHABLE' ? t('toast.openBotFirst') : t('toast.invoiceDownloadFailed'), 'error');
    } finally {
      setInvoiceBusyId(null);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 42, background: 'rgba(0,0,0,.42)', animation: 'octfade .2s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 43, maxHeight: '84%', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: '24px 24px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,.28)', animation: 'octsheet .28s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ flex: 'none', padding: '10px 20px 6px' }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>{sheetTitle}</span>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--secondary)', color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
              <Icon name="x" size={14} strokeWidth={1.8} className="" />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px 30px', minHeight: 150 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '44px 0' }}>
              <Spinner size={30} />
              <div style={{ fontSize: 13, color: 'var(--muted-fg)' }}>{t('sheet.fetching', { what: sheetTitle.toLowerCase() })}</div>
            </div>
          ) : loadError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '34px 10px', textAlign: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: 13, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--destructive) 14%, transparent)', color: 'var(--destructive)' }}>
                <CircleAlert size={22} strokeWidth={2} aria-hidden />
              </span>
              <div style={{ fontSize: 14, color: 'var(--muted-fg)', lineHeight: 1.5 }}>{loadError}</div>
            </div>
          ) : data?.kind === 'balance' ? (
            (() => {
              const b = data.v;
              const tiles: Array<{ label: string; value: string; accent?: boolean }> = [
                { label: t('svc.balance'), value: money(b.efs_balance ?? b.balance) },
              ];
              if (b.credit_limit != null) tiles.push({ label: t('balance.creditLimit'), value: money(b.credit_limit) });
              if (b.credit_used != null) tiles.push({ label: t('balance.creditUsed'), value: money(b.credit_used) });
              if (b.credit_remaining != null) tiles.push({ label: t('balance.available'), value: money(b.credit_remaining), accent: true });
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {tiles.map((tile) => (
                      <div key={tile.label} style={{ background: tile.accent ? 'var(--primary)' : 'var(--secondary)', borderRadius: 14, padding: '13px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: tile.accent ? 'rgba(255,255,255,.75)' : 'var(--muted-fg)' }}>{tile.label}</div>
                        <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: tile.accent ? '#FFFFFF' : 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: b.efs_error ? 'var(--destructive)' : 'var(--muted-fg)', marginTop: 14, lineHeight: 1.5 }}>
                    {b.efs_error ? `⚠ ${b.efs_error}` : [b.account_type ?? b.payment_terms, b.billing_cycle].filter(Boolean).join(' · ') || t('balance.locNote')}
                  </div>
                </>
              );
            })()
          ) : data?.kind === 'status' ? (
            (() => {
              const { overview, cards } = data.v;
              const rows = cards.data ?? [];
              const shown = rows.slice(0, 20);
              const extra = (cards.count ?? rows.length) - shown.length;
              /**
               * The banner answers "is this active?" — and for a DRIVER that must be their own CARD,
               * not the carrier account. `overview.is_active` is the company's status; a driver's card
               * can be Inactive while the company is fine, and the reverse. It also read as a false
               * green "Active" whenever the card list came back empty, because `undefined !== false`
               * fell through to the success branch — the exact "status not right" being reported.
               *
               * For a driver: derive from their own card's status, and show a neutral "unknown" when no
               * card resolved rather than claiming Active. For an owner: keep the account-level flag.
               */
              const state: 'active' | 'inactive' | 'unknown' = session.isDriver
                ? rows.length === 0
                  ? 'unknown'
                  : fmt(rows[0]?.['status']).toLowerCase() === 'active'
                    ? 'active'
                    : 'inactive'
                : overview.is_active === false
                  ? 'inactive'
                  : 'active';
              const tone = state === 'inactive' ? 'destructive' : state === 'unknown' ? 'muted-fg' : 'success';
              // Card-specific wording for a driver — the account labels say "Account active", which is
              // not what a driver is asking about.
              const bannerLabel =
                state === 'unknown'
                  ? t('status.unknown')
                  : session.isDriver
                    ? t(state === 'inactive' ? 'status.cardInactive' : 'status.cardActive')
                    : t(state === 'inactive' ? 'status.inactive' : 'status.active');
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: `color-mix(in srgb, var(--${tone}) 13%, transparent)`, borderRadius: 14, marginBottom: 14 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 10, background: `color-mix(in srgb, var(--${tone}) 20%, transparent)`, color: `var(--${tone})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      <Icon name={state === 'inactive' ? 'x' : state === 'unknown' ? 'alert' : 'check'} size={17} strokeWidth={2.4} className="" />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{bannerLabel}</span>
                  </div>
                  {/* Carrier debt is the COMPANY's financial standing — an owner's view, never a driver's.
                      A driver asking "is my card active" must not be shown the fleet's total debt or
                      hard-debtor flag. */}
                  {!session.isDriver && (
                    <>
                      <SectionLabel>{t('status.debt')}</SectionLabel>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                        {[
                          { label: t('status.totalDebt'), value: money(overview.cmp_debt?.total_debt ?? 0) },
                          { label: t('status.openInvoices'), value: fmt(overview.cmp_debt?.invoice_count ?? 0) },
                          { label: t('status.maxDays'), value: fmt(overview.cmp_debt?.max_debt_days ?? 0) },
                          { label: t('status.hardDebtor'), value: overview.cmp_debt?.is_hard_debtor ? t('status.yes') : t('status.no') },
                        ].map((tile) => (
                          <div key={tile.label} style={{ background: 'var(--secondary)', borderRadius: 14, padding: '12px 14px' }}>
                            <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted-fg)' }}>{tile.label}</div>
                            <div className="selectable" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <SectionLabel>{session.isDriver ? t('status.yourCard') : t('status.cards')}</SectionLabel>
                  {shown.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 4px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('status.noCards')}</div>
                  ) : (
                    <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                      {shown.map((c, i) => {
                        const status = fmt(c['status']);
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                            <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {last4(fmt(c['card_number']), null)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: status.toLowerCase() === 'active' ? 'var(--success)' : 'var(--destructive)' }}>{status}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Driver-scoped views only ever show the driver's own card — a leftover count here would
                      just be the rest of the fleet's cards, which isn't this driver's to see. */}
                  {!session.isDriver && extra > 0 && <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 9, textAlign: 'center' }}>{t('status.moreCards', { n: extra })}</div>}
                </>
              );
            })()
          ) : data?.kind === 'txns' ? (
            (() => {
              const rows = data.v.data ?? [];
              return (
                <>
                  {/* Horizontal-scroll period chips — too many presets to fit a fixed row on mobile. */}
                  <div className="hscroll" style={{ display: 'flex', gap: 7, marginBottom: 12, paddingBottom: 2 }}>
                    {TXN_RANGES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setRange(r.value)}
                        style={{
                          flex: 'none',
                          height: 36,
                          padding: '0 14px',
                          border: 'none',
                          borderRadius: 10,
                          fontFamily: "'Geist'",
                          fontWeight: 700,
                          fontSize: 13,
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          background: range === r.value ? 'var(--primary)' : 'var(--secondary)',
                          color: range === r.value ? '#FFFFFF' : 'var(--muted-fg)',
                        }}
                      >
                        {t(r.key)}
                      </button>
                    ))}
                  </div>
                  {range === 'custom' && (
                    /* Stack From/To vertically — side-by-side native date inputs overflow/merge on narrow mobile. */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                      <label>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>{t('txns.from')}</span>
                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%', minWidth: 0, height: 44, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 14, padding: '0 12px', boxSizing: 'border-box' }} />
                      </label>
                      <label>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>{t('txns.to')}</span>
                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', minWidth: 0, height: 44, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 14, padding: '0 12px', boxSizing: 'border-box' }} />
                      </label>
                    </div>
                  )}
                  {/* Period summary — a payment app always answers "what did this period cost?" before
                      the line items. The backend has sent these totals all along (they are computed
                      over the WHOLE window, not just the rendered page); nothing rendered them. */}
                  {rows.length > 0 && (() => {
                    const tot = data.v.totals ?? {};
                    const spend = tot['funded_total'];
                    const gal = tot['total_fuel_quantity'] ?? tot['fuel_quantity'];
                    const saved = tot['discount_amount'];
                    if (spend == null) return null;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div style={{ background: 'var(--primary)', borderRadius: 14, padding: '13px 14px' }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.75)' }}>{t('txns.totalSpent')}</div>
                          <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{money(spend)}</div>
                        </div>
                        <div style={{ background: 'var(--secondary)', borderRadius: 14, padding: '13px 14px' }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('txns.saved')}</div>
                          <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{money(saved ?? 0)}</div>
                        </div>
                        {gal != null && (
                          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted-fg)', textAlign: 'center', marginTop: -2 }}>
                            {t('txns.gallons', { n: fmt(gal) })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {liveRefreshing && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 10, fontSize: 12, color: 'var(--muted-fg)' }}>
                      <Spinner size={12} />
                      {t('txns.checkingLive')}
                    </div>
                  )}
                  {rows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('txns.empty')}</div>
                  ) : (
                    <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                      {rows.map((tx, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, color: 'var(--fg)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{fmt(tx['location_name'])}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{txnDateTime(tx['transaction_date'])} · •••• {last4(fmt(tx['card_number']), null)}</div>
                          </div>
                          <span className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', flex: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(tx['line_item_amount'] ?? tx['funded_total'] ?? tx['net_total'])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          ) : data?.kind === 'invoices' ? (
            (() => {
              const rows = data.v.data ?? [];
              const sum = data.v.summary ?? {};
              // Use the backend's sum_open_balance, never billed-minus-paid. servercrm computes it as
              // SUM(GREATEST(total_amount - total_paid, 0)) FILTER (status IN PENDING, PARTIALLY_PAID)
              // — so it counts only what is actually owed, and clamps at zero. Subtracting here got
              // both wrong: it showed -$16.60 for a carrier that had OVERPAID, and it counted PAID and
              // CANCELLED invoices as if they were open.
              const openBalance = Number(sum['sum_open_balance'] ?? 0);
              return (
                <>
                  <div className="hscroll" style={{ display: 'flex', gap: 7, marginBottom: 12, paddingBottom: 2 }}>
                    {INVOICE_RANGES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setInvRange(r.value)}
                        style={{ flex: 'none', height: 36, padding: '0 14px', border: 'none', borderRadius: 10, fontFamily: "'Geist'", fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer', background: invRange === r.value ? 'var(--primary)' : 'var(--secondary)', color: invRange === r.value ? '#FFFFFF' : 'var(--muted-fg)' }}
                      >
                        {t(r.key)}
                      </button>
                    ))}
                  </div>
                  {/* The backend has sent this summary all along; nothing read it. Billed vs still
                      open is the pair an owner opens invoices for — the list answers "which" after. */}
                  {sum['sum_total_amount'] != null && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                      <div style={{ background: 'var(--primary)', borderRadius: 14, padding: '13px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.75)' }}>{t('inv.billed')}</div>
                        <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{money(sum['sum_total_amount'])}</div>
                      </div>
                      <div style={{ background: 'var(--secondary)', borderRadius: 14, padding: '13px 14px' }}>
                        {/* "2 open / $0.26" read as a bug next to "Billed $18,051.53" — but it is
                            true: two invoices were short by 19c and 7c. The tile names the money and
                            the line below carries the counts, so neither has to explain the other. */}
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('inv.outstanding')}</div>
                        <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{money(openBalance)}</div>
                      </div>
                      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted-fg)', textAlign: 'center', marginTop: -2 }}>
                        {t('inv.summaryLine', { total: fmt(sum['total_invoices'] ?? rows.length), paid: fmt(sum['paid_count'] ?? 0) })}
                        {Number(sum['open_count'] ?? 0) > 0 && ` · ${t('inv.openCount', { n: fmt(sum['open_count']) })}`}
                        {Number(sum['cancelled_count'] ?? 0) > 0 && ` · ${t('inv.cancelledCount', { n: fmt(sum['cancelled_count']) })}`}
                      </div>
                    </div>
                  )}
                  {rows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('invoice.empty')}</div>
                  ) : (
                    <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                {rows.map((inv, i) => {
                  const id = String(inv['invoice_id'] ?? inv['id'] ?? '');
                  const label = String(inv['invoice_ref'] ?? inv['invoice_number'] ?? id);
                  const busy = invoiceBusyId === id;
                  const st = invoiceStatus(inv['status'], t);
                  return (
                    <div key={id || i} onClick={() => !busy && void openInvoice(id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: busy ? 'default' : 'pointer' }}>
                      <span style={{ width: 34, height: 34, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', color: 'var(--muted-fg)' }}><Icon name="doc" size={17} strokeWidth={2} className="" /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('invoice.num', { n: label })}</div>
                        {/* The status used to render raw — PAID / PENDING / PARTIALLY_PAID / CANCELLED, in
                            English uppercase, in every locale. invoiceStatus() maps it to a translated
                            label and a tone. */}
                        <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{money(inv['total_amount'] ?? inv['amount'])}</span>
                          <span style={{ color: `var(--${st.tone})`, fontWeight: 600 }}>· {st.label}</span>
                        </div>
                      </div>
                      {busy ? <Spinner size={16} /> : (
                        <span style={{ borderRadius: 9, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 12.5, padding: '7px 12px', flex: 'none' }}>{t('invoice.download')}</span>
                      )}
                    </div>
                  );
                })}
                    </div>
                  )}
                </>
              );
            })()
          ) : data?.kind === 'payment' ? (
            (() => {
              const p = data.v;
              const totals = p.invoices?.totals ?? {};
              const rows = [
                { label: t('payment.invoiceCount'), value: fmt(p.invoices?.count ?? 0) },
                { label: t('payment.totalBilled'), value: money(totals['total_billed']) },
                { label: t('payment.totalPaid'), value: money(totals['total_paid']) },
                { label: t('payment.openBalance'), value: money(totals['open_balance']) },
                { label: t('payment.paymentCount'), value: fmt(p.payments?.count ?? 0) },
                { label: t('payment.paymentTotal'), value: money(p.payments?.total_amount) },
              ];
              return (
                <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                  {rows.map((r) => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted-fg)' }}>{r.label}</span>
                      <span className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : data?.kind === 'lastused' ? (
            (() => {
              const rows = data.v.data ?? [];
              return rows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('status.noCards')}</div>
              ) : (
                <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                  {rows.map((c, i) => {
                    const lastUsed = c['last_used_date'] ?? c['last_transaction_date'] ?? c['lastUsedDate'] ?? c['last_used'];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                        <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {last4(fmt(c['card_number']), null)}</span>
                        <span style={{ fontSize: 13, color: 'var(--fg)' }}>{fmt(lastUsed).slice(0, 10)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : data?.kind === 'manualcode' ? (
            (() => {
              const pan = data.v.cardNumber;
              if (!pan) {
                return <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('manualcode.unavailable')}</div>;
              }
              // Shown revealed, unlike the home hero. The hero sits on screen unprompted, so it masks
              // by default; getting here took a deliberate tap on an item that says "Reveal", and the
              // driver is reading it to type into a pump keypad. Masking it behind a second tap would
              // add friction to the one job this item exists for.
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6px 0 4px' }}>
                  <span style={{ width: 54, height: 54, borderRadius: 16, background: 'var(--secondary)', color: 'var(--link-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                    <Icon name="key" size={26} strokeWidth={2} className="" />
                  </span>
                  <span
                    className="selectable"
                    style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.04em', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.35, wordBreak: 'break-all' }}
                  >
                    {groupCardNumber(pan)}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 12, maxWidth: 280, lineHeight: 1.5 }}>{t('manualcode.hint')}</span>
                </div>
              );
            })()
          ) : data?.kind === 'tracking' ? (
            (() => {
              const tr = data.v;
              const info = tr.trackingInfo ?? [];
              if (info.length === 0 && !tr.fedexTracking) {
                return <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('track.empty')}</div>;
              }
              return (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6px 0 4px' }}>
                    <span style={{ width: 54, height: 54, borderRadius: 16, background: 'var(--secondary)', color: 'var(--link-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="pin" size={26} strokeWidth={2} className="" /></span>
                    {tr.fedexTracking && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('track.number')}</div>
                        <div className="selectable" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tr.fedexTracking}</div>
                      </>
                    )}
                  </div>
                  {info.length > 0 && (
                    <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden', marginTop: 14 }}>
                      {info.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="selectable" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{fmt(r.trackingNumber)}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2 }}>{fmt(r.startDate)}</div>
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--muted-fg)', flex: 'none' }}>{t('track.cardsOrdered', { n: fmt(r.cardsOrdered) })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          ) : genericSent ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '14px 0 8px', animation: 'octpop .3s ease' }}>
              <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'color-mix(in srgb, var(--success) 15%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--success)', display: 'flex' }}>
                  <Icon name="check" size={28} strokeWidth={2.6} className="" />
                </span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg)' }}>{t('generic.sentTitle')}</div>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)', lineHeight: 1.5, maxWidth: 260 }}>{t('generic.sentBody')}</div>
              {/* A real ticket id, so the driver can quote it to support — and so "sent" is checkable
                  rather than something the screen merely claims. */}
              {genericTicketId && (
                <div className="selectable" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', background: 'var(--secondary)', borderRadius: 10, padding: '8px 14px', fontVariantNumeric: 'tabular-nums' }}>
                  {t('generic.ticketNo', { id: genericTicketId })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.5, marginBottom: 6 }}>{t('generic.notSentBody1')}</div>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)', lineHeight: 1.5, marginBottom: 16 }}>{t('generic.notSentBody2')}</div>
              {/* Only for requests that actually reach a human. A driver's card is resolved
                  server-side, but an owner has a fleet — the ticket would otherwise say "replace a
                  lost card" and name no card, leaving support to ask before they can start. */}
              {target.kind === 'generic' && target.request && (
                <textarea
                  value={genericComment}
                  onChange={(e) => setGenericComment(e.target.value.slice(0, 2000))}
                  placeholder={t('generic.commentPlaceholder')}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 15, lineHeight: 1.5, padding: '12px 14px', marginBottom: 12 }}
                />
              )}
              {genericError && (
                <div style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.5, marginBottom: 12 }}>{genericError}</div>
              )}
              <button type="button" className="press" onClick={sendGeneric} disabled={genericBusy} style={{ width: '100%', height: 50, border: 'none', borderRadius: 14, background: 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 15, cursor: genericBusy ? 'default' : 'pointer', opacity: genericBusy ? 0.6 : 1 }}>
                {genericBusy ? t('generic.sending') : t('generic.sendButton')}
              </button>
            </>
          )}
        </div>
        {/* Export bar — pinned, not the tail of the list. It used to live at the bottom of the
            scroll area, so reaching it meant scrolling past every transaction; a client pulling a
            year would never find it. As a sibling of the scroll container it stays put. */}
        {data?.kind === 'txns' && (data.v.data ?? []).length > 0 && (
          <div style={{ flex: 'none', borderTop: '1px solid var(--border)', background: 'var(--card)', padding: '12px 20px calc(14px + env(safe-area-inset-bottom))' }}>
            {/* Indeterminate by necessity: the work is a server-side build plus a Telegram upload
                behind our own API, so there are no progress events to report. The bar says
                "working"; it does not claim a percentage it cannot know. */}
            <div style={{ height: 2, borderRadius: 2, overflow: 'hidden', background: exportBusy ? 'var(--secondary)' : 'transparent', marginBottom: 9 }}>
              {exportBusy && <div style={{ width: '40%', height: '100%', borderRadius: 2, background: 'var(--primary)', animation: 'octbar 1.1s ease-in-out infinite' }} />}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-fg)', marginBottom: 7 }}>
              {exportBusy ? t('txns.sendingReport') : t('txns.exportToTelegram')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['xlsx', 'pdf', 'csv'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="press"
                  disabled={exportBusy !== null}
                  onClick={() => void doExport(data.v.data ?? [], f)}
                  style={{ flex: 1, height: 42, border: 'none', borderRadius: 11, background: 'var(--secondary)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 700, fontSize: 13, cursor: exportBusy ? 'default' : 'pointer', opacity: exportBusy && exportBusy !== f ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {exportBusy === f ? <Spinner size={16} /> : f === 'xlsx' ? 'Excel' : f === 'pdf' ? 'PDF' : 'CSV'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

export function App() {
  const wa = getTelegramWebApp();
  const user = wa?.initDataUnsafe.user;
  const firstName = user?.first_name || 'there';
  /** Prefill only — the sign-in screen lets the driver correct it before it reaches their owner's
   *  roster. Mirrors the backend's fallback order so the prefill matches what it would have used. */
  const telegramName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username || '';
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  const { t } = useI18n();

  const [screen, setScreen] = useState<Screen>('loading');
  const [errorTitle, setErrorTitle] = useState('');
  const [errorReason, setErrorReason] = useState('');
  const [preview, setPreview] = useState<RegistrationPreview | null>(null);
  const [registration, setRegistration] = useState<RegistrationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const [tab, setTab] = useState<HomeTab>('home');
  const [pinned, setPinned] = useState<string[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null);
  const pinnedInit = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // fleet
  const [fleetCards, setFleetCards] = useState<FleetCard[]>([]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetLoadError, setFleetLoadError] = useState('');
  const [fleetActionError, setFleetActionError] = useState('');
  const fleetLoaded = useRef(false);

  const session = sessionFrom(registration);
  const company = registration?.companyName ?? preview?.companyName ?? '';
  const supportAgentName = registration?.agentName ?? preview?.agentName ?? null;

  function showError(reason: string, title = t('error.title')) {
    setErrorTitle(title);
    setErrorReason(reason);
    setScreen('error');
  }

  function showToast(msg: string, kind: ToastKind = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ msg, kind, id });
    toastTimer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 2300);
  }

  function askConfirm(cfg: ConfirmConfig) {
    haptic('tap');
    setConfirmCfg({ ...cfg, onConfirm: () => { setConfirmCfg(null); cfg.onConfirm(); } });
  }

  // Home/Services/Inbox all need the role to be known before they can seed anything, so this runs
  // once whenever `home` first becomes reachable — covers both the "confirm → success → home" path
  // and the "returning user, session restored straight to home" path.
  useEffect(() => {
    if (screen !== 'home') return;
    setInbox((i) => (i.length ? i : seedInbox(session.isDriver, session.ownCard, company)));
    if (!pinnedInit.current) {
      pinnedInit.current = true;
      setPinned(loadStoredPinned() ?? defaultPinned(session.isDriver));
    }
    // only the arrival at `home` (and the role, if it wasn't known yet) should re-run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, session.isDriver]);

  useEffect(() => {
    wa?.ready();
    wa?.expand();
    initTheme();

    async function restoreSession(initData: string) {
      try {
        const res = await fetchMiniAppSession(initData);
        setRegistration(res.registration);
        setScreen('home');
      } catch (e) {
        // Not-registered isn't an error — it's the onboarding entry point (choose Driver / Company).
        if (e instanceof ApiError && e.code === 'MINI_APP_NOT_REGISTERED') {
          setScreen('login');
          return;
        }
        if (e instanceof ApiError) {
          showError(e.message);
          return;
        }
        showError(t('error.reason'));
      }
    }

    const id = getRegistrationId();
    if (!id && wa?.initData) {
      void restoreSession(wa.initData);
      return;
    }
    if (!id) {
      // Outside Telegram (no initData) or no link — still offer the login/role choice.
      setScreen('login');
      return;
    }
    fetchRegistrationPreview(id)
      .then(async (res) => {
        if (res.status !== 'redeemed') {
          setPreview(res.invite);
          setScreen('confirm');
          return;
        }
        // A redeemed link is still the returning user's entry point inside Telegram. Try the
        // idempotent redeem path: the same Telegram user gets their registration back, while a
        // different user still receives the proper conflict from the backend.
        const redeemedPreview = {
          id,
          profile: 'owner' as const,
          companyName: res.companyName,
          companyType: null,
          cardCount: null,
          agentName: res.agentName,
        };
        setPreview(redeemedPreview);
        if (wa?.initData) {
          try {
            const redeemed = await redeemRegistration(id, wa.initData);
            setRegistration(redeemed.registration);
            setScreen('home');
            return;
          } catch (e) {
            showError(e instanceof ApiError ? e.message : t('error.reason'));
            return;
          }
        }
        setScreen('already');
      })
      .catch((e) => {
        showError(e instanceof ApiError ? e.message : t('error.reason'));
      });
    // registration id read once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseTheme(next: Theme) {
    if (next === theme) return;
    haptic('tap');
    setTheme(next);
    setThemeState(next);
    showToast(t(next === 'dark' ? 'toast.themeDark' : 'toast.themeLight'));
  }

  function confirm() {
    if (!preview) return;
    if (!wa?.initData) {
      showError(t('auth.openInTelegram'), t('auth.title'));
      return;
    }
    setBusy(true);
    haptic('tap');
    redeemRegistration(preview.id, wa.initData)
      .then((res) => {
        haptic('success');
        if ('alreadyRegistered' in res) {
          setRegistration(res.registration);
          setScreen('already');
        } else {
          setRegistration(res.registration);
          setScreen('success');
        }
      })
      .catch((e) => {
        haptic('error');
        showError(e instanceof ApiError ? e.message : t('error.reason'));
      })
      .finally(() => setBusy(false));
  }

  async function submitDriverCard(cardNumber: string, driverName: string): Promise<void> {
    if (!wa?.initData) throw new ApiError(t('auth.openInTelegram'), 'NO_INITDATA', 0);
    const res = await driverSelfRegister(wa.initData, cardNumber, driverName);
    setRegistration(res.registration);
    haptic('success');
    setScreen('home');
  }

  function goHome() {
    setOpenAction(null);
    setProfileOpen(false);
    setTab('home');
    setScreen('home');
  }

  function handleOpenAction(target: OpenAction) {
    haptic('tap');
    setOpenAction(target);
  }

  function togglePin(key: string) {
    haptic('tap');
    setPinned((cur) => {
      const isPinned = cur.includes(key);
      const next = isPinned ? cur.filter((k) => k !== key) : [...cur, key];
      persistPinned(next);
      showToast(t(isPinned ? 'toast.unpinned' : 'toast.pinned'));
      return next;
    });
  }

  function toggleCardReveal() {
    haptic('tap');
    setCardRevealed((v) => !v);
  }


  function markAllRead() {
    haptic('tap');
    setInbox((cur) => cur.map((n) => ({ ...n, unread: false })));
    showToast(t('toast.allRead'));
  }

  function readNotif(id: string) {
    setInbox((cur) => cur.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }

  function sendGenericRequest(title: string) {
    setInbox((cur) => [
      { id: 'gen-' + Date.now(), category: 'notifications', icon: 'plane', color: null, titleKey: '', titleText: t('inbox.genericReceived.title', { title }), bodyKey: '', bodyText: t('inbox.genericReceived.body'), atKey: 'time.justNow', minutesAgo: 0, unread: true },
      ...cur,
    ]);
  }

  function loadFleet(force = false) {
    if (!wa?.initData || fleetLoading || (fleetLoaded.current && !force)) return;
    setFleetLoadError('');
    setFleetActionError('');
    setFleetLoading(true);
    fetchFleet(wa.initData)
      .then((res) => {
        setFleetCards(res.fleet);
        fleetLoaded.current = true;
      })
      .catch((e) => {
        fleetLoaded.current = false;
        console.error('[FleetView] load failed', e);
        setFleetLoadError(t('fleet.error'));
      })
      .finally(() => setFleetLoading(false));
  }

  function viewFleet() {
    setScreen('fleet');
    loadFleet();
  }

  async function submitDriverLink(cardId: string, name: string, successKey: string) {
    if (!name || !wa?.initData) {
      haptic('error');
      showToast(t('toast.nameRequired'), 'error');
      return;
    }
    try {
      setFleetActionError('');
      const res = await createDriverInvite(wa.initData, cardId, name);
      haptic('success');
      setFleetCards((cs) => cs.map((c) => (c.cardId === cardId ? { ...c, status: 'pending', driverName: name, link: res.inviteUrl, expiresAt: res.expiresAt } : c)));
      showToast(t(successKey));
    } catch (e) {
      haptic('error');
      console.error('[FleetView] action failed', e);
      setFleetActionError(t('fleet.error'));
    }
  }
  const createLink = (cardId: string, name: string) => submitDriverLink(cardId, name, 'toast.driverLinkCreated');
  const regenerateLink = (cardId: string, name: string) => submitDriverLink(cardId, name, 'toast.newLinkGenerated');

  async function renameDriverName(cardId: string, driverName: string): Promise<void> {
    if (!wa?.initData) throw new ApiError(t('auth.openInTelegram'), 'NO_INITDATA', 0);
    // Patch the row from the response, not from the input: the backend trims, and the roster should
    // show exactly what was stored. Throws on failure so the inline form keeps the error and the
    // name on screen stays the one that is really saved.
    const res = await renameDriver(wa.initData, cardId, driverName);
    setFleetCards((cs) => cs.map((c) => (c.cardId === cardId ? { ...c, driverName: res.driverName } : c)));
    showToast(t('toast.driverRenamed'), 'success');
  }

  const signedIn = screen === 'home' || screen === 'fleet';

  return (
    <div className="app-root" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--background)', overflow: 'hidden' }}>
      {signedIn && <AppHeader user={user} onOpenProfile={() => { haptic('tap'); setProfileOpen(true); }} />}

      {/* x-axis clipped so the tab slide-in offset (SlideIn/octslide) never spawns a horizontal scrollbar. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowX: 'hidden', overflowY: 'auto' }}>
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'error' && <ErrorScreen title={errorTitle} reason={errorReason} agentName={supportAgentName} />}
        {screen === 'login' && <LoginScreen firstName={firstName} defaultName={telegramName} onDriverRegister={submitDriverCard} />}
        {screen === 'confirm' && preview && <ConfirmScreen preview={preview} firstName={firstName} busy={busy} onConfirm={confirm} />}
        {screen === 'success' && <SuccessScreen session={session} company={company} onContinue={goHome} />}
        {screen === 'already' && <AlreadyScreen company={company} agentName={supportAgentName} onContinue={goHome} />}
        {screen === 'home' && (
          <Home
            session={session}
            tab={tab}
            company={company}
            fullName={fullName}
            initData={wa?.initData ?? ''}
            pinned={pinned}
            inbox={inbox}
            cardRevealed={cardRevealed}
            onToggleCardReveal={toggleCardReveal}
            onTogglePin={togglePin}
            onOpenAction={handleOpenAction}
            onGoToServices={() => setTab('services')}
            onViewFleet={viewFleet}
            onMarkAllRead={markAllRead}
            onReadNotif={readNotif}
          />
        )}
        {screen === 'fleet' && (
          <FleetView
            cards={fleetCards}
            loading={fleetLoading}
            loadError={fleetLoadError}
            actionError={fleetActionError}
            onBack={goHome}
            onRetry={() => loadFleet(true)}
            onCreate={createLink}
            onRegenerate={regenerateLink}
            onRename={renameDriverName}
            showToast={showToast}
            askConfirm={askConfirm}
          />
        )}
      </div>

      {screen === 'home' && <TabBar active={tab} unreadCount={inbox.filter((n) => n.unread).length} onSelect={(next) => { if (next !== tab) haptic('tap'); setTab(next); }} />}

      {profileOpen && (
        <ProfileSheet
          user={user}
          company={company}
          theme={theme}
          onTheme={chooseTheme}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {openAction && (
        <ActionSheet
          target={openAction}
          session={session}
          initData={wa?.initData ?? ''}
          onClose={() => setOpenAction(null)}
          showToast={showToast}
          onSendGeneric={sendGenericRequest}
        />
      )}
      <Toast toast={toast} />
      <ConfirmDialog config={confirmCfg} onCancel={() => setConfirmCfg(null)} />
    </div>
  );
}
