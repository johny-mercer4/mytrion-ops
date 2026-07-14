import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ApiError,
  createDriverInvite,
  fetchFleet,
  fetchMiniAppSession,
  fetchRegistrationPreview,
  redeemRegistration,
  type FleetCard,
  type RegistrationPreview,
  type RegistrationView,
} from './lib/api';
import { getRegistrationId, getTelegramWebApp, haptic, type TelegramWebAppUser } from './lib/telegram';
import { getStoredTheme, initTheme, setTheme, type Theme } from './lib/theme';
import { LANGUAGES, useI18n } from './lib/i18n';
import { LogoLockup } from './components/logo';
import { BackChevron, Chevron, EyeToggle, Icon, SearchGlyph, type IconName } from './components/icons';
import {
  BALANCE_TILES,
  HERO,
  INVOICE_DOCS,
  PAYMENT_ROWS,
  STATUS_TILES,
  TRACKING,
  TXN_ALL,
  seedInbox,
  statusCards,
  type InboxItem,
} from './lib/demo';
import { downloadInvoicePdf } from './lib/pdf';
import type { OpenAction } from './lib/actionTarget';
import { defaultPinned, findCatalogItem } from './lib/serviceCatalog';
import { ConfirmDialog, type ConfirmConfig } from './components/ConfirmDialog';
import { Toast, type ToastKind, type ToastState } from './components/Toast';
import { TabBar, type HomeTab } from './screens/TabBar';
import { ServicesTab } from './screens/ServicesTab';
import { InboxTab } from './screens/InboxTab';

const CTA_SHADOW = '0 4px 14px color-mix(in srgb, var(--primary) 34%, transparent)';

type Screen = 'loading' | 'error' | 'confirm' | 'success' | 'already' | 'home' | 'fleet';

