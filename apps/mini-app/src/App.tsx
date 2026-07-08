import { useEffect, useState } from 'react';
import {
  ApiError,
  createDriverInvite,
  fetchFleet,
  fetchRegistrationPreview,
  redeemRegistration,
  type FleetCard,
  type FleetSummary,
  type RegistrationPreview,
  type RegistrationView,
} from './lib/api';
import { getRegistrationId, getTelegramWebApp } from './lib/telegram';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardRow } from './components/ui/card';
import { Spinner } from './components/ui/spinner';

type View =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'confirm'; preview: RegistrationPreview }
  | { state: 'already-registered'; companyName: string | null }
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
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Spinner className="text-primary" />
        <p className="text-sm">Checking your registration link…</p>
      </div>
    </Screen>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <Screen>
      <Card className="flex flex-col items-center gap-3 text-center">
        <div className="text-2xl">⚠️</div>
        <h1 className="text-base font-bold">This link isn't valid</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">Contact your Octane rep for a new registration link.</p>
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
      <div className="mb-5 text-center">
        <h1 className="text-lg font-bold">Hi {firstName} 👋</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isDriver ? 'Confirm you drive for:' : "Confirm you're registering:"}
        </p>
      </div>
      <Card className="flex flex-col gap-1">
        <CardRow label="Company" value={preview.companyName ?? '—'} />
        {!isDriver && preview.companyType && (
          <CardRow
            label="Account type"
            value={
              <Badge variant={preview.companyType === 'fleet-manager' ? 'default' : 'secondary'}>
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
        setLink(res.inviteUrl);
        onIssued(card.cardId!, name.trim());
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not create the link.'))
      .finally(() => setBusy(false));
  }

  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Card {card.cardNumber ?? card.cardId ?? '—'}</span>
        <Badge variant={card.status === 'open' ? 'outline' : 'default'}>
          {card.status === 'registered' ? 'Registered' : card.status === 'pending' ? 'Invite sent' : 'No driver'}
        </Badge>
      </div>
      {card.driverName && <p className="mt-1 text-xs text-muted-foreground">Driver: {card.driverName}</p>}

      {card.status === 'open' && !link && (
        <div className="mt-2 flex gap-2">
          <input
            className="h-10 flex-1 rounded-xs border border-border bg-background px-3 text-sm outline-none focus:border-ring"
            placeholder="Driver name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button className="w-auto px-3" size="sm" disabled={busy || !name.trim()} onClick={issue}>
            {busy ? <Spinner className="size-4" /> : 'Create link'}
          </Button>
        </div>
      )}
      {link && (
        <div className="mt-2 flex gap-2">
          <input
            className="h-10 flex-1 rounded-xs border border-border bg-muted px-3 font-mono text-xs outline-none"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            className="w-auto px-3"
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard?.writeText(link)}
          >
            Copy
          </Button>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
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
    <Card className="mt-4 text-left">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-bold">Your fleet</span>
        {cards && (
          <span className="text-xs text-muted-foreground">
            {registered} of {cards.length} registered
          </span>
        )}
      </div>
      {!cards && !err && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-4 text-primary" />
          <span className="text-sm">Loading your cards…</span>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {cards?.length === 0 && <p className="text-sm text-muted-foreground">No active cards found.</p>}
      {cards?.map((c) => (
        <CardRowManager key={c.cardId ?? c.cardNumber} card={c} initData={initData} onIssued={markIssued} />
      ))}
    </Card>
  );
}

function SuccessScreen({
  registration,
  fleet,
  initData,
}: {
  registration: RegistrationView;
  fleet?: FleetSummary;
  initData: string;
}) {
  const isDriver = registration.profile === 'driver';
  const isFleet = registration.profile === 'owner' && registration.companyType === 'fleet-manager';
  return (
    <Screen>
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
    </Screen>
  );
}

function AlreadyRegisteredScreen({ companyName }: { companyName: string | null }) {
  return (
    <Screen>
      <Card className="flex flex-col items-center gap-2 text-center">
        <div className="text-2xl">👍</div>
        <h1 className="text-base font-bold">Already registered</h1>
        <p className="text-sm text-muted-foreground">{companyName ?? 'This company'} was already registered.</p>
      </Card>
    </Screen>
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
    redeemRegistration(preview.id, wa.initData)
      .then((result) => {
        if ('alreadyRegistered' in result) {
          setView({ state: 'already-registered', companyName: result.registration.companyName });
        } else {
          setView({ state: 'success', registration: result.registration, ...(result.fleet ? { fleet: result.fleet } : {}) });
        }
      })
      .catch((e) => {
        setView({ state: 'error', message: e instanceof ApiError ? e.message : 'Registration failed.' });
      })
      .finally(() => setBusy(false));
  }

  if (view.state === 'loading') return <LoadingScreen />;
  if (view.state === 'error') return <ErrorScreen message={view.message} />;
  if (view.state === 'already-registered') return <AlreadyRegisteredScreen companyName={view.companyName} />;
  if (view.state === 'success') {
    return (
      <SuccessScreen
        registration={view.registration}
        initData={wa?.initData ?? ''}
        {...(view.fleet ? { fleet: view.fleet } : {})}
      />
    );
  }
  return <ConfirmScreen preview={view.preview} firstName={firstName} busy={busy} onConfirm={() => confirm(view.preview)} />;
}
