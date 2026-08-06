/**
 * Manual opening-balance entry, by carrier ID (TZ §10.2).
 *
 * Look up a carrier → see its resolved LOC/Prepay type and whatever is already recorded → set an
 * amount and an as-of date for each section that applies to that type → save.
 *
 * Only the sections belonging to the carrier's client type are editable: offering an AR field for a
 * Prepay carrier invites an entry the server would reject, and offering it silently would invite one
 * that is merely meaningless.
 *
 * A carrier that cannot take an opening balance gets an AMBER notice, not a red one — "WEX-Funded
 * carriers are out of scope" and "this carrier has no type set" are facts about the carrier, not
 * failures by the agent. Only a genuine save failure is red. (Tri-state notice: ChaseAddModal's shape.)
 *
 * Each section is its own write, carrying `expectedRevisionId` so a value someone else corrected
 * between load and save 409s instead of being silently overwritten.
 */
import { useEffect, useMemo, useState } from 'react';

import { fetchCarrierOpenings, saveOpeningBalance } from '../../api/billing';
import type { CarrierOpeningsResponse, LedgerSectionId } from '../../api/ledgerTypes';
import { errMsg, fmtMoney, formatYmd, lookupMessage, ymd } from './ledgerModel';

const SECTION_LABELS: Record<LedgerSectionId, string> = {
  'cb-loc': 'Customer Balance (LOC)',
  unbilled: 'Unbilled Transactions',
  ar: 'Accounts Receivable',
  'cb-prepay': 'Customer Balance (Prepay)',
  untopped: 'Un Top-Upped Payments',
};

/** What "positive" means per section — the sign convention, shown where the number is typed. */
const SECTION_HINTS: Record<LedgerSectionId, string> = {
  'cb-loc': 'Positive = funds available on the EFS contract',
  unbilled: 'Positive = incurred but not yet invoiced',
  ar: 'Positive = the carrier owes us',
  'cb-prepay': 'Positive = deposit remaining on the EFS contract',
  untopped: 'Positive = received but not yet loaded to EFS',
};

interface Draft {
  amount: string;
  asOfDate: string;
  revisionId: string | null;
  /** The saved amount, so "changed" is a fact rather than a guess. */
  savedAmount: number | null;
}

type Notice = { kind: 'error' | 'notice' | 'success'; text: string } | null;