interface Session {
  isDriver: boolean;
  isOwner: boolean;
  isOwnerOp: boolean;
  isFleetManager: boolean;
  ownCard: string;
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
  const ownCard = (reg?.cardId ?? '7549').slice(-4);
  return {
    isDriver,
    isOwner,
    isOwnerOp,
    isFleetManager,
    ownCard,
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
        border: '3px solid var(--secondary)',
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
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M12 7.5v6" stroke="var(--destructive)" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="12" cy="17" r="1.5" fill="var(--destructive)" />
          </svg>
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
      <LogoLockup size={28} />
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Profile"
        style={{ width: 37, height: 37, borderRadius: '50%', border: 'none', cursor: 'pointer', overflow: 'hidden', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--card),0 0 0 3px var(--border)', background: user?.photo_url ? undefined : 'var(--primary)' }}
      >
        {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(user)}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Home

/** '5412 7734 90' + first 2 digits of last4, space, full last4 — a fabricated PAN, not a real one. */
function fullCardNumber(ownCard: string): string {
  const last4 = ownCard || '7549';
  return '5412 7734 90' + last4.slice(0, 2) + ' ' + last4;
}

function OwnerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ position: 'relative', background: '#1E1F23', borderRadius: 24, overflow: 'hidden', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.12, pointerEvents: 'none' }} viewBox="0 0 400 230" preserveAspectRatio="none" fill="none" stroke="#FFFFFF" strokeWidth={1}>
        <path d="M-10 30 Q 90 12, 200 32 T 410 24" />
        <path d="M-10 62 Q 96 40, 204 60 T 410 52" />
        <path d="M-10 94 Q 102 72, 208 92 T 410 84" />
        <path d="M-10 126 Q 96 104, 204 124 T 410 116" />
        <path d="M-10 158 Q 90 136, 200 156 T 410 148" />
        <path d="M-10 190 Q 96 168, 204 188 T 410 180" />
        <path d="M-10 222 Q 102 200, 208 220 T 410 212" />
      </svg>
      <svg aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: 40, opacity: 0.45, pointerEvents: 'none' }} viewBox="0 0 400 40" preserveAspectRatio="none" fill="none">
        <path d="M0 30 C 60 14, 110 14, 160 26 C 215 39, 270 20, 320 18 C 355 17, 380 24, 400 26" stroke="#FFD023" strokeWidth={7} strokeLinecap="round" />
        <path d="M0 35 C 60 19, 110 19, 160 31 C 215 44, 270 25, 320 23 C 355 22, 380 29, 400 31" stroke="#FF9E1B" strokeWidth={6} strokeLinecap="round" />
        <path d="M0 40 C 60 24, 110 24, 160 36 C 215 49, 270 30, 320 28 C 355 27, 380 34, 400 36" stroke="#F4581C" strokeWidth={6} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, background: 'linear-gradient(to top, rgba(15,16,20,.82), rgba(15,16,20,0))' }} />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: 44, height: 44, background: 'rgba(255,255,255,.12)', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <Icon name="wallet" size={23} strokeWidth={1.7} className="" />
        </div>
        <button type="button" className="press" onClick={onOpenDetails} style={{ background: 'rgba(255,255,255,.14)', border: 'none', borderRadius: 12, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer' }}>
          {t('common.details')}
        </button>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>{t('home.efsBalance')}</div>
        <div style={{ fontSize: 14, color: '#A6ABB6' }}>{t('common.balance')}</div>
        <div className="selectable" style={{ fontSize: 32, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>{HERO.balance}</div>
      </div>
      <div style={{ position: 'relative', display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,.14)' }}>
        <div style={{ width: `${HERO.pct}%`, background: 'var(--primary)', borderRadius: 3 }} />
      </div>
      <div style={{ position: 'relative', fontSize: 13, fontWeight: 600, color: '#FFFFFF', paddingBottom: 6, textShadow: '0 1px 4px rgba(0,0,0,.85)' }}>{HERO.sub}</div>
    </div>
  );
}

function DriverHero({
  session,
  company,
  fullName,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: {
  session: Session;
  company: string;
  fullName: string;
  revealed: boolean;
  copied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const display = revealed ? fullCardNumber(session.ownCard) : `•••• ${session.ownCard}`;
  return (
    <>
      <div style={{ position: 'relative', background: '#1E1F23', borderRadius: 24, overflow: 'hidden', padding: 18, height: 190, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.13 }} viewBox="0 0 400 190" preserveAspectRatio="none" fill="none" stroke="#FFFFFF" strokeWidth={1}>
          <path d="M-10 24 Q 90 8, 200 26 T 410 20" />
          <path d="M-10 50 Q 96 30, 204 48 T 410 42" />
          <path d="M-10 76 Q 102 54, 208 72 T 410 66" />
          <path d="M-10 102 Q 96 82, 204 100 T 410 94" />
          <path d="M-10 128 Q 90 108, 200 126 T 410 120" />
          <path d="M-10 154 Q 96 134, 204 152 T 410 146" />
          <path d="M-10 180 Q 102 160, 208 178 T 410 172" />
        </svg>
        <svg aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 44, width: '100%' }} viewBox="0 0 400 84" preserveAspectRatio="none" fill="none">
          <path d="M0 54 C 50 16, 86 14, 125 42 C 164 70, 207 32, 250 27 C 296 22, 336 46, 400 34" stroke="#FFD023" strokeWidth={11} strokeLinecap="round" />
          <path d="M0 61 C 50 24, 88 22, 127 49 C 166 75, 209 40, 252 35 C 298 30, 338 53, 400 42" stroke="#FF9E1B" strokeWidth={9} strokeLinecap="round" />
          <path d="M0 68 C 50 32, 90 30, 129 55 C 168 80, 211 48, 254 43 C 300 38, 340 60, 400 50" stroke="#F4581C" strokeWidth={8} strokeLinecap="round" />
        </svg>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FFFFFF', ['--logo-ring' as string]: '#FFFFFF' }}>
            <LogoLockup size={24} />
          </div>
          <span style={{ fontSize: 13, color: '#C6CAD4' }}>{company}</span>
        </div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>{fullName}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="selectable" style={{ fontSize: 15.5, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 3px rgba(0,0,0,.5)' }}>{display}</span>
            <button type="button" className="press" onClick={onToggleReveal} style={{ width: 26, height: 26, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,.16)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
              <EyeToggle revealed={revealed} />
            </button>
            <button type="button" className="press" onClick={onCopy} style={{ height: 26, padding: '0 10px', border: 'none', borderRadius: 8, background: 'rgba(255,255,255,.16)', color: '#FFFFFF', fontSize: 12, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>
              {copied ? t('card.copied') : t('card.copy')}
            </button>
          </span>
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
  pinned: string[];
  inbox: InboxItem[];
  cardRevealed: boolean;
  cardCopied: boolean;
  onToggleCardReveal: () => void;
  onCopyCardNumber: () => void;
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
  pinned,
  inbox,
  cardRevealed,
  cardCopied,
  onToggleCardReveal,
  onCopyCardNumber,
  onTogglePin,
  onOpenAction,
  onGoToServices,
  onViewFleet,
  onMarkAllRead,
  onReadNotif,
}: HomeProps) {
  const { t } = useI18n();

  if (tab === 'services') return <ServicesTab isDriver={session.isDriver} pinned={pinned} onTogglePin={onTogglePin} onOpen={onOpenAction} />;
  if (tab === 'inbox') return <InboxTab items={inbox} onMarkAllRead={onMarkAllRead} onRead={onReadNotif} />;

  const pinnedItems = pinned.map((key) => findCatalogItem(key, session.isDriver)).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {session.isDriver ? (
        <DriverHero session={session} company={company} fullName={fullName} revealed={cardRevealed} copied={cardCopied} onToggleReveal={onToggleCardReveal} onCopy={onCopyCardNumber} />
      ) : (
        <OwnerHero onOpenDetails={() => onOpenAction({ kind: 'service', key: 'status' })} />
      )}

      {/* quick actions */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, background: 'var(--secondary)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="4" y="4" width="6" height="6" rx="1.5" />
              <rect x="14" y="4" width="6" height="6" rx="1.5" />
              <rect x="4" y="14" width="6" height="6" rx="1.5" />
              <rect x="14" y="14" width="6" height="6" rx="1.5" />
            </svg>
          </div>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{t('home.quickActions')}</div>
          <button type="button" className="press" onClick={onGoToServices} style={{ background: 'var(--secondary)', border: 'none', borderRadius: 12, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: 'var(--fg)', cursor: 'pointer' }}>
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
                if (item.action === 'generic') onOpenAction({ kind: 'generic', key: item.key, title: t(item.labelKey) });
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
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 14, paddingBottom: 2 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button key={f} type="button" onClick={() => { haptic('tap'); setFilter(f); }} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', height: 34, padding: '0 13px', borderRadius: 10, fontFamily: "'Geist'", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', background: active ? 'var(--primary)' : 'var(--secondary)', color: active ? '#FFFFFF' : 'var(--muted-fg)' }}>
                <span>{t(FILTER_LABEL[f])}</span>
                <span style={{ fontSize: 11, fontWeight: 700, opacity: active ? 1 : 0.65 }}>{counts[f]}</span>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '20px 4px' }}>
          <div style={{ color: 'var(--destructive)', fontSize: 14 }}>{loadError}</div>
          <button type="button" className="press" onClick={onRetry} style={{ height: 38, border: 'none', borderRadius: 10, background: 'var(--secondary)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '0 14px' }}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && actionError && (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', color: 'var(--destructive)', fontSize: 13, lineHeight: 1.45 }}>
          {actionError}
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
                          <button type="button" className="press" onClick={() => copy(c.link!, id)} style={{ height: 46, border: 'none', borderRadius: 12, fontFamily: "'Geist'", fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '0 16px', flex: 'none', background: copiedId === id ? 'var(--success)' : 'var(--primary)', color: '#FFFFFF' }}>
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Profile bottom sheet

function ProfileSheet({
  user,
  company,
  roleLabel,
  agentName,
  theme,
  onTheme,
  onClose,
  onContactSupport,
}: {
  user: TelegramWebAppUser | undefined;
  company: string;
  roleLabel: string;
  agentName?: string | null | undefined;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onClose: () => void;
  onContactSupport: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Octane user';
  const agent = cleanAgentName(agentName);
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
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{fullName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--owner-badge-fg)', padding: '5px 10px', borderRadius: 8, background: 'var(--owner-badge-bg)', flex: 'none' }}>{roleLabel}</span>
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('menu.theme')}</div>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 12, marginBottom: 20 }}>
          {(['light', 'dark'] as Theme[]).map((opt) => (
            <button key={opt} type="button" onClick={() => onTheme(opt)} style={{ flex: 1, height: 38, border: 'none', borderRadius: 8, fontFamily: "'Geist'", fontWeight: 700, fontSize: 13, cursor: 'pointer', background: theme === opt ? 'var(--primary)' : 'transparent', color: theme === opt ? '#FFFFFF' : 'var(--muted-fg)' }}>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: active ? 1 : 0, flex: 'none' }}><path d="M20 6L9 17l-5-5" stroke="var(--link-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('svcgrp.support')}</div>
        <button type="button" className="press" onClick={onContactSupport} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '12px 14px', background: 'var(--secondary)', border: 'none', borderRadius: 14, cursor: 'pointer', fontFamily: "'Geist'" }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', color: 'var(--link-accent)' }}>
            <Icon name="headset" size={20} strokeWidth={1.8} className="" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>{agent ?? t('support.rowFallbackName')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 1 }}>{agent ? t('support.rowMessageTelegram') : t('support.rowContactGeneric')}</div>
          </div>
          <span style={{ flex: 'none', color: 'var(--link-accent)', display: 'flex' }}>
            <Icon name="plane" size={20} strokeWidth={1.8} className="" />
          </span>
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Service action sheet (self-service — demo data until EFS integrations land)

function ActionSheet({
  target,
  session,
  company,
  fullName,
  onClose,
  showToast,
  onSendGeneric,
}: {
  target: OpenAction;
  session: Session;
  company: string;
  fullName: string;
  onClose: () => void;
  showToast: (msg: string, kind?: ToastKind) => void;
  onSendGeneric: (title: string) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [viewInvoice, setViewInvoice] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | 'custom'>('30d');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-07-09');
  const [genericSent, setGenericSent] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 850);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const service = target.kind === 'service' ? target.key : null;
  const sheetTitle = target.kind === 'generic' ? target.title : t(`svc.${service}`);
  const roleForCards = session.isFleetManager ? 'fleet' : session.isOwnerOp ? 'ownerOp' : 'driver';
  const cards = statusCards(roleForCards as 'fleet' | 'ownerOp' | 'driver', session.ownCard);
  let txns = TXN_ALL.filter((r) => (range === '7d' ? r.iso >= '2026-07-02' : range === 'custom' ? r.iso >= from && r.iso <= to : true));
  if (session.isDriver) txns = txns.map((r) => ({ ...r, card: session.ownCard }));
  const invoiceIds = Object.keys(INVOICE_DOCS).reverse();

  function exportCsv() {
    haptic('tap');
    showToast(t('toast.csvExportStarted'));
  }

  function sendGeneric() {
    haptic('success');
    setGenericSent(true);
    onSendGeneric(sheetTitle);
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
          ) : service === 'balance' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {BALANCE_TILES.map((tile) => (
                  <div key={tile.label} style={{ background: tile.accent ? 'var(--primary)' : 'var(--secondary)', borderRadius: 14, padding: '13px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: tile.accent ? 'rgba(255,255,255,.75)' : 'var(--muted-fg)' }}>{tile.label}</div>
                    <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: tile.accent ? '#FFFFFF' : 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 14, lineHeight: 1.5 }}>{t('balance.locNote')}</div>
            </>
          ) : service === 'status' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--success) 13%, transparent)', borderRadius: 14, marginBottom: 14 }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="check" size={17} strokeWidth={2.4} className="" /></span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('status.active')}</span>
              </div>
              <SectionLabel>{t('status.debt')}</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                {STATUS_TILES.map((tile) => (
                  <div key={tile.label} style={{ background: 'var(--secondary)', borderRadius: 14, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted-fg)' }}>{tile.label}</div>
                    <div className="selectable" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                  </div>
                ))}
              </div>
              <SectionLabel>{t('status.cards')}</SectionLabel>
              <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                {cards.map((c) => (
                  <div key={c.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                    <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.num}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted-fg)' }}>{c.last}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.status === 'Active' ? 'var(--success)' : 'var(--destructive)' }}>{c.status}</span>
                  </div>
                ))}
              </div>
              {session.isFleetManager && <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 9, textAlign: 'center' }}>+ 21 more cards</div>}
            </>
          ) : service === 'txns' ? (
            <>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 12, marginBottom: 12 }}>
                {(['7d', '30d', 'custom'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRange(r)} style={{ flex: 1, height: 34, border: 'none', borderRadius: 8, fontFamily: "'Geist'", fontWeight: 700, fontSize: 13, cursor: 'pointer', background: range === r ? 'var(--primary)' : 'transparent', color: range === r ? '#FFFFFF' : 'var(--muted-fg)' }}>
                    {r === '7d' ? t('txns.7d') : r === '30d' ? t('txns.30d') : t('txns.custom')}
                  </button>
                ))}
              </div>
              {range === 'custom' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <label style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>{t('txns.from')}</span>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 13, padding: '0 11px' }} />
                  </label>
                  <label style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>{t('txns.to')}</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Geist'", fontSize: 13, padding: '0 11px' }} />
                  </label>
                </div>
              )}
              {txns.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('txns.empty')}</div>
              ) : (
                <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
                  {txns.map((tx, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.location}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2 }}>{tx.date} · •••• {tx.card}</div>
                      </div>
                      <span className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{tx.amount}</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="press" onClick={exportCsv} style={{ width: '100%', height: 46, marginTop: 14, border: 'none', borderRadius: 12, background: 'var(--secondary)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t('common.export')}</button>
            </>
          ) : service === 'invoices' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
              {invoiceIds.map((k) => {
                const d = INVOICE_DOCS[k]!;
                return (
                  <div key={k} onClick={() => { haptic('tap'); setViewInvoice(k); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', color: 'var(--muted-fg)' }}><Icon name="doc" size={17} strokeWidth={2} className="" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('invoice.num', { n: k })}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2 }}>{d.date} · {d.total} · {d.paid ? t('invoice.paid') : t('invoice.due')}</div>
                    </div>
                    <span style={{ borderRadius: 9, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--fg)', fontFamily: "'Geist'", fontWeight: 600, fontSize: 12.5, padding: '7px 12px', flex: 'none' }}>{t('common.view')}</span>
                  </div>
                );
              })}
            </div>
          ) : service === 'payment' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
              {PAYMENT_ROWS.map((p) => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted-fg)' }}>{p.label}</span>
                  <span className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{p.value}</span>
                </div>
              ))}
            </div>
          ) : service === 'lastused' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 14, overflow: 'hidden' }}>
              {cards.map((c, i) => (
                <div key={c.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.num}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: 'var(--fg)' }}>{c.last}, 2026</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 1 }}>{t('time.dayN', { n: i === 0 ? 1 : i === 1 ? 2 : 9 })}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : service === 'tracking' ? (
            (() => {
              const tr = TRACKING(session.ownCard, session.isDriver);
              return (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6px 0 4px' }}>
                    <span style={{ width: 54, height: 54, borderRadius: 16, background: 'var(--secondary)', color: 'var(--link-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="pin" size={26} strokeWidth={2} className="" /></span>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{tr.status}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3 }}>{t('track.cardLabel')} •••• {tr.card} · {tr.eta}</div>
                  </div>
                  <div style={{ background: 'var(--secondary)', borderRadius: 14, padding: '13px 14px', marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('track.number')}</div>
                    <div className="selectable" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tr.number}</div>
                  </div>
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
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.5, marginBottom: 6 }}>{t('generic.notSentBody1')}</div>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)', lineHeight: 1.5, marginBottom: 16 }}>{t('generic.notSentBody2')}</div>
              <button type="button" className="press" onClick={sendGeneric} style={{ width: '100%', height: 50, border: 'none', borderRadius: 14, background: 'var(--primary)', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                {t('generic.sendButton')}
              </button>
            </>
          )}
        </div>
      </div>

      {viewInvoice && <InvoiceView id={viewInvoice} billToName={fullName} billToCompany={company} onClose={() => setViewInvoice(null)} showToast={showToast} />}
    </>
  );
}

function InvoiceView({
  id,
  billToName,
  billToCompany,
  onClose,
  showToast,
}: {
  id: string;
  billToName: string;
  billToCompany: string;
  onClose: () => void;
  showToast: (msg: string, kind?: ToastKind) => void;
}) {
  const { t } = useI18n();
  const doc = INVOICE_DOCS[id]!;

  function download() {
    haptic('tap');
    try {
      downloadInvoicePdf(id, doc, billToName || billToCompany, billToCompany);
      showToast(t('toast.invoiceDownloaded'));
    } catch {
      haptic('error');
      showToast(t('toast.invoiceDownloadFailed'), 'error');
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 46, display: 'flex', flexDirection: 'column', background: '#33363c', animation: 'octfade .2s ease' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 12px 10px', background: '#212327' }}>
        <button type="button" className="press" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#cdd2da', fontFamily: "'Geist'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 8px 6px 4px' }}><BackChevron />{t('common.back')}</button>
        <span className="selectable" style={{ fontSize: 13, fontWeight: 600, color: '#eef1f5', fontVariantNumeric: 'tabular-nums' }}>{id}.pdf</span>
        <button type="button" className="press" onClick={download} style={{ border: 'none', borderRadius: 10, background: '#2451FF', color: '#FFFFFF', fontFamily: "'Geist'", fontWeight: 600, fontSize: 13, padding: '9px 14px', cursor: 'pointer' }}>{t('common.download')}</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '18px 16px 30px' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 342, margin: '0 auto', background: '#fff', borderRadius: 6, boxShadow: '0 12px 40px rgba(0,0,0,.45)', padding: '24px 22px', color: '#141414', fontFamily: "'Inter Tight'" }}>
          <div style={{ position: 'absolute', top: 330, left: '50%', transform: 'translateX(-50%) rotate(-14deg)', border: '3px solid #FF6A00', color: '#FF6A00', borderRadius: 9, padding: '5px 16px', fontSize: 30, fontWeight: 800, letterSpacing: '.1em', opacity: 0.22, pointerEvents: 'none' }}>{doc.paid ? 'PAID' : 'DUE'}</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ ['--logo-ring' as string]: '#0b0b0c', color: '#141414' }}><LogoLockup size={21} /></div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#FF6A00', letterSpacing: '.02em' }}>INVOICE</div>
              <div className="selectable" style={{ fontSize: 12, fontWeight: 700, color: '#141414', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>#{id}</div>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: '#8a8f98', lineHeight: 1.55, marginTop: 8 }}>TSS Technology LLC · 7901 4th St N, Ste 300, St. Petersburg, FL 33702<br />Phone: 953867683 · billing@octanefuel.com</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', background: 'color-mix(in srgb, #FFD200 13%, #fff)', border: '1px solid color-mix(in srgb, #FF8A00 24%, #fff)', borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 11.5 }}>
            {([['START PERIOD', doc.start], ['END PERIOD', doc.end], ['DATE', doc.date], ['DUE DATE', doc.due], ['CUSTOMER ID', doc.customerId]] as const).map(([k, v]) => (
              <div key={k}><span style={{ color: '#A35A00', fontWeight: 800, fontSize: 8.5, letterSpacing: '.07em' }}>{k}</span><div style={{ fontWeight: 600, marginTop: 1 }}>{v}</div></div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', color: '#FF6A00' }}>BILL TO</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#141414', marginTop: 3 }}>{billToName || billToCompany}</div>
            <div style={{ fontSize: 11, color: '#5c616b', marginTop: 1 }}>{billToCompany}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'linear-gradient(135deg,#FFD200,#FFB000)', borderRadius: 6, padding: '7px 12px', marginTop: 14, fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: '#17130F' }}><span>DESCRIPTION</span><span>AMOUNT</span></div>
          {doc.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '8px 12px 7px', borderBottom: '1px solid #f6edd6' }}>
              <span style={{ color: '#3a3f47' }}>{r.d}</span>
              <span className="selectable" style={{ color: '#141414', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{r.a}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg,#FFC93C,#FF7A16)', borderRadius: 6, padding: '10px 12px', marginTop: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: '#17130F' }}>TOTAL DUE</span>
            <span className="selectable" style={{ fontSize: 17, fontWeight: 800, color: '#17130F', fontVariantNumeric: 'tabular-nums' }}>{doc.total}</span>
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3e8cd', fontSize: 10, color: '#8a8f98', textAlign: 'center', lineHeight: 1.55 }}>Questions? TSS Technology LLC · 953867683 · billing@octanefuel.com<br /><span style={{ color: '#FF6A00', fontWeight: 800 }}>Thank You For Your Business!</span></div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

export function App() {
  const wa = getTelegramWebApp();
  const user = wa?.initDataUnsafe.user;
  const firstName = user?.first_name || 'there';
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
  const [cardCopied, setCardCopied] = useState(false);
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
  const roleLabel = t(session.isFleetManager ? 'role.fleet' : session.isOwner ? 'role.owner' : 'role.driver');

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
    setInbox((i) => (i.length ? i : seedInbox(session.isDriver)));
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
        if (e instanceof ApiError) {
          showError(e.message, e.code === 'MINI_APP_NOT_REGISTERED' ? t('auth.title') : t('error.title'));
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
      showError(t('auth.needLink'), t('auth.title'));
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
    haptic('tap');
    setTheme(next);
    setThemeState(next);
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

  function copyCardNumber() {
    const full = fullCardNumber(session.ownCard).replace(/\s/g, '');
    try {
      navigator.clipboard?.writeText(full);
    } catch {
      // ignore
    }
    haptic('success');
    setCardCopied(true);
    showToast(t('toast.cardNumberCopied'));
    setTimeout(() => setCardCopied(false), 1600);
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
      { id: 'gen-' + Date.now(), icon: 'plane', color: null, titleKey: '', titleText: t('inbox.genericReceived.title', { title }), bodyKey: '', bodyText: t('inbox.genericReceived.body'), atKey: 'time.justNow', unread: true },
      ...cur,
    ]);
  }

  function contactSupport() {
    haptic('tap');
    const agent = cleanAgentName(supportAgentName);
    try {
      window.open('https://t.me/octane_support_ai_bot', '_blank', 'noopener');
    } catch {
      // ignore
    }
    showToast(agent ? t('toast.supportOpenNamed', { agent }) : t('toast.supportOpenGeneric'));
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
        setFleetLoadError(e instanceof ApiError ? e.message : t('fleet.error'));
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
      setFleetActionError(e instanceof ApiError ? e.message : t('fleet.error'));
    }
  }
  const createLink = (cardId: string, name: string) => submitDriverLink(cardId, name, 'toast.driverLinkCreated');
  const regenerateLink = (cardId: string, name: string) => submitDriverLink(cardId, name, 'toast.newLinkGenerated');

  const signedIn = screen === 'home' || screen === 'fleet';

  return (
    <div className="app-root" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--background)', overflow: 'hidden' }}>
      {signedIn && <AppHeader user={user} onOpenProfile={() => { haptic('tap'); setProfileOpen(true); }} />}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'error' && <ErrorScreen title={errorTitle} reason={errorReason} agentName={supportAgentName} />}
        {screen === 'confirm' && preview && <ConfirmScreen preview={preview} firstName={firstName} busy={busy} onConfirm={confirm} />}
        {screen === 'success' && <SuccessScreen session={session} company={company} onContinue={goHome} />}
        {screen === 'already' && <AlreadyScreen company={company} agentName={supportAgentName} onContinue={goHome} />}
        {screen === 'home' && (
          <Home
            session={session}
            tab={tab}
            company={company}
            fullName={fullName}
            pinned={pinned}
            inbox={inbox}
            cardRevealed={cardRevealed}
            cardCopied={cardCopied}
            onToggleCardReveal={toggleCardReveal}
            onCopyCardNumber={copyCardNumber}
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
            showToast={showToast}
            askConfirm={askConfirm}
          />
        )}
      </div>

      {screen === 'home' && <TabBar active={tab} unreadCount={inbox.filter((n) => n.unread).length} onSelect={setTab} />}

      {profileOpen && (
        <ProfileSheet
          user={user}
          company={company}
          roleLabel={roleLabel}
          agentName={supportAgentName}
          theme={theme}
          onTheme={chooseTheme}
          onClose={() => setProfileOpen(false)}
          onContactSupport={contactSupport}
        />
      )}
      {openAction && (
        <ActionSheet
          target={openAction}
          session={session}
          company={company}
          fullName={fullName}
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
