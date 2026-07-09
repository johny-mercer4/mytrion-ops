import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ApiError,
  createDriverInvite,
  fetchFleet,
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
import { BackChevron, Chevron, Icon, SearchGlyph, type IconName } from './components/icons';
import {
  BALANCE_TILES,
  HERO,
  INVOICE_DOCS,
  PAYMENT_ROWS,
  STATUS_TILES,
  TRACKING,
  TXN_ALL,
  logActivity,
  seedActivities,
  statusCards,
  type ActivityItem,
} from './lib/demo';
import { downloadInvoicePdf } from './lib/pdf';

const GRADIENT = 'linear-gradient(135deg,#FFD200,#FF5A00)';
const CTA_SHADOW = '0 4px 14px color-mix(in srgb, var(--primary) 34%, transparent)';

type Screen = 'loading' | 'error' | 'confirm' | 'success' | 'already' | 'home' | 'fleet';
type ServiceKey = 'balance' | 'status' | 'txns' | 'invoices' | 'payment' | 'lastused' | 'tracking';

interface Session {
  role: 'fleet-manager' | 'owner-operator' | 'driver';
  isDriver: boolean;
  isOwnerOp: boolean;
  isFleetManager: boolean;
  ownCard: string;
}

function sessionFrom(reg: RegistrationView | null): Session {
  const companyType = reg?.companyType ?? null;
  const isDriver = reg?.profile === 'driver';
  const isFleetManager = reg?.profile === 'owner' && companyType === 'fleet-manager';
  const isOwnerOp = reg?.profile === 'owner' && companyType !== 'fleet-manager';
  const ownCard = (reg?.cardId ?? '7549').slice(-4);
  return {
    role: isFleetManager ? 'fleet-manager' : isOwnerOp ? 'owner-operator' : 'driver',
    isDriver,
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
        borderRadius: 12,
        background: GRADIENT,
        color: '#17130F',
        fontFamily: "'Inter Tight'",
        fontWeight: 600,
        fontSize: 15,
        cursor: 'pointer',
        boxShadow: CTA_SHADOW,
        opacity: disabled ? 0.6 : 1,
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

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <Screen center>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <LogoLockup size={40} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Spinner />
          <div style={{ fontSize: 14, color: 'var(--muted-fg)' }}>{t('loading')}</div>
        </div>
      </div>
    </Screen>
  );
}

function ErrorScreen({ reason }: { reason: string }) {
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
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>{t('error.title')}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted-fg)' }}>{reason}</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted-fg)', textAlign: 'center', padding: '12px 16px', background: 'var(--secondary)', borderRadius: 12, maxWidth: 300 }}>
          {t('error.contact')}
        </div>
      </div>
    </Screen>
  );
}

function DetailCard({ children }: { children: ReactNode }) {
  return <div style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>{children}</div>;
}

function ConfirmScreen({ preview, firstName, busy, onConfirm }: { preview: RegistrationPreview; firstName: string; busy: boolean; onConfirm: () => void }) {
  const { t } = useI18n();
  const isOwner = preview.profile === 'owner';
  const roleLabel = t(preview.companyType === 'fleet-manager' ? 'role.fleet' : 'role.owner');
  const cd = countdown(preview.expiresAt);
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
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', padding: '5px 11px', borderRadius: 8, background: 'var(--secondary)', border: '1px solid var(--border)' }}>
              {isOwner ? roleLabel : t('role.driver')}
            </span>
          </div>
        </DetailCard>
        <CtaButton onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner size={20} /> : t('confirm.cta')}
        </CtaButton>
        {!cd.expired && cd.short && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, background: 'color-mix(in srgb, var(--primary) 10%, transparent)', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>
            <Icon name="clock" size={13} strokeWidth={2} className="" />
            <span>{t('confirm.expires', { time: cd.short })}</span>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted-fg)', textAlign: 'center', lineHeight: 1.5 }}>{t('confirm.footnote')}</div>
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

