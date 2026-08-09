import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button/Button';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Toast.module.css';

/**
 * `success` / `info` — polite. Announced when the screen reader next pauses.
 * `warning` — polite too, and that is a decision rather than an oversight: a warning describes a
 *   CONDITION ("this account is past due"), not a broken action. Interrupting for it teaches people
 *   to ignore interruptions.
 * `error` — assertive. Something the user asked for did not happen.
 */
export type ToastIntent = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  /** The verb — "Undo", "Retry", "Open the ticket". Not "OK": a toast with an OK button is a dialog. */
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** WHAT HAPPENED, one line. "Money code issued", "Couldn't save the note". */
  title: ReactNode;
  /** The detail that makes the title actionable — an id, a count, the reason it failed. Optional. */
  description?: ReactNode | undefined;
  /** Defaults to `info`. Chooses the live region as well as the colour — see `ToastIntent`. */
  intent?: ToastIntent | undefined;
  /**
   * Auto-dismiss delay in ms, or `null` to make it sticky. Defaults per intent (success 4s, info 5s,
   * warning 8s).
   *
   * IGNORED FOR `error`, always. An error that removes itself is an error nobody read, and the one
   * thing worse than a failure is a failure the operator only half saw.
   */
  duration?: number | null | undefined;
  /** One action, at most. Running it also dismisses the toast — the toast has done its job. */
  action?: ToastAction | undefined;
  /** Accessible name of the dismiss button. Defaults to the provider's `dismissLabel`. */
  dismissLabel?: string | undefined;
  /**
   * A stable id. Calling `toast()` again with the same id REPLACES that toast in place and restarts
   * its timer, rather than stacking a duplicate — which is what you want for "Saving…" → "Saved",
   * or for a poll that keeps reporting the same connection failure.
   */
  id?: string | undefined;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  /** Dismisses one toast by id. Unknown ids are a no-op, so a late callback is harmless. */
  dismiss: (id: string) => void;
  /** Dismisses everything. For a route change, or the "Dismiss all" affordance on the overflow row. */
  dismissAll: () => void;
}

interface IntentPresentation {
  icon: IconName;
  /** Announced with the glyph, so the intent is not carried by colour alone. */
  label: string;
  /** Assertive intents land in the `role="alert"` region; the rest in `role="status"`. */
  assertive: boolean;
  duration: number | null;
}

const INTENT: Record<ToastIntent, IntentPresentation> = {
  success: { icon: 'check_circle', label: 'Success', assertive: false, duration: 4000 },
  info: { icon: 'info', label: 'Info', assertive: false, duration: 5000 },
  warning: { icon: 'warning', label: 'Warning', assertive: false, duration: 8000 },
  error: { icon: 'error', label: 'Error', assertive: true, duration: null },
};

/**
 * How long the exit animation is given before the node is unmounted. It mirrors `--dur-slow`, the
 * 220ms motion ceiling, and is duplicated here on purpose: `animationend` does not fire reliably
 * for a zero-duration animation, and every animation in this app is zero-duration under
 * `prefers-reduced-motion`. A timer is the one removal path that behaves the same in both.
 */
const EXIT_MS = 220;

interface ToastRecord {
  id: string;
  /**
   * Bumped on every `toast()` call, including a replacement under an existing id. The auto-dismiss
   * timer is keyed on `id#seq`, which is what makes a replacement restart its clock instead of
   * inheriting the remaining time of the message it replaced.
   */
  seq: number;
  intent: ToastIntent;
  title: ReactNode;
  /* These four are `| undefined` rather than optional: under `exactOptionalPropertyTypes` an
     optional property will not accept an explicitly-undefined value, and every one of them is
     built from an optional prop that may legitimately be undefined. */
  description: ReactNode | undefined;
  action: ToastAction | undefined;
  duration: number | null;
  dismissLabel: string;
  /** Playing its exit animation. Still mounted, still occupying its row, no longer on a timer. */
  exiting: boolean;
}

