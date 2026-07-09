import { useEffect, useState } from 'react';
import {
  ApiError,
  createDriverInvite,
  fetchFleet,
  fetchRegistrationPreview,
  redeemRegistration,
  type CompanyType,
  type FleetCard,
  type FleetSummary,
  type Profile,
  type RegistrationPreview,
  type RegistrationView,
} from './lib/api';
import {
  getRegistrationId,
  getTelegramWebApp,
  haptic,
  forceLightTheme,
  type TelegramWebAppUser,
} from './lib/telegram';
import { FuelCard } from './components/fuel-card';
import { Logo, LogoLockup } from './components/logo';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardRow } from './components/ui/card';
import { Spinner } from './components/ui/spinner';

type View =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'confirm'; preview: RegistrationPreview }
  | { state: 'already-registered'; companyName: string | null; registration?: RegistrationView }
  | { state: 'success'; registration: RegistrationView; fleet?: FleetSummary };

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <Screen>
      <div className="flex flex-col items-center gap-4">
        <Logo size={56} />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-4 text-primary" />
          <p className="text-sm">Checking your registration link…</p>
        </div>
      </div>
    </Screen>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <Screen>
      <div className="mb-5 flex justify-center">
        <Logo size={48} />
      </div>
      <Card className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-base font-bold">This link isn't valid</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Contact your Octane rep for a new registration link.
        </p>
      </Card>
    </Screen>
  );
}

