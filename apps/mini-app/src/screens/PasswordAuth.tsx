/**
 * Password set / login / update / forgot screens for password-mode mini-app accounts.
 * Username fields are read-only; only the password is writable.
 */
import { useState, type CSSProperties, type FormEvent } from 'react';
import {
  forgotMiniAppPassword,
  loginMiniApp,
  setMiniAppPassword,
  updateMiniAppPassword,
  type LoginHints,
  type RegistrationView,
} from '../lib/api';
import { EyeToggle } from '../components/icons';
import { LogoLockup } from '../components/logo';
import { useI18n } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Spinner } from '../components/ui/spinner';

type Mode = 'set' | 'login' | 'update' | 'forgot';

const MIN_PASSWORD_LEN = 4;

const CTA_SHADOW = '0 8px 20px color-mix(in srgb, var(--primary) 35%, transparent)';

export function PasswordAuthScreen({
  mode,
  initData,
  hints,
  onAuthed,
  onBack,
  onForgot,
}: {
  mode: Mode;
  initData: string;
  hints: LoginHints;
  registration?: RegistrationView;
  onAuthed: (registration: RegistrationView, hints: LoginHints) => void;
  onBack?: (() => void) | undefined;
  onForgot?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const title =
    mode === 'set'
      ? t('auth.setPasswordTitle')
      : mode === 'login'
        ? t('auth.loginTitle')
        : mode === 'update'
          ? t('auth.updatePasswordTitle')
          : t('auth.forgotTitle');

  const subtitle =
    mode === 'forgot'
      ? t('auth.forgotBody')
      : mode === 'set'
        ? t('auth.setPasswordHint')
        : mode === 'login'
          ? t('auth.loginHint')
          : t('auth.updatePasswordHint');

  const passwordReady =
    mode === 'forgot'
      ? true
      : mode === 'update'
        ? currentPassword.length >= 1 && nextPassword.length >= MIN_PASSWORD_LEN
        : password.length >= MIN_PASSWORD_LEN;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError('');
    setDoneMsg('');

    // Validate in submit (not only via disabled) so Telegram WebView taps always get feedback.
    if (mode !== 'forgot' && !passwordReady) {
      haptic('error');
      setError(t('auth.passwordTooShort'));
      return;
    }

    setBusy(true);
    try {
      if (mode === 'set') {
        const res = await setMiniAppPassword(initData, password);
        haptic('success');
        onAuthed(res.registration, res.loginHints);
        return;
      }
      if (mode === 'login') {
        const res = await loginMiniApp(initData, password);
        haptic('success');
        onAuthed(res.registration, res.loginHints);
        return;
      }
      if (mode === 'update') {
        await updateMiniAppPassword(initData, currentPassword, nextPassword);
        haptic('success');
        setDoneMsg(t('auth.passwordUpdated'));
        setCurrentPassword('');
        setNextPassword('');
        return;
      }
      await forgotMiniAppPassword(initData, note.trim() || undefined);
      haptic('success');
      setDoneMsg(t('auth.forgotSent'));
      setNote('');
    } catch (err) {
      haptic('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field: CSSProperties = {
    width: '100%',
    height: 48,
    padding: '0 14px',
    borderRadius: 14,
    border: '1px solid var(--border)',
    background: 'var(--secondary)',
    color: 'var(--fg)',
    fontFamily: "'Geist'",
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const ctaLabel =
    mode === 'forgot'
      ? t('auth.forgotCta')
      : mode === 'update'
        ? t('auth.updateCta')
        : mode === 'set'
          ? t('auth.setCta')
          : t('auth.loginCta');

  const busyLabel =
    mode === 'login' ? t('auth.loggingIn') : mode === 'forgot' ? t('auth.forgotCta') : t('auth.saving');

  // Standalone auth fills the viewport like Confirm / Error; update stays sheet-like.
  const centered = mode === 'login' || mode === 'set' || mode === 'forgot';

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: centered ? 'center' : 'stretch',
        justifyContent: centered ? 'center' : 'flex-start',
        padding: centered ? 24 : '24px 18px',
        boxSizing: 'border-box',
        minHeight: 0,
      }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: centered ? 'center' : 'stretch',
          gap: centered ? 18 : 14,
          width: '100%',
          maxWidth: 342,
          margin: centered ? undefined : undefined,
          boxSizing: 'border-box',
          animation: centered ? 'octfade .3s ease' : undefined,
        }}
      >
        {centered && <LogoLockup size={40} />}

        <div style={{ textAlign: centered ? 'center' : 'left', width: '100%' }}>
          <div style={{ fontSize: centered ? 23 : 20, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-.01em' }}>
            {title}
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted-fg)', lineHeight: 1.5, marginTop: 6 }}>{subtitle}</div>
        </div>

        <AccountSummary hints={hints} />

        {mode === 'update' && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldLabel text={t('auth.currentPassword')} />
            <PasswordInput
              autoComplete="current-password"
              placeholder={t('auth.currentPassword')}
              value={currentPassword}
              onChange={setCurrentPassword}
              disabled={busy}
              fieldStyle={field}
            />
            <FieldLabel text={t('auth.newPassword')} />
            <PasswordInput
              autoComplete="new-password"
              placeholder={t('auth.newPassword')}
              value={nextPassword}
              onChange={setNextPassword}
              disabled={busy}
              minLength={MIN_PASSWORD_LEN}
              fieldStyle={field}
            />
          </div>
        )}

        {(mode === 'set' || mode === 'login') && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <FieldLabel text={t('auth.passwordLabel')} />
            <PasswordInput
              autoComplete={mode === 'set' ? 'new-password' : 'current-password'}
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (error) setError('');
              }}
              disabled={busy}
              minLength={MIN_PASSWORD_LEN}
              fieldStyle={field}
            />
            {password.length > 0 && password.length < MIN_PASSWORD_LEN && (
              <div style={{ fontSize: 12, color: 'var(--muted-fg)' }}>
                {t('auth.passwordTooShort')} ({password.length}/{MIN_PASSWORD_LEN})
              </div>
            )}
          </div>
        )}

        {mode === 'forgot' && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <FieldLabel text={t('auth.forgotNote')} />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder={t('auth.forgotNotePlaceholder')}
              rows={3}
              disabled={busy}
              style={{ ...field, height: 'auto', padding: '12px 14px', resize: 'vertical', fontSize: 14 }}
            />
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              width: '100%',
              fontSize: 13,
              color: 'var(--destructive)',
              fontWeight: 600,
              textAlign: 'center',
              padding: '10px 12px',
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
            }}
          >
            {error}
          </div>
        )}
        {doneMsg && (
          <div
            role="status"
            style={{
              width: '100%',
              fontSize: 13,
              color: 'var(--success)',
              fontWeight: 600,
              textAlign: 'center',
              padding: '10px 12px',
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--success) 12%, transparent)',
            }}
          >
            {doneMsg}
          </div>
        )}

        <button
          type="submit"
          className="press"
          disabled={busy}
          aria-busy={busy}
          onClick={() => haptic('tap')}
          style={{
            width: '100%',
            height: 52,
            border: 'none',
            borderRadius: 14,
            background: 'var(--primary)',
            color: '#fff',
            fontFamily: "'Geist'",
            fontWeight: 600,
            fontSize: 15,
            opacity: busy || !passwordReady ? 0.55 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            cursor: busy ? 'wait' : 'pointer',
            boxShadow: busy || !passwordReady ? 'none' : CTA_SHADOW,
          }}
        >
          {busy ? (
            <>
              <Spinner className="size-[18px] text-white" />
              <span>{busyLabel}</span>
            </>
          ) : (
            ctaLabel
          )}
        </button>

        {mode === 'login' && onForgot && (
          <button
            type="button"
            onClick={() => {
              haptic('tap');
              onForgot();
            }}
            disabled={busy}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--link-accent)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              padding: 6,
            }}
          >
            {t('auth.forgotPassword')}
          </button>
        )}

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--link-accent)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              padding: 6,
            }}
          >
            {t('auth.back')}
          </button>
        )}
      </form>
    </div>
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '.02em' }}>{text}</div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  minLength,
  fieldStyle,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  disabled?: boolean;
  minLength?: number;
  fieldStyle: CSSProperties;
}) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type={revealed ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        minLength={minLength}
        style={{ ...fieldStyle, paddingRight: 46 }}
      />
      <button
        type="button"
        className="press"
        tabIndex={-1}
        disabled={disabled}
        aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={revealed}
        onClick={() => {
          haptic('tap');
          setRevealed((v) => !v);
        }}
        style={{
          position: 'absolute',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 36,
          height: 36,
          border: 'none',
          borderRadius: 10,
          background: 'transparent',
          color: 'var(--muted-fg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          padding: 0,
        }}
      >
        <EyeToggle revealed={revealed} size={18} />
      </button>
    </div>
  );
}

function AccountSummary({ hints }: { hints: LoginHints }) {
  const { t } = useI18n();
  const company = hints.companyName?.trim() || hints.primaryLabel;
  const roleLabel =
    hints.profile === 'driver'
      ? t('role.driver')
      : hints.profile === 'manager'
        ? t('role.manager')
        : t('role.owner');

  const rows: Array<{ label: string; value: string; badge?: boolean }> = [
    { label: t('auth.companyName'), value: company },
    { label: t('confirm.role'), value: roleLabel, badge: true },
  ];
  if (hints.profile === 'driver' && hints.cardLast6) {
    rows.push({ label: t('auth.cardLast6'), value: `•••• ${hints.cardLast6}` });
  }

  return (
    <div
      style={{
        width: '100%',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {rows.map((r, i) => (
        <div key={r.label}>
          {i > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 16px' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted-fg)' }}>{r.label}</span>
            {r.badge ? (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--fg)',
                  padding: '5px 11px',
                  borderRadius: 8,
                  background: 'var(--secondary)',
                }}
              >
                {r.value}
              </span>
            ) : (
              <span className="selectable" style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', textAlign: 'right' }}>
                {r.value}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