interface TimerRecord {
  /** Milliseconds left when the clock was last stopped. */
  remaining: number;
  /** `Date.now()` when the current run started; 0 when it has never run. */
  startedAt: number;
  handle: ReturnType<typeof setTimeout> | undefined;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children?: ReactNode | undefined;
  /**
   * How many toasts are on screen at once. Defaults to 3. Beyond it the OLDEST collapse into a
   * "+N earlier" row, and their auto-dismiss clocks do not run while they are hidden — a toast that
   * expires without ever being visible is a message that was never delivered.
   */
  max?: number | undefined;
  /** Default accessible name for every dismiss button. Per-toast `dismissLabel` overrides it. */
  dismissLabel?: string | undefined;
  /** Label for the "Dismiss all" button on the overflow row. */
  dismissAllLabel?: string | undefined;
  /** Positioning class — lands on the viewport, for the rare surface that needs it elsewhere. */
  className?: string | undefined;
  /** Positioning style — lands on the viewport, same reason. */
  style?: CSSProperties | undefined;
}

/**
 * The one toast system. Provider owns the regions; `useToast()` is how anything else speaks.
 *
 * Replaces FOUR parallel implementations — `sonner`, plus three bespoke ones — which between them
 * shipped four different z-indexes, three different dismiss behaviours, and (in all three bespoke
 * ones) a single `aria-live="polite"` region that announced errors quietly and successes rudely.
 *
 * TWO REGIONS, AND THE INTENT PICKS ONE.
 *   `role="status"` / `aria-live="polite"`     success, info, warning
 *   `role="alert"`  / `aria-live="assertive"`  error
 * This is the part every hand-rolled toaster gets wrong, in one of two directions. A POLITE ERROR
 * is an error nobody hears: it queues behind whatever the screen reader is reading, and by the time
 * it is spoken the toast has often already gone. An ASSERTIVE SUCCESS is worse in aggregate — it
 * cuts off the sentence the user was listening to in order to say "Saved", and a user interrupted
 * for nothing four times learns to tune the whole channel out. Two regions cost one extra div.
 *
 * BOTH REGIONS ARE MOUNTED FROM THE START, empty, and stay mounted. A live region that is inserted
 * into the DOM at the same moment as its content is frequently not announced at all — the assistive
 * technology has to be watching the node before the mutation happens. This is why the provider
 * portals an empty viewport rather than mounting one on the first toast.
 *
 * AUTO-DISMISS PAUSES ON HOVER AND ON FOCUS-WITHIN. A toast that vanishes while you are reaching
 * for its "Undo" is not a timing quirk, it is the component destroying the only affordance it
 * offered. Pausing is region-wide rather than per-toast: pausing only the one under the cursor
 * while its neighbours slide out from under it is a worse version of the same bug. Errors never
 * auto-dismiss at all, whatever `duration` says.
 *
 * NO GLASS, deliberately, even though a toast is floating chrome and chrome is where glass belongs.
 * A toast translates on entry and exit, and `backdrop-filter` on a moving element is exactly the
 * composited-layer combination that shipped the un-repainted-panel defect in this app. The surface
 * is opaque instead, which also means the copy keeps a known contrast ratio over whatever it covers.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   reaches the action and dismiss buttons in DOM order. Focus is not moved TO a
 *                     toast when it appears — stealing the caret mid-typing to announce "Saved" is
 *                     how you make people lose a sentence.
 *   Escape            dismisses the toast that currently holds focus, and only that one.
 *   Enter / Space     activate the focused button, natively.
 * Focus never leaves a dismissed toast stranded: the node stays mounted for its exit animation, and
 * the browser moves focus to the document as usual once it is gone.
 *
 * WHEN NOT TO USE IT
 * - Anything the user must acknowledge or act on before continuing. That is a Dialog. A toast that
 *   must not be missed is a design that has already failed — it can be covered, it can be missed by
 *   anyone who looked away, and on a slow render it can be gone before it painted.
 * - A form validation error. It belongs beside the field, where the fix is.
 * - A failed agent turn. That is `TurnError`, inline in the transcript, with the raw message intact.
 * - A page or panel that failed to load. That is `ErrorState`, which occupies the space the content
 *   was going to have rather than floating over it.
 * - Progress. A toast is a moment, not a status; use a progress surface that can be watched.
 * - Anything long enough to read twice. If it does not fit in a title plus one line, it is a panel.
 */