function ConfirmScreen({
  preview,
  firstName,
  busy,
  onConfirm,
}: {
  preview: RegistrationPreview;
  firstName: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const isDriver = preview.profile === 'driver';
  return (
    <Screen>
      <div className="mb-6 flex flex-col items-center gap-4 text-center">
        <Logo size={64} />
        <div>
          <h1 className="text-lg font-bold">Hi {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isDriver ? 'Confirm you drive for:' : "Confirm you're registering:"}
          </p>
        </div>
      </div>
      <Card className="flex flex-col gap-1">
        <CardRow label="Company" value={preview.companyName ?? '—'} />
        {!isDriver && preview.companyType && (
          <CardRow
            label="Account type"
            // Quiet on purpose: the CTA below is the only thing wearing the brand gradient.
            value={
              <Badge variant="secondary">
                {preview.companyType === 'fleet-manager' ? 'Fleet manager' : 'Owner-operator'}
              </Badge>
            }
          />
        )}
        {isDriver && <CardRow label="Role" value="Driver" />}
      </Card>
      <Button className="mt-5" disabled={busy} onClick={onConfirm}>
        {busy ? <Spinner /> : 'Confirm & Register'}
      </Button>
    </Screen>
  );
}

function CardRowManager({
  card,
  initData,
  onIssued,
}: {
  card: FleetCard;
  initData: string;
  onIssued: (cardId: string, driverName: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');

  function issue() {
    if (!card.cardId || !name.trim()) return;
    setBusy(true);
    setErr('');
    createDriverInvite(initData, card.cardId, name.trim())
      .then((res) => {
        haptic('success');
        setLink(res.inviteUrl);
        onIssued(card.cardId!, name.trim());
      })
      .catch((e) => {
        haptic('error');
        setErr(e instanceof ApiError ? e.message : 'Could not create the link.');
      })
      .finally(() => setBusy(false));
  }

  return (
    <FuelCard
      cardNumber={card.cardNumber}
      cardId={card.cardId}
      cardType={card.cardType}
      driverName={card.driverName}
      status={card.status}
    >
      {card.status === 'open' && !link && (
        <div className="flex flex-col gap-2">
          <input
            className="h-12 w-full rounded-sm border border-border bg-background px-3.5 text-sm outline-none focus:border-ring"
            placeholder="Driver's name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={busy || !name.trim()} onClick={issue}>
            {busy ? <Spinner className="size-4" /> : 'Create driver link'}
          </Button>
        </div>
      )}

      {link && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Send this link to {name || 'your driver'} — it works once.
          </p>
          <div className="flex gap-2">
            <input
              className="h-12 min-w-0 flex-1 rounded-sm border border-border bg-muted px-3.5 font-mono text-xs outline-none"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              className="w-auto px-4"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              Copy
            </Button>
          </div>
        </div>
      )}

      {card.status !== 'open' && !link && (
        <p className="text-xs text-muted-foreground">
          {card.status === 'registered'
            ? 'This driver has signed in on Telegram.'
            : 'Waiting for the driver to open their link.'}
        </p>
      )}

      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </FuelCard>
  );
}

function FleetManager({ initData }: { initData: string }) {
  const [cards, setCards] = useState<FleetCard[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchFleet(initData)
      .then((res) => setCards(res.fleet))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load your fleet.'));
  }, [initData]);

  function markIssued(cardId: string, driverName: string) {
    setCards((prev) =>
      prev
        ? prev.map((c) => (c.cardId === cardId ? { ...c, status: 'pending', driverName } : c))
        : prev,
    );
  }

  const registered = cards?.filter((c) => c.status === 'registered').length ?? 0;
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-bold">Your fleet</h2>
        {cards && cards.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {registered} of {cards.length} registered
          </span>
        )}
      </div>

      {!cards && !err && (
        <div className="flex items-center gap-2 px-1 text-muted-foreground">
          <Spinner className="size-4 text-primary" />
          <span className="text-sm">Loading your cards…</span>
        </div>
      )}
      {err && <p className="px-1 text-sm text-destructive">{err}</p>}
      {cards?.length === 0 && (
        <Card className="text-center">
          <p className="text-sm text-muted-foreground">No active fuel cards on this carrier yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {cards?.map((c) => (
          <CardRowManager key={c.cardId ?? c.cardNumber} card={c} initData={initData} onIssued={markIssued} />
        ))}
      </div>
    </section>
  );
}

/** The three roles the DB records: driver, or an owner split by company type. */
function roleLabel(profile: Profile, companyType: CompanyType | null): string {
  if (profile === 'driver') return 'Driver';
  return companyType === 'fleet-manager' ? 'Fleet manager' : 'Owner-operator';
}

function initialsOf(user: TelegramWebAppUser | undefined): string {
  const letters = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join('');
  return letters || user?.username?.[0]?.toUpperCase() || '?';
}

/**
 * The signed-in header — the mini-app reads identity straight from Telegram (initDataUnsafe), so
 * there's no name/photo to fetch. Sticky, like a native mobile app's title bar.
 */
function Header({
  user,
  role,
  companyName,
}: {
  user: TelegramWebAppUser | undefined;
  role?: string;
  companyName: string | null;
}) {
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Octane user';
  return (
    <header
      className="sticky top-0 z-10 border-b border-border bg-card"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <LogoLockup size={22} />
        {role && <Badge variant="secondary">{role}</Badge>}
      </div>
      <div className="flex items-center gap-3 px-4 pt-3 pb-3">
        <Avatar size="lg">
          {user?.photo_url && <AvatarImage src={user.photo_url} alt={name} />}
          <AvatarFallback>{initialsOf(user)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{companyName ?? 'Octane carrier'}</p>
        </div>
      </div>
    </header>
  );
}

/** Signed-in layout: header pinned, content scrolls under it (no vertical centering). */
function AppShell({
  user,
  role,
  companyName,
  children,
}: {
  user: TelegramWebAppUser | undefined;
  role?: string;
  companyName: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <Header user={user} {...(role ? { role } : {})} companyName={companyName} />
      <main className="mx-auto w-full max-w-sm p-4">{children}</main>
    </div>
  );
}

function SuccessScreen({
  registration,
  fleet,
  initData,
  user,
}: {
  registration: RegistrationView;
  fleet?: FleetSummary;
  initData: string;
  user: TelegramWebAppUser | undefined;
}) {
  const isDriver = registration.profile === 'driver';
  const isFleet = registration.profile === 'owner' && registration.companyType === 'fleet-manager';
  return (
    <AppShell
      user={user}
      role={roleLabel(registration.profile, registration.companyType)}
      companyName={registration.companyName}
    >
      <Card className="flex flex-col items-center gap-2 text-center">
        <div className="text-2xl">✅</div>
        <h1 className="text-base font-bold">You're registered!</h1>
        <p className="text-sm text-muted-foreground">
          {isDriver
            ? `You're linked to ${registration.companyName ?? 'your company'}'s fleet. You'll get updates here in Telegram.`
            : `${registration.companyName ?? 'Your company'} is now registered with Octane.`}
        </p>
      </Card>
      {isFleet ? (
        <FleetManager initData={initData} />
      ) : (
        fleet && (
          <Card className="mt-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Your fleet</span>
              <Badge variant="default">
                {fleet.registeredDrivers} of {fleet.cardCount ?? 0} registered
              </Badge>
            </div>
          </Card>
        )
      )}
    </AppShell>
  );
}

function AlreadyRegisteredScreen({
  companyName,
  user,
  role,
}: {
  companyName: string | null;
  user: TelegramWebAppUser | undefined;
  role?: string;
}) {
  return (
    <AppShell user={user} {...(role ? { role } : {})} companyName={companyName}>
      <Card className="flex flex-col items-center gap-2 text-center">
        <div className="text-2xl">👍</div>
        <h1 className="text-base font-bold">Already registered</h1>
        <p className="text-sm text-muted-foreground">{companyName ?? 'This company'} was already registered.</p>
      </Card>
    </AppShell>
  );
}

export function App() {
  const [view, setView] = useState<View>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const wa = getTelegramWebApp();
  const firstName = wa?.initDataUnsafe.user?.first_name ?? 'there';

  useEffect(() => {
    wa?.ready();
    wa?.expand();
    forceLightTheme();
    const id = getRegistrationId();
    if (!id) {
      setView({ state: 'error', message: 'This link is missing its registration id.' });
      return;
    }
    fetchRegistrationPreview(id)
      .then((result) => {
        if (result.status === 'redeemed') {
          setView({ state: 'already-registered', companyName: result.companyName });
        } else {
          setView({ state: 'confirm', preview: result.invite });
        }
      })
      .catch((e) => {
        setView({ state: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong.' });
      });
    // Registration id comes from the launch context (start_param / ?token=) — read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirm(preview: RegistrationPreview) {
    if (!wa?.initData) {
      setView({ state: 'error', message: 'Open this link inside Telegram to register.' });
      return;
    }
    setBusy(true);
    haptic('tap');
    redeemRegistration(preview.id, wa.initData)
      .then((result) => {
        haptic('success');
        if ('alreadyRegistered' in result) {
          setView({
            state: 'already-registered',
            companyName: result.registration.companyName,
            registration: result.registration,
          });
        } else {
          setView({ state: 'success', registration: result.registration, ...(result.fleet ? { fleet: result.fleet } : {}) });
        }
      })
      .catch((e) => {
        haptic('error');
        setView({ state: 'error', message: e instanceof ApiError ? e.message : 'Registration failed.' });
      })
      .finally(() => setBusy(false));
  }

  const tgUser = wa?.initDataUnsafe.user;

  if (view.state === 'loading') return <LoadingScreen />;
  if (view.state === 'error') return <ErrorScreen message={view.message} />;
  if (view.state === 'already-registered') {
    const reg = view.registration;
    return (
      <AlreadyRegisteredScreen
        companyName={view.companyName}
        user={tgUser}
        {...(reg ? { role: roleLabel(reg.profile, reg.companyType) } : {})}
      />
    );
  }
  if (view.state === 'success') {
    return (
      <SuccessScreen
        registration={view.registration}
        initData={wa?.initData ?? ''}
        user={tgUser}
        {...(view.fleet ? { fleet: view.fleet } : {})}
      />
    );
  }
  return <ConfirmScreen preview={view.preview} firstName={firstName} busy={busy} onConfirm={() => confirm(view.preview)} />;
}
