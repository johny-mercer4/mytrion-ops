import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeDollarSign,
  Building2,
  Check,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  resetLoyaltyOverride,
  saveLoyaltyOverride,
  type LoyaltyClient,
  type LoyaltyClientOverride,
  type LoyaltyEnterpriseMode,
  type LoyaltyRewardId,
} from '../../../api/loyalty';
import {
  tierBucketLabel,
  tierBucketOf,
  tierRewards,
  trackCaption,
  type TierResult,
} from '../../_shared/loyalty';
import '../loyaltyBonusModal.css';

interface Props {
  client: LoyaltyClient;
  tier: TierResult;
  onClose: () => void;
  onSaved: (override: LoyaltyClientOverride | null) => void;
}

const gallons = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function LoyaltyBonusModal({ client, tier, onClose, onSaved }: Props) {
  const automaticIds = useMemo(
    () =>
      tierRewards(tier.level)
        .filter((reward) => reward.active)
        .map((reward) => reward.id),
    [tier.level],
  );
  const existing = client.loyaltyOverride;
  const [customRewards, setCustomRewards] = useState(existing?.enabledRewardIds !== null);
  const [selected, setSelected] = useState<LoyaltyRewardId[]>(
    existing?.enabledRewardIds ?? automaticIds,
  );
  const [enterpriseMode, setEnterpriseMode] = useState<LoyaltyEnterpriseMode | null>(
    existing?.enterpriseMode ?? null,
  );
  const [target, setTarget] = useState(existing?.enterpriseGoldTargetGallons?.toString() ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const rewards = tierRewards(tier.level, customRewards ? selected : null);
  const isEnterprise = tier.track === 'enterprise';

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toggleReward = (id: LoyaltyRewardId): void => {
    setCustomRewards(true);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const useAutomaticRewards = (): void => {
    setCustomRewards(false);
    setSelected(automaticIds);
  };

  const save = async (): Promise<void> => {
    const targetNumber = target.trim() ? Number(target) : null;
    if (
      isEnterprise &&
      enterpriseMode === 'volume_target' &&
      (!targetNumber || targetNumber <= 0)
    ) {
      setError('Enter a positive Enterprise Gold gallon target.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      const result = await saveLoyaltyOverride(client.carrierId, {
        companyName: client.companyName,
        enterpriseMode: isEnterprise ? enterpriseMode : null,
        enterpriseGoldTargetGallons:
          isEnterprise && enterpriseMode === 'volume_target' ? targetNumber : null,
        enabledRewardIds: customRewards ? selected : null,
        note: note.trim() || null,
      });
      onSaved(result.override);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the loyalty override.');
    } finally {
      setBusy(null);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy('reset');
    setError('');
    try {
      await resetLoyaltyOverride(client.carrierId);
      onSaved(null);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reset the loyalty override.');
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="mg-root mg-lty mg-lty-modal-scope" data-mytrion="manager">
      <div
        className="mg-lty-modal-scrim"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <section
          className="mg-lty-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mg-loyalty-modal-title"
        >
          <header className="mg-lty-modal-head">
            <span className="mg-lty-modal-icon">
              <Settings2 size={20} />
            </span>
            <div>
              <span>Client loyalty controls</span>
              <h2 id="mg-loyalty-modal-title">{client.companyName}</h2>
              <p>
                Carrier #{client.carrierId} · {trackCaption(tier)}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close loyalty controls"
            >
              <X size={18} />
            </button>
          </header>

          <div className="mg-lty-modal-body">
            <section className="mg-lty-modal-summary">
              <div>
                <span>
                  <ShieldCheck size={15} /> Active status
                </span>
                <strong>{tierBucketLabel(tierBucketOf(tier))}</strong>
              </div>
              <div>
                <span>
                  <BadgeDollarSign size={15} /> Tier gallons
                </span>
                <strong>{gallons.format(client.inNetworkGallonsPrevMonth)} gal</strong>
              </div>
              <div>
                <span>
                  <Building2 size={15} /> Transacting cards
                </span>
                <strong>{client.activeCardsPrevMonth}</strong>
              </div>
            </section>

            {isEnterprise ? (
              <section className="mg-lty-modal-section">
                <div className="mg-lty-modal-section-head">
                  <div>
                    <span>Enterprise evaluation</span>
                    <h3>Choose how this carrier qualifies</h3>
                  </div>
                </div>
                <div className="mg-lty-enterprise-options">
                  <button
                    type="button"
                    aria-pressed={enterpriseMode === 'normal_billing'}
                    onClick={() => setEnterpriseMode('normal_billing')}
                  >
                    <strong>Normal billing</strong>
                    <span>No gallon tier; terms depend on timely invoice payment.</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={enterpriseMode === 'volume_target'}
                    onClick={() => setEnterpriseMode('volume_target')}
                  >
                    <strong>Volume-based Gold</strong>
                    <span>Gold activates only after the full manual target is reached.</span>
                  </button>
                </div>
                {enterpriseMode === 'volume_target' ? (
                  <label className="mg-lty-target">
                    <span>Gold target · ULSR + ULSD gallons</span>
                    <input
                      type="number"
                      min="1"
                      step="100"
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                      placeholder="Example: 23000"
                    />
                  </label>
                ) : null}
              </section>
            ) : null}

            <section className="mg-lty-modal-section">
              <div className="mg-lty-modal-section-head">
                <div>
                  <span>Benefit month controls</span>
                  <h3>Rewards and bonuses</h3>
                </div>
                <button type="button" onClick={useAutomaticRewards} disabled={!customRewards}>
                  <RotateCcw size={14} /> Use tier defaults
                </button>
              </div>
              <p className="mg-lty-modal-help">
                The checked benefits are active for this client. Changing any checkbox creates a
                documented client-specific exception; it does not change the tier thresholds.
              </p>
              <div className="mg-lty-reward-grid">
                {rewards.map((reward) => (
                  <label key={reward.id} className={reward.active ? 'is-checked' : ''}>
                    <input
                      type="checkbox"
                      checked={reward.active}
                      onChange={() => toggleReward(reward.id)}
                    />
                    <span className="mg-lty-check">
                      <Check size={13} />
                    </span>
                    <span>
                      <strong>{reward.title}</strong>
                      <small>{reward.desc}</small>
                    </span>
                    <em>{reward.value}</em>
                  </label>
                ))}
              </div>
              <label className="mg-lty-note">
                <span>Manager note</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  placeholder="Why is this client different from the standard tier program?"
                />
              </label>
            </section>

            {error ? <div className="mg-lty-modal-error">{error}</div> : null}
          </div>

          <footer className="mg-lty-modal-foot">
            <button
              type="button"
              className="is-reset"
              onClick={() => void reset()}
              disabled={busy !== null || !existing}
            >
              <RotateCcw size={15} /> {busy === 'reset' ? 'Resetting…' : 'Reset all overrides'}
            </button>
            <span />
            <button type="button" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void save()}
              disabled={busy !== null}
            >
              <Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save controls'}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