function AlreadyScreen({ company, onContinue }: { company: string; onContinue: () => void }) {
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
        <div style={{ fontSize: 13, color: 'var(--muted-fg)', textAlign: 'center', maxWidth: 300 }}>{t('already.footnote')}</div>
      </div>
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Signed-in header

function AppHeader({ user, onOpenProfile }: { user: TelegramWebAppUser | undefined; onOpenProfile: () => void }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', background: 'var(--card)', borderBottom: '1px solid var(--border)', flex: 'none' }}>
      <LogoLockup size={22} />
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Profile"
        style={{ width: 37, height: 37, borderRadius: '50%', border: 'none', cursor: 'pointer', overflow: 'hidden', color: '#17130F', fontFamily: "'Inter Tight'", fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--card),0 0 0 3px var(--border)', background: user?.photo_url ? undefined : GRADIENT }}
      >
        {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(user)}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Home

const SERVICES: Array<{ key: ServiceKey; icon: IconName; driver: boolean }> = [
  { key: 'balance', icon: 'wallet', driver: false },
  { key: 'status', icon: 'shield', driver: false },
  { key: 'txns', icon: 'list', driver: true },
  { key: 'invoices', icon: 'doc', driver: false },
  { key: 'payment', icon: 'card', driver: false },
  { key: 'lastused', icon: 'clock', driver: true },
  { key: 'tracking', icon: 'pin', driver: true },
];

function Home({ session, activities, onOpenService, onViewFleet }: { session: Session; activities: ActivityItem[]; onOpenService: (k: ServiceKey) => void; onViewFleet: () => void }) {
  const { t } = useI18n();
  const services = SERVICES.filter((s) => (session.isDriver ? s.driver : true));
  const heroEyebrow = session.isDriver ? t('home.yourCard') : t('home.efsBalance');
  const heroValue = session.isDriver ? `•••• ${session.ownCard}` : HERO.balance;
  const heroSub = session.isDriver ? t('home.cardStanding') : HERO.sub;
  const heroTappable = !session.isDriver;

  return (
    <div style={{ padding: '16px 16px 44px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* hero */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, padding: '19px 19px 21px', background: 'linear-gradient(135deg,#FFD24A 0%,#FF9F2B 52%,#FF7A16 100%)', boxShadow: '0 8px 22px rgba(255,122,22,.32), inset 0 1px 0 rgba(255,255,255,.5)' }}>
        <div style={{ position: 'absolute', right: -24, top: -16, pointerEvents: 'none', opacity: 0.14 }}>
          <svg width="150" height="150" viewBox="0 0 100 100" fill="none"><path d="M20 52 C20 33 30 22 44 26 C53 29 57 33 66 30 C74 27 80 36 80 52 A30 30 0 1 1 20 52 Z" fill="#17130F" /></svg>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', textTransform: 'uppercase', color: 'rgba(23,19,15,.62)' }}>{heroEyebrow}</div>
            {heroTappable && (
              <button type="button" className="press" onClick={() => onOpenService('status')} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(23,19,15,.16)', color: '#17130F', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
                <svg width="8" height="13" viewBox="0 0 8 13"><path d="M1.5 1.5L6 6.5l-4.5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
          <div className="selectable" style={{ fontSize: 37, fontWeight: 800, color: '#17130F', letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums', marginTop: 9, lineHeight: 1 }}>{heroValue}</div>
          {heroTappable && (
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(23,19,15,.16)', overflow: 'hidden', marginTop: 15 }}>
              <div style={{ height: '100%', width: `${HERO.pct}%`, background: '#17130F', borderRadius: 3 }} />
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(23,19,15,.72)', marginTop: 10 }}>{heroSub}</div>
        </div>
      </div>

      {/* services */}
      <div>
        <SectionLabel>{t('home.services')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {services.map((s) => (
            <button key={s.key} type="button" className="press" onClick={() => onOpenService(s.key)} style={{ textAlign: 'left', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 9, fontFamily: "'Inter Tight'" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(140deg, color-mix(in srgb, #FFD200 22%, transparent), color-mix(in srgb, #FF5A00 20%, transparent))', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={s.icon} size={21} strokeWidth={2} className="" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t(`svc.${s.key}`)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2, lineHeight: 1.35 }}>{t(`svc.${s.key}.d`)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* manage fleet */}
      {session.isFleetManager && (
        <button type="button" className="press" onClick={onViewFleet} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, cursor: 'pointer', fontFamily: "'Inter Tight'" }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="card" size={21} strokeWidth={2} className="" />
            </span>
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('home.manageFleet')}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2 }}>{t('home.manageFleetSub')}</span>
            </span>
          </span>
          <Chevron />
        </button>
      )}

      {/* recent activity */}
      <div>
        <SectionLabel>{t('home.recent')}</SectionLabel>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          {activities.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)' }}>
                <Icon name="check" size={15} strokeWidth={2.4} className="" />
              </span>
              <span style={{ flex: 1, fontSize: 14, color: 'var(--fg)' }}>{a.action}</span>
              <span style={{ fontSize: 12, color: 'var(--muted-fg)', flex: 'none' }}>{a.at}</span>
            </div>
          ))}
        </div>
      </div>
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
      ? { w: t('card.registered'), c: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 15%, transparent)', icon: 'check' as IconName }
      : expired
        ? { w: t('card.expired'), c: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 14%, transparent)', icon: 'clock' as IconName }
        : c.status === 'pending'
          ? { w: t('card.pending'), c: 'var(--primary)', bg: 'color-mix(in srgb, var(--primary) 16%, transparent)', icon: 'plane' as IconName }
          : { w: t('card.open'), c: 'var(--muted-fg)', bg: 'var(--secondary)', icon: 'userplus' as IconName };
  return { ...c, expired, statusWord: meta.w, statusColor: meta.c, iconBg: meta.bg, iconColor: meta.c, iconName: meta.icon };
}

function FleetView({
  cards,
  loading,
  error,
  onBack,
  onCreate,
  onRegenerate,
}: {
  cards: FleetCard[];
  loading: boolean;
  error: string;
  onBack: () => void;
  onCreate: (cardId: string, name: string) => Promise<void>;
  onRegenerate: (cardId: string, name: string) => Promise<void>;
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
    setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 1600);
  }

  async function run(cardId: string, fn: (id: string, name: string) => Promise<void>) {
    const name = (drafts[cardId] ?? '').trim();
    setBusyId(cardId);
    try {
      await fn(cardId, name);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ padding: '0 16px 44px' }}>
      <div style={{ position: 'sticky', top: 63, zIndex: 4, background: 'var(--background)', margin: '0 -16px', padding: '10px 16px 2px' }}>
        <button type="button" className="press" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--muted-fg)', fontFamily: "'Inter Tight'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 8px 6px 0', marginBottom: 2 }}>
          <BackChevron />
          <span>{t('common.home')}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '2px 2px 12px' }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg)' }}>{t('fleet.title')}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('fleet.count', { n: registeredCount, total })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 44, padding: '0 13px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10 }}>
          <SearchGlyph />
          <input className="selectable" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('fleet.search')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontSize: 14 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 14, paddingBottom: 2 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button key={f} type="button" onClick={() => { haptic('tap'); setFilter(f); }} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', height: 34, padding: '0 13px', borderRadius: 10, fontFamily: "'Inter Tight'", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? 'var(--card)' : 'var(--secondary)', color: active ? 'var(--fg)' : 'var(--muted-fg)', border: active ? '1.5px solid var(--primary)' : '1.5px solid transparent' }}>
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
      {!loading && error && <div style={{ padding: '20px 4px', color: 'var(--destructive)', fontSize: 14 }}>{error}</div>}
      {!loading && !error && total > 0 && shown.length === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('fleet.noMatch')}</div>
      )}
      {!loading && !error && total === 0 && (
        <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>{t('fleet.empty')}</div>
      )}

      {!loading && !error && shown.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {shown.map((c) => {
            const id = c.cardId ?? '';
            const expanded = expandedId === id;
            const showLink = c.status === 'pending' && !c.expired && !!c.link;
            const busy = busyId === id;
            return (
              <div key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                <div onClick={() => setExpandedId((x) => (x === id ? null : id))} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', minHeight: 64, cursor: 'pointer' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.iconBg, color: c.iconColor }}>
                    <Icon name={c.iconName} size={18} strokeWidth={2} className="" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="selectable" style={{ fontWeight: 600, fontSize: 15, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em' }}>•••• {last4(c.cardNumber, c.cardId)}</span>
                      {c.cardType && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--muted-fg)', background: 'var(--secondary)', padding: '2px 6px', borderRadius: 6 }}>{c.cardType}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.driverName ?? t('card.unassigned')}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: c.statusColor, flex: 'none' }}>{c.statusWord}</span>
                  <Chevron style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s ease' }} />
                </div>

                {expanded && (
                  <div style={{ padding: '0 15px 16px', animation: 'octfade .2s ease' }}>
                    {c.status === 'open' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('card.name')}</label>
                        <input className="selectable" value={drafts[id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))} placeholder={t('card.namePh')} style={{ height: 46, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontSize: 15, padding: '0 13px', width: '100%' }} />
                        <button type="button" className="press" disabled={busy || !(drafts[id] ?? '').trim()} onClick={() => void run(id, onCreate)} style={{ height: 46, border: 'none', borderRadius: 10, background: GRADIENT, color: '#17130F', fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: busy || !(drafts[id] ?? '').trim() ? 0.6 : 1 }}>
                          {busy ? <Spinner size={18} /> : t('card.create')}
                        </button>
                      </div>
                    )}
                    {showLink && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-fg)' }}>{t('card.linkFor', { name: c.driverName ?? '' })}</div>
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                          <div className="selectable" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '0 12px', height: 46, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--background)', fontSize: 12.5, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.link}</div>
                          <button type="button" className="press" onClick={() => copy(c.link!, id)} style={{ height: 46, border: 'none', borderRadius: 10, fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '0 16px', flex: 'none', background: copiedId === id ? 'var(--success)' : 'var(--fg)', color: copiedId === id ? '#fff' : 'var(--card)' }}>
                            {copiedId === id ? t('card.copied') : t('card.copy')}
                          </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                          <Icon name="clock" size={13} strokeWidth={2} className="" />
                          <span>{t('card.expiresIn', { time: countdown(c.expiresAt).short })}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted-fg)', lineHeight: 1.45 }}>{t('card.share')}</div>
                      </div>
                    )}
                    {c.status === 'pending' && c.expired && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', borderRadius: 10 }}>
                          <span style={{ flex: 'none', color: 'var(--destructive)' }}><Icon name="clock" size={16} strokeWidth={2} className="" /></span>
                          <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>{t('card.expiredNotice', { name: c.driverName ?? '' })}</div>
                        </div>
                        <button type="button" className="press" disabled={busy} onClick={() => void run(id, onRegenerate)} style={{ height: 46, border: 'none', borderRadius: 10, background: GRADIENT, color: '#17130F', fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                          {busy ? <Spinner size={18} /> : t('card.regenerate')}
                        </button>
                      </div>
                    )}
                    {c.status === 'registered' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 10 }}>
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

function ProfileSheet({ user, company, roleLabel, theme, onTheme, onClose }: { user: TelegramWebAppUser | undefined; company: string; roleLabel: string; theme: Theme; onTheme: (t: Theme) => void; onClose: () => void }) {
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
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.42)', animation: 'octfade .2s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 41, background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(34px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 40px rgba(0,0,0,.28)', animation: 'octsheet .28s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 22 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', background: user?.photo_url ? undefined : GRADIENT, color: '#17130F', fontWeight: 700, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(user)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{fullName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', padding: '5px 10px', borderRadius: 8, background: 'var(--secondary)', border: '1px solid var(--border)', flex: 'none' }}>{roleLabel}</span>
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('menu.theme')}</div>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 11, marginBottom: 20 }}>
          {(['light', 'dark'] as Theme[]).map((opt) => (
            <button key={opt} type="button" onClick={() => onTheme(opt)} style={{ flex: 1, height: 38, border: 'none', borderRadius: 8, fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 13, cursor: 'pointer', background: theme === opt ? 'var(--card)' : 'transparent', color: theme === opt ? 'var(--fg)' : 'var(--muted-fg)', boxShadow: theme === opt ? '0 1px 2px rgba(0,0,0,.14)' : 'none' }}>
              {t(opt === 'light' ? 'menu.light' : 'menu.dark')}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', marginBottom: 9 }}>{t('menu.language')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {LANGUAGES.map((l) => {
            const active = lang === l.code;
            return (
              <button key={l.code} type="button" onClick={() => { haptic('tap'); setLang(l.code); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, height: 46, padding: '0 14px', borderRadius: 10, fontFamily: "'Inter Tight'", fontSize: 14, color: 'var(--fg)', cursor: 'pointer', fontWeight: active ? 600 : 500, background: active ? 'var(--secondary)' : 'transparent', border: active ? '1px solid var(--primary)' : '1px solid var(--border)' }}>
                <span>{l.label}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: active ? 1 : 0, flex: 'none' }}><path d="M20 6L9 17l-5-5" stroke="var(--primary)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Service action sheet (self-service — demo data until EFS integrations land)

function ActionSheet({ service, session, company, fullName, onClose }: { service: ServiceKey; session: Session; company: string; fullName: string; onClose: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [viewInvoice, setViewInvoice] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | 'custom'>('30d');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-07-09');
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

  const roleForCards = session.isFleetManager ? 'fleet' : session.isOwnerOp ? 'ownerOp' : 'driver';
  const cards = statusCards(roleForCards as 'fleet' | 'ownerOp' | 'driver', session.ownCard);
  let txns = TXN_ALL.filter((r) => (range === '7d' ? r.iso >= '2026-07-02' : range === 'custom' ? r.iso >= from && r.iso <= to : true));
  if (session.isDriver) txns = txns.map((r) => ({ ...r, card: session.ownCard }));
  const invoiceIds = Object.keys(INVOICE_DOCS).reverse();

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 42, background: 'rgba(0,0,0,.42)', animation: 'octfade .2s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 43, maxHeight: '84%', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: '20px 20px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,.28)', animation: 'octsheet .28s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ flex: 'none', padding: '10px 20px 6px' }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>{t(`svc.${service}`)}</span>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--secondary)', color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
              <Icon name="x" size={14} strokeWidth={1.8} className="" />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px 30px', minHeight: 150 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '44px 0' }}>
              <Spinner size={30} />
              <div style={{ fontSize: 13, color: 'var(--muted-fg)' }}>{t('sheet.fetching', { what: t(`svc.${service}`).toLowerCase() })}</div>
            </div>
          ) : service === 'balance' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {BALANCE_TILES.map((tile) => (
                  <div key={tile.label} style={{ background: tile.accent ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'var(--secondary)', borderRadius: 12, padding: '13px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)' }}>{tile.label}</div>
                    <div className="selectable" style={{ fontSize: 19, fontWeight: 700, color: tile.accent ? 'var(--primary)' : 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 14, lineHeight: 1.5 }}>Line-of-credit account · billed weekly. Available updates as transactions post.</div>
            </>
          ) : service === 'status' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'color-mix(in srgb, var(--success) 13%, transparent)', borderRadius: 12, marginBottom: 14 }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="check" size={17} strokeWidth={2.4} className="" /></span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Account active · in good standing</span>
              </div>
              <SectionLabel>Debt</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                {STATUS_TILES.map((tile) => (
                  <div key={tile.label} style={{ background: 'var(--secondary)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)' }}>{tile.label}</div>
                    <div className="selectable" style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tile.value}</div>
                  </div>
                ))}
              </div>
              <SectionLabel>Cards</SectionLabel>
              <div style={{ background: 'var(--secondary)', borderRadius: 12, overflow: 'hidden' }}>
                {cards.map((c) => (
                  <div key={c.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                    <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.num}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted-fg)' }}>{c.last}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{c.status}</span>
                  </div>
                ))}
              </div>
              {session.isFleetManager && <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 9, textAlign: 'center' }}>+ 21 more cards</div>}
            </>
          ) : service === 'txns' ? (
            <>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--secondary)', borderRadius: 10, marginBottom: 12 }}>
                {(['7d', '30d', 'custom'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRange(r)} style={{ flex: 1, height: 34, border: 'none', borderRadius: 8, fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 13, cursor: 'pointer', background: range === r ? 'var(--card)' : 'transparent', color: range === r ? 'var(--fg)' : 'var(--muted-fg)', boxShadow: range === r ? '0 1px 2px rgba(0,0,0,.14)' : 'none' }}>
                    {r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'Custom'}
                  </button>
                ))}
              </div>
              {range === 'custom' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <label style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>From</span>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontSize: 13, padding: '0 11px' }} />
                  </label>
                  <label style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)', marginBottom: 5 }}>To</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--background)', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontSize: 13, padding: '0 11px' }} />
                  </label>
                </div>
              )}
              {txns.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '34px 20px', color: 'var(--muted-fg)', fontSize: 14 }}>No transactions in this range.</div>
              ) : (
                <div style={{ background: 'var(--secondary)', borderRadius: 12, overflow: 'hidden' }}>
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
              <button type="button" className="press" onClick={() => haptic('tap')} style={{ width: '100%', height: 46, marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t('common.export')}</button>
            </>
          ) : service === 'invoices' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 12, overflow: 'hidden' }}>
              {invoiceIds.map((k) => {
                const d = INVOICE_DOCS[k]!;
                return (
                  <div key={k} onClick={() => { haptic('tap'); setViewInvoice(k); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 8, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', color: 'var(--muted-fg)' }}><Icon name="doc" size={17} strokeWidth={2} className="" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Invoice #{k}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 2 }}>{d.date} · {d.total} · {d.paid ? 'Paid' : 'Due'}</div>
                    </div>
                    <span style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', color: 'var(--fg)', fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 12.5, padding: '7px 12px', flex: 'none' }}>{t('common.view')}</span>
                  </div>
                );
              })}
            </div>
          ) : service === 'payment' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 12, overflow: 'hidden' }}>
              {PAYMENT_ROWS.map((p) => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted-fg)' }}>{p.label}</span>
                  <span className="selectable" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{p.value}</span>
                </div>
              ))}
            </div>
          ) : service === 'lastused' ? (
            <div style={{ background: 'var(--secondary)', borderRadius: 12, overflow: 'hidden' }}>
              {cards.map((c, i) => (
                <div key={c.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span className="selectable" style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.num}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: 'var(--fg)' }}>{c.last}, 2026</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 1 }}>{i === 0 ? '1 day ago' : i === 1 ? '2 days ago' : '9 days ago'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            (() => {
              const tr = TRACKING(session.ownCard, session.isDriver);
              return (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6px 0 4px' }}>
                    <span style={{ width: 54, height: 54, borderRadius: '50%', background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="pin" size={26} strokeWidth={2} className="" /></span>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{tr.status}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 3 }}>Card •••• {tr.card} · {tr.eta}</div>
                  </div>
                  <div style={{ background: 'var(--secondary)', borderRadius: 12, padding: '13px 14px', marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted-fg)' }}>Tracking number</div>
                    <div className="selectable" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{tr.number}</div>
                  </div>
                </>
              );
            })()
          )}
        </div>
      </div>

      {viewInvoice && <InvoiceView id={viewInvoice} billToName={fullName} billToCompany={company} onClose={() => setViewInvoice(null)} />}
    </>
  );
}