export function ToastProvider({
  children,
  max = 3,
  dismissLabel = 'Dismiss',
  dismissAllLabel = 'Dismiss all',
  className,
  style,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ReadonlyArray<ToastRecord>>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const idCounter = useRef(0);
  const seqCounter = useRef(0);
  /** Auto-dismiss clocks, keyed `id#seq`. */
  const timers = useRef(new Map<string, TimerRecord>());
  /** Exit-animation unmount timers, keyed by toast id. Doubles as the "already exiting" guard. */
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /**
   * The "dismiss all" unmount timer. A stable box holding a mutable handle, rather than a ref
   * holding the handle directly, so the unmount sweep can capture it at effect-setup time — reading
   * `ref.current` inside a cleanup is reading a value that may no longer be the one the effect was
   * set up with.
   */
  const allTimer = useRef<{ handle: ReturnType<typeof setTimeout> | undefined }>({
    handle: undefined,
  });

  // Deferred to an effect rather than read during render, so the provider is safe to render in an
  // environment with no `document` at all — which is the same requirement purity.test.ts enforces
  // for every other primitive here.
  useEffect(() => {
    setHost(document.body);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      // The guard is the timer map, not the record's `exiting` flag: reading state here would mean
      // reading it inside a setState updater, which React may invoke twice.
      if (exitTimers.current.has(id)) return;
      exitTimers.current.set(
        id,
        setTimeout(() => {
          exitTimers.current.delete(id);
          remove(id);
        }, EXIT_MS),
      );
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    },
    [remove],
  );

  const dismissAll = useCallback(() => {
    for (const handle of exitTimers.current.values()) clearTimeout(handle);
    exitTimers.current.clear();
    const box = allTimer.current;
    if (box.handle !== undefined) clearTimeout(box.handle);
    setToasts((prev) => prev.map((t) => ({ ...t, exiting: true })));
    box.handle = setTimeout(() => {
      // Filtered, not emptied: a toast raised during the exit animation has not been dismissed and
      // must survive this sweep.
      setToasts((prev) => prev.filter((t) => !t.exiting));
    }, EXIT_MS);
  }, []);

  const toast = useCallback((options: ToastOptions): string => {
    const intent = options.intent ?? 'info';
    const preset = INTENT[intent];
    idCounter.current += 1;
    seqCounter.current += 1;
    const id = options.id ?? `ds-toast-${idCounter.current}`;

    // Re-raising an id that is mid-exit cancels the exit; the message is current again.
    const pendingExit = exitTimers.current.get(id);
    if (pendingExit !== undefined) {
      clearTimeout(pendingExit);
      exitTimers.current.delete(id);
    }

    const record: ToastRecord = {
      id,
      seq: seqCounter.current,
      intent,
      title: options.title,
      description: options.description,
      action: options.action,
      // The one place `duration` is decided. An error is sticky no matter what the caller passed —
      // see ToastOptions.duration. `=== undefined` and not `??`, because an explicit `null` means
      // "sticky" and `??` would silently swap it for the intent's default.
      duration:
        intent === 'error'
          ? null
          : options.duration === undefined
            ? preset.duration
            : options.duration,
      dismissLabel: options.dismissLabel ?? dismissLabel,
      exiting: false,
    };

    setToasts((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      if (index === -1) return [...prev, record];
      const next = prev.slice();
      // Replace in place: an updating toast should not jump to the bottom of the stack under the
      // cursor of someone already reading it.
      next[index] = record;
      return next;
    });

    return id;
  }, [dismissLabel]);

  /**
   * The newest `max` are on screen; anything older collapses into the overflow row. Newest-wins
   * because the newest toast is the one describing what the user just did — an ops tool that hides
   * the result of the last action behind five stale ones is telling the wrong story.
   */
  const visible = useMemo(
    () => (toasts.length <= max ? toasts : toasts.slice(toasts.length - max)),
    [toasts, max],
  );
  const hiddenCount = toasts.length - visible.length;
  const paused = hovered || focused;

  // ── Auto-dismiss clocks ───────────────────────────────────────────────────────────────────
  // One effect owns every timer. It is idempotent: each run stops whatever is running, banks the
  // elapsed time against `remaining`, and restarts only if nothing is paused — so re-running it for
  // an unrelated re-render costs a rescheduled timeout and nothing else.
  useEffect(() => {
    const store = timers.current;
    const live = new Set<string>();
    const now = Date.now();

    for (const t of visible) {
      if (t.duration === null || t.exiting) continue;
      const key = `${t.id}#${t.seq}`;
      live.add(key);

      let record = store.get(key);
      if (!record) {
        record = { remaining: t.duration, startedAt: 0, handle: undefined };
        store.set(key, record);
      }

      if (record.handle !== undefined) {
        clearTimeout(record.handle);
        record.handle = undefined;
        if (record.startedAt !== 0) {
          record.remaining = Math.max(0, record.remaining - (now - record.startedAt));
        }
      }

      if (!paused) {
        const target = t.id;
        record.startedAt = now;
        record.handle = setTimeout(() => dismiss(target), record.remaining);
      }
    }

    // Anything no longer visible (dismissed, replaced, or pushed into the overflow) loses its clock
    // entirely — that is the "hidden toasts do not expire unseen" rule, implemented by deletion
    // rather than by a flag.
    for (const [key, record] of store) {
      if (live.has(key)) continue;
      if (record.handle !== undefined) clearTimeout(record.handle);
      store.delete(key);
    }
  }, [visible, paused, dismiss]);

  // Unmount sweep. The maps are captured at setup rather than read in the cleanup, because a ref's
  // `.current` at cleanup time is not guaranteed to be the object the effect was set up with.
  useEffect(() => {
    const clocks = timers.current;
    const exits = exitTimers.current;
    const box = allTimer.current;
    return () => {
      for (const record of clocks.values()) {
        if (record.handle !== undefined) clearTimeout(record.handle);
      }
      clocks.clear();
      for (const handle of exits.values()) clearTimeout(handle);
      exits.clear();
      if (box.handle !== undefined) clearTimeout(box.handle);
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  const renderToast = (record: ToastRecord) => {
    const presentation = INTENT[record.intent];
    return (
      <div
        key={record.id}
        className={styles.toast}
        data-intent={record.intent}
        data-state={record.exiting ? 'exit' : 'enter'}
        // Escape closes the toast the user is inside, and stops there: an Escape anywhere else on
        // the page belongs to the dialog, menu or field that owns it.
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          dismiss(record.id);
        }}
      >
        <span className={styles.glyph}>
          {/* Labelled: the glyph is the non-colour signal for the intent, and in the assertive
              region it is also the only thing that distinguishes "Error" from any other alert. */}
          <Icon name={presentation.icon} size="sm" label={presentation.label} />
        </span>

        <div className={styles.body}>
          <p className={styles.title}>{record.title}</p>
          {record.description ? <p className={styles.description}>{record.description}</p> : null}
          {record.action ? (
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  record.action?.onClick();
                  // Acting on a toast resolves it. Leaving it up invites a second click on an
                  // "Undo" that has already run.
                  dismiss(record.id);
                }}
              >
                {record.action.label}
              </Button>
            </div>
          ) : null}
        </div>

        <Button
          className={styles.dismiss}
          size="sm"
          variant="ghost"
          icon="close"
          aria-label={record.dismissLabel}
          onClick={() => dismiss(record.id)}
        />
      </div>
    );
  };

  const assertive = visible.filter((t) => INTENT[t.intent].assertive);
  const polite = visible.filter((t) => !INTENT[t.intent].assertive);

  const viewport = (
    <div
      className={[styles.viewport, className].filter(Boolean).join(' ')}
      style={style}
      data-paused={paused || undefined}
      data-empty={toasts.length === 0 || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Tabbing from a toast's action to its dismiss button fires blur then focus. Without this
        // check the clocks would restart for one frame in the middle of a keyboard user reaching
        // for the control — which is the exact bug the pause exists to prevent.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setFocused(false);
      }}
    >
      {/* Chrome, not content: deliberately OUTSIDE both live regions, because its count changes on
          every toast and announcing "+2 earlier" after every message is noise. */}
      {hiddenCount > 0 ? (
        <div className={styles.overflow}>
          <span className={styles.overflowCount}>{`+${hiddenCount} earlier`}</span>
          <Button size="sm" variant="ghost" onClick={dismissAll}>
            {dismissAllLabel}
          </Button>
        </div>
      ) : null}

      {/* Errors sit above the polite stack, nearest the top of the group, so a failure is never the
          thing that scrolled off the edge of the viewport. */}
      <div className={styles.region} role="alert" aria-live="assertive" aria-atomic="false">
        {assertive.map(renderToast)}
      </div>
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="false">
        {polite.map(renderToast)}
      </div>
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {host ? createPortal(viewport, host) : null}
    </ToastContext.Provider>
  );
}

/**
 * The handle on the toast system: `toast({...})`, `dismiss(id)`, `dismissAll()`.
 *
 * Throws outside a `ToastProvider`, on purpose. The alternative — a silent no-op — means a
 * confirmation that never appears, in the one code path nobody re-tests, and the failure surfaces
 * as "the save button does nothing" weeks later.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast() must be called inside a <ToastProvider>.');
  }
  return api;
}
