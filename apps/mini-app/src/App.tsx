import { useEffect, useState } from 'react';
import {
  ApiError,
  fetchRegistrationPreview,
  redeemRegistration,
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

function FleetSummaryCard({ fleet }: { fleet: FleetSummary }) {
  const total = fleet.cardCount ?? 0;
  return (
    <Card className="mt-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Your fleet</span>
        <Badge variant="default">
          {fleet.registeredDrivers} of {total} driver{total === 1 ? '' : 's'} registered
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Send each driver their own registration link to add them to the fleet.
      </p>
    </Card>
  );
}

function SuccessScreen({
  registration,
  fleet,
}: {
  registration: RegistrationView;
  fleet?: FleetSummary;
}) {
  const isDriver = registration.profile === 'driver';
  return (
    <Screen>
      <Card className="flex flex-col items-center gap-2 text-center">
        <div className="text-2xl">✅</div>
        <h1 className="text-base font-bold">You're registered!</h1>
        <p className="text-sm text-muted-foreground">
          {isDriver
            ? `You're linked to ${registration.companyName ?? 'your company'}'s fleet. You'll get updates here in Telegram.`
            : `${registration.companyName ?? 'Your company'} is now registered with Octane. You'll get updates here in Telegram.`}
        </p>
      </Card>
      {fleet && <FleetSummaryCard fleet={fleet} />}
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
    return <SuccessScreen registration={view.registration} {...(view.fleet ? { fleet: view.fleet } : {})} />;
  }
  return <ConfirmScreen preview={view.preview} firstName={firstName} busy={busy} onConfirm={() => confirm(view.preview)} />;
}
