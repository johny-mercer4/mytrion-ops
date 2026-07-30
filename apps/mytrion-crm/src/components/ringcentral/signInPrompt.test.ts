/**
 * The "Phone not signed in" card kept appearing to agents who WERE signed in, so the rules it now
 * follows are pinned here: unknown never prompts, a signed-out report has to hold, a returning
 * session retracts the card, and closing it stays closed until a session actually lands.
 */
import { describe, expect, it } from 'vitest';
import { nextSignInPrompt, type SignInPromptState } from './signInPrompt';

const CONFIRM_MS = 6000;
const T0 = 1_700_000_000_000;

/** Feed a sequence of (state, elapsed-ms) samples through the reducer, as the poll timer does. */
function run(
  samples: { state: boolean | null; at: number }[],
  start: SignInPromptState = { signedOutSince: null, muted: false },
) {
  let carried = start;
  let show = false;
  for (const sample of samples) {
    const next = nextSignInPrompt({
      state: sample.state,
      now: T0 + sample.at,
      confirmMs: CONFIRM_MS,
      ...carried,
    });
    carried = { signedOutSince: next.signedOutSince, muted: next.muted };
    show = next.show;
  }
  return { show, ...carried };
}

describe('nextSignInPrompt', () => {
  it('never prompts while the widget has not reported (the old 7s-timer false alarm)', () => {
    // A slow boot: the adapter alone gets up to 12s to produce its iframe, so `null` can outlast any
    // fixed deadline. Sampling for a full minute must still say nothing.
    const samples = Array.from({ length: 40 }, (_, i) => ({ state: null, at: i * 1500 }));
    expect(run(samples).show).toBe(false);
  });

  it('does not prompt on a single signed-out report', () => {
    expect(run([{ state: false, at: 0 }]).show).toBe(false);
  });

  it('does not prompt while the signed-out run is younger than the confirm window', () => {
    expect(run([
      { state: false, at: 0 },
      { state: false, at: CONFIRM_MS - 1 },
    ]).show).toBe(false);
  });

  it('prompts once signed-out has held for the confirm window', () => {
    expect(run([
      { state: false, at: 0 },
      { state: false, at: CONFIRM_MS },
    ]).show).toBe(true);
  });

  it('stays silent through the boot flap (false → true during session restore)', () => {
    expect(run([
      { state: false, at: 0 },
      { state: false, at: 2000 },
      { state: true, at: 4000 },
      { state: true, at: 20_000 },
    ]).show).toBe(false);
  });

  it('retracts the card when a session comes back, instead of latching', () => {
    const shown = run([
      { state: false, at: 0 },
      { state: false, at: CONFIRM_MS },
    ]);
    expect(shown.show).toBe(true);
    const recovered = nextSignInPrompt({
      state: true,
      now: T0 + CONFIRM_MS + 1500,
      confirmMs: CONFIRM_MS,
      ...shown,
    });
    expect(recovered.show).toBe(false);
  });

  it('restarts the clock after a hop out of Sales/CS wipes the cached state', () => {
    // false held → shown; teardown (null) → hidden; reports resume → must re-earn the confirm window.
    const afterTeardown = run([
      { state: false, at: 0 },
      { state: false, at: CONFIRM_MS },
      { state: null, at: CONFIRM_MS + 1500 },
      { state: false, at: CONFIRM_MS + 3000 },
    ]);
    expect(afterTeardown.show).toBe(false);
    expect(afterTeardown.signedOutSince).toBe(T0 + CONFIRM_MS + 3000);
  });

  it('stays closed once dismissed, however long signed-out holds', () => {
    const muted: SignInPromptState = { signedOutSince: null, muted: true };
    expect(run([
      { state: false, at: 0 },
      { state: false, at: CONFIRM_MS },
      { state: false, at: 600_000 },
    ], muted).show).toBe(false);
  });

  it('un-mutes on sign-in so a genuine later logout can prompt again', () => {
    const muted: SignInPromptState = { signedOutSince: null, muted: true };
    const signedIn = run([{ state: true, at: 0 }], muted);
    expect(signedIn.muted).toBe(false);

    const afterLogout = run([
      { state: false, at: 1000 },
      { state: false, at: 1000 + CONFIRM_MS },
    ], signedIn);
    expect(afterLogout.show).toBe(true);
  });

  it('keeps the mute across a teardown, so closing it survives navigation', () => {
    const muted: SignInPromptState = { signedOutSince: null, muted: true };
    expect(run([{ state: null, at: 0 }], muted).muted).toBe(true);
  });
});