export function OpeningManualModal({
  initialCarrierId,
  onClose,
  onSaved,
}: {
  initialCarrierId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [carrierInput, setCarrierInput] = useState(initialCarrierId);
  const [lookup, setLookup] = useState<CarrierOpeningsResponse | null>(null);
  const [looking, setLooking] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<LedgerSectionId, Draft>>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => ymd(new Date()), []);

  /** Esc closes — this modal is opened and closed repeatedly during a migration session. */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Debounced lookup. A 7-digit carrier id is typed a digit at a time; firing per keystroke would
  // send six useless requests and flash six "not found" notices on the way to the real answer.
  useEffect(() => {
    const id = carrierInput.trim();
    if (!id) {
      setLookup(null);
      setNotice(null);
      setDrafts({});
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLooking(true);
      fetchCarrierOpenings(id)
        .then((res) => {
          if (cancelled) return;
          setLookup(res);
          if (!res.found) {
            const msg = lookupMessage(res.reason, id);
            setNotice({ kind: msg.kind, text: msg.text });
            setDrafts({});
            return;
          }
          setNotice(null);
          const next: Partial<Record<LedgerSectionId, Draft>> = {};
          for (const section of res.applicableSections ?? []) {
            const existing = res.openings.find((o) => o.section === section);
            next[section] = {
              amount: existing ? String(existing.amount) : '',
              asOfDate: existing?.asOfDate ?? '',
              revisionId: existing?.id ?? null,
              savedAmount: existing ? existing.amount : null,
            };
          }
          setDrafts(next);
        })
        .catch((e) => {
          if (!cancelled) setNotice({ kind: 'error', text: errMsg(e, 'Lookup failed.') });
        })
        .finally(() => {
          if (!cancelled) setLooking(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [carrierInput]);

  const sections = lookup?.applicableSections ?? [];

  /** A section is submittable only when it has both an amount and an as-of date. */
  const pending = useMemo(
    () =>
      sections.filter((s) => {
        const d = drafts[s];
        if (!d) return false;
        if (d.amount.trim() === '' || !d.asOfDate) return false;
        const n = Number(d.amount);
        if (!Number.isFinite(n)) return false;
        return d.savedAmount === null || n !== d.savedAmount || d.asOfDate !== (lookup?.openings.find((o) => o.section === s)?.asOfDate ?? '');
      }),
    [sections, drafts, lookup],
  );

  const invalid = useMemo(
    () =>
      sections.some((s) => {
        const d = drafts[s];
        if (!d || d.amount.trim() === '') return false;
        return !Number.isFinite(Number(d.amount)) || (d.asOfDate ? d.asOfDate > today : false);
      }),
    [sections, drafts, today],
  );

  function setDraft(section: LedgerSectionId, patch: Partial<Draft>): void {
    setDrafts((d) => {
      const cur = d[section];
      if (!cur) return d;
      return { ...d, [section]: { ...cur, ...patch } };
    });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting || !lookup?.found || pending.length === 0) return;
    setSubmitting(true);
    setNotice(null);

    const failures: string[] = [];
    let saved = 0;
    for (const section of pending) {
      const d = drafts[section];
      if (!d) continue;
      try {
        await saveOpeningBalance({
          carrierId: lookup.carrier?.carrierId ?? carrierInput.trim(),
          section,
          asOfDate: d.asOfDate,
          amount: Number(d.amount),
          expectedRevisionId: d.revisionId,
        });
        saved += 1;
      } catch (err) {
        failures.push(`${SECTION_LABELS[section]}: ${errMsg(err, 'save failed')}`);
      }
    }

    setSubmitting(false);

    if (failures.length === 0) {
      onSaved(
        `Saved ${saved} opening balance${saved === 1 ? '' : 's'} for ${
          lookup.carrier?.companyName || carrierInput.trim()
        }.`,
      );
      onClose();
      return;
    }
    // Partial success: keep the modal open with what failed. Do NOT report success for the whole set.
    setNotice({
      kind: 'error',
      text:
        saved > 0
          ? `Saved ${saved}, but ${failures.length} failed — ${failures.join('; ')}`
          : failures.join('; '),
    });
  }

  const formId = 'lg-manual-form';

  return (
    <div
      className="bm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bm-modal-box" style={{ maxWidth: 640 }}>
        <div className="bm-modal-header">
          <div>
            <h3 className="bm-modal-title">Opening balance</h3>
            <div className="bm-modal-sub">
              Carried forward from CMP — the ledger accumulates from this date
            </div>
          </div>
          <button
            className="bm-modal-close"
            onClick={() => {
              if (!submitting) onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="bm-modal-body">
          <form id={formId} className="chase-form" autoComplete="on" onSubmit={onSubmit}>
            <div className="chase-field">
              <label className="chase-label" htmlFor="lg-carrier">
                Carrier ID <span className="chase-req">required</span>
              </label>
              <input
                id="lg-carrier"
                name="carrierId"
                className="chase-input"
                inputMode="numeric"
                autoComplete="off"
                value={carrierInput}
                placeholder="e.g. 5762018"
                onChange={(e) => setCarrierInput(e.target.value)}
                disabled={submitting}
              />
            </div>

            {looking ? <div className="lg-inline-progress">Looking up carrier…</div> : null}

            {lookup?.found && lookup.carrier ? (
              <>
                <div className="lg-carrier-card">
                  <div className="lg-carrier-name">{lookup.carrier.companyName || '—'}</div>
                  <div className="lg-carrier-meta">
                    <span className={`lg-type-pill lg-type-${lookup.carrier.clientType.toLowerCase()}`}>
                      {lookup.carrier.clientType}
                    </span>
                    {lookup.carrier.typeSource === 'override' ? (
                      <span className="lg-override-tag" title="Set by a billing agent, not the data warehouse">
                        override
                      </span>
                    ) : null}
                    {lookup.carrier.billingCycle ? (
                      <span className="lg-cycle-tag">{lookup.carrier.billingCycle}</span>
                    ) : null}
                    {!lookup.carrier.isActive ? <span className="lg-inactive-tag">inactive</span> : null}
                  </div>
                </div>

                <div className="lg-openings-grid">
                  {sections.map((section) => {
                    const d = drafts[section];
                    if (!d) return null;
                    const changed =
                      d.savedAmount !== null &&
                      d.amount.trim() !== '' &&
                      Number(d.amount) !== d.savedAmount;
                    return (
                      <div className="lg-opening-field" key={section}>
                        <label className="chase-label" htmlFor={`lg-amt-${section}`}>
                          {SECTION_LABELS[section]}
                          {d.savedAmount !== null ? (
                            <span className="lg-saved-tag">
                              saved {fmtMoney(d.savedAmount)}
                              {d.asOfDate ? ` · ${formatYmd(d.asOfDate)}` : ''}
                            </span>
                          ) : (
                            <span className="chase-opt">not set</span>
                          )}
                        </label>
                        <div className="chase-row-2">
                          <input
                            id={`lg-amt-${section}`}
                            className="chase-input"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={d.amount}
                            onChange={(e) => setDraft(section, { amount: e.target.value })}
                            disabled={submitting}
                            aria-label={`${SECTION_LABELS[section]} amount`}
                          />
                          <input
                            type="date"
                            className="chase-input"
                            value={d.asOfDate}
                            max={today}
                            onChange={(e) => setDraft(section, { asOfDate: e.target.value })}
                            disabled={submitting}
                            aria-label={`${SECTION_LABELS[section]} as-of date`}
                          />
                        </div>
                        <div className="lg-field-hint">
                          {SECTION_HINTS[section]}
                          {changed ? <span className="lg-changed-tag">will overwrite</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {notice ? (
              <div
                className={`bm-notice bm-notice--${notice.kind === 'error' ? 'error' : notice.kind === 'notice' ? 'duplicate' : 'ok'}`}
                role={notice.kind === 'error' ? 'alert' : 'status'}
              >
                <div className="bm-notice-msg">{notice.text}</div>
              </div>
            ) : null}
          </form>
        </div>

        <div className="bm-modal-footer">
          <span className="lg-footer-note">
            {pending.length > 0
              ? `${pending.length} section${pending.length === 1 ? '' : 's'} to save`
              : 'Enter an amount and an as-of date'}
          </span>
          <button
            type="button"
            className="bm-btn bm-btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="bm-btn bm-btn-primary"
            disabled={submitting || pending.length === 0 || invalid}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