function InvoiceView({ id, billToName, billToCompany, onClose }: { id: string; billToName: string; billToCompany: string; onClose: () => void }) {
  const { t } = useI18n();
  const doc = INVOICE_DOCS[id]!;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 46, display: 'flex', flexDirection: 'column', background: '#33363c', animation: 'octfade .2s ease' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 12px 10px', background: '#212327' }}>
        <button type="button" className="press" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#cdd2da', fontFamily: "'Inter Tight'", fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 8px 6px 4px' }}><BackChevron />{t('common.back')}</button>
        <span className="selectable" style={{ fontSize: 13, fontWeight: 600, color: '#eef1f5', fontVariantNumeric: 'tabular-nums' }}>{id}.pdf</span>
        <button type="button" className="press" onClick={() => { haptic('tap'); downloadInvoicePdf(id, doc, billToName || billToCompany, billToCompany); }} style={{ border: 'none', borderRadius: 9, background: GRADIENT, color: '#17130F', fontFamily: "'Inter Tight'", fontWeight: 600, fontSize: 13, padding: '8px 13px', cursor: 'pointer' }}>{t('common.download')}</button>
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
  const [errorReason, setErrorReason] = useState('');
  const [preview, setPreview] = useState<RegistrationPreview | null>(null);
  const [registration, setRegistration] = useState<RegistrationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [profileOpen, setProfileOpen] = useState(false);
  const [service, setService] = useState<ServiceKey | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // fleet
  const [fleetCards, setFleetCards] = useState<FleetCard[]>([]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState('');
  const fleetLoaded = useRef(false);

  const session = sessionFrom(registration);
  const company = registration?.companyName ?? preview?.companyName ?? '';
  const roleLabel = t(session.role === 'fleet-manager' ? 'role.fleet' : session.role === 'owner-operator' ? 'role.owner' : 'role.driver');

  useEffect(() => {
    wa?.ready();
    wa?.expand();
    initTheme();
    const id = getRegistrationId();
    if (!id) {
      setErrorReason(t('error.reason'));
      setScreen('error');
      return;
    }
    fetchRegistrationPreview(id)
      .then((res) => {
        if (res.status === 'redeemed') {
          setPreview({ id, profile: 'owner', companyName: res.companyName, companyType: null, cardCount: null });
          setScreen('already');
        } else {
          setPreview(res.invite);
          setScreen('confirm');
        }
      })
      .catch((e) => {
        setErrorReason(e instanceof ApiError ? e.message : t('error.reason'));
        setScreen('error');
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
      setErrorReason('Open this link inside Telegram to register.');
      setScreen('error');
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
        setErrorReason(e instanceof ApiError ? e.message : t('error.reason'));
        setScreen('error');
      })
      .finally(() => setBusy(false));
  }

  function goHome() {
    setService(null);
    setProfileOpen(false);
    setActivities((a) => (a.length ? a : seedActivities(session.isDriver)));
    setScreen('home');
  }

  function openService(key: ServiceKey) {
    haptic('tap');
    setService(key);
    setActivities((a) => logActivity(a.length ? a : seedActivities(session.isDriver), key));
  }

  function viewFleet() {
    setScreen('fleet');
    if (fleetLoaded.current || !wa?.initData) return;
    fleetLoaded.current = true;
    setFleetLoading(true);
    fetchFleet(wa.initData)
      .then((res) => setFleetCards(res.fleet))
      .catch((e) => setFleetError(e instanceof ApiError ? e.message : t('fleet.error')))
      .finally(() => setFleetLoading(false));
  }

  async function createLink(cardId: string, name: string) {
    if (!name || !wa?.initData) {
      haptic('error');
      return;
    }
    try {
      const res = await createDriverInvite(wa.initData, cardId, name);
      haptic('success');
      setFleetCards((cs) => cs.map((c) => (c.cardId === cardId ? { ...c, status: 'pending', driverName: name, link: res.inviteUrl, expiresAt: res.expiresAt } : c)));
    } catch (e) {
      haptic('error');
      setFleetError(e instanceof ApiError ? e.message : t('fleet.error'));
    }
  }

  const signedIn = screen === 'home' || screen === 'fleet';

  return (
    <div className={`app-root ${theme === 'dark' ? 'theme-dark' : ''}`} style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--background)' }}>
      {signedIn && <AppHeader user={user} onOpenProfile={() => { haptic('tap'); setProfileOpen(true); }} />}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'error' && <ErrorScreen reason={errorReason} />}
        {screen === 'confirm' && preview && <ConfirmScreen preview={preview} firstName={firstName} busy={busy} onConfirm={confirm} />}
        {screen === 'success' && <SuccessScreen session={session} company={company} onContinue={goHome} />}
        {screen === 'already' && <AlreadyScreen company={company} onContinue={goHome} />}
        {screen === 'home' && <Home session={session} activities={activities} onOpenService={openService} onViewFleet={viewFleet} />}
        {screen === 'fleet' && <FleetView cards={fleetCards} loading={fleetLoading} error={fleetError} onBack={goHome} onCreate={createLink} onRegenerate={createLink} />}
      </div>

      {profileOpen && <ProfileSheet user={user} company={company} roleLabel={roleLabel} theme={theme} onTheme={chooseTheme} onClose={() => setProfileOpen(false)} />}
      {service && <ActionSheet service={service} session={session} company={company} fullName={fullName} onClose={() => setService(null)} />}
    </div>
  );
}
