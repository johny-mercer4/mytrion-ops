/**
 * Data Center iSoftPull — one bureau per approved, billed pull. Prefill never fires the vendor.
 */
import { useId, useState, type FormEvent } from 'react';
import { Button, ConfirmDialog, Input, Tabs, type TabItem } from '@/ds';
import {
  pullIsoftPull,
  type IsoftpullBureau,
  type IsoftpullPullResult,
} from '@/api/verificationIsoftpull';
import { flattenVendorPayload, isoftpullPrefill, type FmcsaPrefillCase } from './caseDataCenterModel';
import { ExpandRow } from './CaseDataCenterBlacklist';
import { ResultsSkeleton } from './CaseDataCenterVendors';

const BUREAUS: TabItem[] = [
  { value: 'equifax', label: 'Equifax' },
  { value: 'transunion', label: 'TransUnion' },
  { value: 'experian', label: 'Experian' },
];

const BUREAU_LABEL: Record<IsoftpullBureau, string> = {
  equifax: 'Equifax',
  transunion: 'TransUnion',
  experian: 'Experian',
};

export function IsoftpullPanel({ caseRow }: { caseRow?: FmcsaPrefillCase }) {
  const seed = isoftpullPrefill(caseRow ?? {});
  const keysId = useId();
  const [bureau, setBureau] = useState<IsoftpullBureau>('equifax');
  const [firstName, setFirstName] = useState(seed.firstName);
  const [lastName, setLastName] = useState(seed.lastName);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [ssn, setSsn] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IsoftpullPullResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    address.trim() !== '' &&
    city.trim() !== '' &&
    state.trim() !== '' &&
    zip.trim() !== '';

  const ask = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || busy) return;
    setConfirmOpen(true);
  };

  const run = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void pullIsoftPull({
      confirm: true,
      bureau,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      ...(ssn.trim() ? { ssn: ssn.trim() } : {}),
      ...(dateOfBirth.trim() ? { dateOfBirth: dateOfBirth.trim() } : {}),
    })
      .then((next) => {
        setResult(next);
        setConfirmOpen(false);
      })
      .catch((err: unknown) => {
        setResult(null);
        setError(err instanceof Error ? err.message : 'iSoftPull did not answer.');
        setConfirmOpen(false);
      })
      .finally(() => setBusy(false));
  };

  const line =
    error ??
    (result && !result.available ? result.error ?? 'iSoftPull did not answer.' : null);

  return (
    <div className="va-dc-panel">
      <p className="va-dc-meta">One bureau per approved pull. This incurs a charge.</p>
      <form className="va-dc-vendor" onSubmit={ask}>
        <Tabs
          className="va-dc-keys"
          items={BUREAUS}
          value={bureau}
          onValueChange={(next) => setBureau(next as IsoftpullBureau)}
          variant="pill"
          size="sm"
          idBase={keysId}
          aria-label="Bureau"
        />
        <div className="va-dc-fields">
          <label className="va-dc-field">
            <span className="va-dc-field-label">First name</span>
            <Input value={firstName} onChange={(e) => setFirstName(e.currentTarget.value)} aria-label="First name" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">Last name</span>
            <Input value={lastName} onChange={(e) => setLastName(e.currentTarget.value)} aria-label="Last name" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">Address</span>
            <Input value={address} onChange={(e) => setAddress(e.currentTarget.value)} aria-label="Address" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">City</span>
            <Input value={city} onChange={(e) => setCity(e.currentTarget.value)} aria-label="City" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">State</span>
            <Input
              value={state}
              onChange={(e) => setState(e.currentTarget.value)}
              aria-label="State"
              message="Full name (Texas, not TX)."
              autoComplete="off"
              fullWidth
            />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">ZIP</span>
            <Input value={zip} onChange={(e) => setZip(e.currentTarget.value)} aria-label="ZIP" inputMode="numeric" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">SSN</span>
            <Input type="password" value={ssn} onChange={(e) => setSsn(e.currentTarget.value)} aria-label="SSN" autoComplete="off" fullWidth />
          </label>
          <label className="va-dc-field">
            <span className="va-dc-field-label">Date of birth</span>
            <Input
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.currentTarget.value)}
              aria-label="Date of birth"
              message="Optional. MM/DD/YYYY."
              autoComplete="off"
              fullWidth
            />
          </label>
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={!ready}>
          Pull report
        </Button>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={run}
        tone="danger"
        confirming={busy}
        title="Approve iSoftPull charge"
        confirmLabel="Pull and bill"
        body={`iSoftPull · ${BUREAU_LABEL[bureau]} Full Feed · this incurs a charge.`}
      />

      {line ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {line}
        </p>
      ) : null}
      {busy && result === null ? <ResultsSkeleton label="Pulling iSoftPull" /> : null}
      {result?.available && result.data ? (
        <div className="va-dc-list">
          <ExpandRow
            title={`${result.data.bureau} report`}
            facts={[`HTTP ${result.data.httpStatus}`, BUREAU_LABEL[result.data.bureau]]}
            details={flattenVendorPayload(result.data.payload)}
          />
        </div>
      ) : null}
    </div>
  );
}
