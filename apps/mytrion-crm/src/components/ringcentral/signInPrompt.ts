/**
 * When may we tell the agent "Phone not signed in"?
 *
 * Pulled out of RingCentralPhone as a pure function because the bug it fixes was entirely in this
 * decision, and it is timing-sensitive enough to deserve tests rather than a manual re-read.
 *
 * Two rules, both learned the hard way:
 *   1. UNKNOWN IS NOT SIGNED OUT. `ringCentralLoginState()` is null until the vendor iframe reports,
 *      which is after a config fetch, an adapter script load, an iframe handshake (up to
 *      FRAME_WAIT_MS = 12s) and an async session restore — and it drops back to null on every hop
 *      out of Sales/CS, which tears the iframe down. Treating null as signed-out is what showed the
 *      card to agents who were signed in the whole time.
 *   2. SIGNED OUT MUST HOLD. Embeddable reports `loggedIn:false` first and flips to true once the
 *      persisted session comes back, so a single false is a flap, not a verdict.
 *
 * Because the caller re-runs this on a timer, the card also RETRACTS itself: the moment a session is
 * reported, `show` goes false again instead of latching until the next remount.
 */

export interface SignInPromptState {
  /** Epoch ms of the first report in the current uninterrupted signed-out run; null when not in one. */
  signedOutSince: number | null;
  /** Agent closed the card, or opened the login screen themselves — stay quiet until a session lands. */
  muted: boolean;
}

export interface SignInPromptInput extends SignInPromptState {
  /** Widget-reported login state; null when the widget has not reported yet. */
  state: boolean | null;
  now: number;
  /** How long a signed-out report must hold before it is believed (SIGNED_OUT_CONFIRM_MS). */
  confirmMs: number;
}

export interface SignInPromptDecision extends SignInPromptState {
  /** Whether the "Phone not signed in" card should be visible right now. */
  show: boolean;
}

export function nextSignInPrompt(input: SignInPromptInput): SignInPromptDecision {
  const { state, signedOutSince, muted, now, confirmMs } = input;

  // A live session: hide, and un-mute so a genuine later logout is still allowed to prompt.
  if (state === true) return { show: false, signedOutSince: null, muted: false };

  // Not reported yet / torn down. Silence, and the clock restarts when reports resume.
  if (state === null) return { show: false, signedOutSince: null, muted };

  const since = signedOutSince ?? now;
  const held = now - since >= confirmMs;
  return { show: held && !muted, signedOutSince: since, muted };
}
