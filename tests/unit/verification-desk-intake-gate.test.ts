/**
 * The desk's intake correction, and the gate it is supposed to open.
 *
 * WHY THIS EXISTS. `refreshGate` only opens the gate when the intake verdict is complete AND either
 * the gate was already open or the caller declares it is submitting — Sales policy, because
 * "releasing work to another department is a decision the agent makes, not a side-effect of typing
 * the last field". `deskService.patchIntake` first shipped without that flag, and the result was
 * silent and worse than a refusal: the correction was accepted, the gate stayed shut however
 * complete the file became, and `intake_missing` was rewritten to `[]` — so the desk's banner
 * degraded from "1 item outstanding" to the false "intake not started" and neither side was told
 * what to do next.
 *
 * These assert the CONTRACT that made that a bug, at the level `refreshGate` actually decides it:
 * the two inputs it reads, and the two writes it derives. No database — the shape of the decision is
 * the thing that regressed, and it is pure.
 */
import { describe, expect, it } from 'vitest';
import { VERIFICATION_STATUS } from '../../src/db/schema/verification_flow.js';

/**
 * `refreshGate`'s gate decision, transcribed from applicationService.ts.
 *
 * Kept here rather than imported because the function is 80 lines of IO around these two lines; the
 * assertion that matters is that a desk correction reaches them with `submitting: true`.
 */
function gateDecision(input: {
  complete: boolean;
  alreadyOpen: boolean;
  submitting?: boolean | undefined;
  storedStatus: string;
}): { open: boolean; statusCode: string } {
  const open = input.complete && (input.submitting === true || input.alreadyOpen);
  const statusCode = open
    ? input.storedStatus === VERIFICATION_STATUS.intakeIncomplete
      ? VERIFICATION_STATUS.intakeSubmitted
      : input.storedStatus
    : VERIFICATION_STATUS.intakeIncomplete;
  return { open, statusCode };
}

describe('the gate a desk correction has to move', () => {
  it('stays SHUT on a complete red case when the caller does not declare a submit', () => {
    // This is the bug: every field correct, and the case is still unworkable.
    expect(
      gateDecision({
        complete: true,
        alreadyOpen: false,
        storedStatus: VERIFICATION_STATUS.intakeIncomplete,
      }),
    ).toEqual({ open: false, statusCode: VERIFICATION_STATUS.intakeIncomplete });
  });

  it('OPENS on a complete red case when the caller declares a submit', () => {
    expect(
      gateDecision({
        complete: true,
        alreadyOpen: false,
        submitting: true,
        storedStatus: VERIFICATION_STATUS.intakeIncomplete,
      }),
    ).toEqual({ open: true, statusCode: VERIFICATION_STATUS.intakeSubmitted });
  });

  it('leaves an incomplete case shut however it is called', () => {
    for (const submitting of [undefined, true]) {
      expect(
        gateDecision({
          complete: false,
          alreadyOpen: false,
          ...(submitting === undefined ? {} : { submitting }),
          storedStatus: VERIFICATION_STATUS.intakeIncomplete,
        }).open,
      ).toBe(false);
    }
  });

  it('does not rewind a case that is already past intake', () => {
    expect(
      gateDecision({
        complete: true,
        alreadyOpen: true,
        submitting: true,
        storedStatus: VERIFICATION_STATUS.inReview,
      }),
    ).toEqual({ open: true, statusCode: VERIFICATION_STATUS.inReview });
  });
});

describe('deskService.patchIntake declares the submit', () => {
  it('passes submitting: true — the whole point of the desk having its own patch', async () => {
    // Read rather than executed: calling it needs a database, and what regressed is the call site.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/modules/verificationFlow/deskService.ts', 'utf8');
    const body = /async patchIntake\([\s\S]*?\n {2}\},/.exec(source)?.[0] ?? '';
    expect(body, 'patchIntake not found — did it move?').not.toBe('');
    expect(body).toContain('refreshGate');
    expect(body).toContain('submitting: true');
  });

  it('refuses a decided case rather than editing the evidence for a decision already made', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/modules/verificationFlow/deskService.ts', 'utf8');
    const body = /async patchIntake\([\s\S]*?\n {2}\},/.exec(source)?.[0] ?? '';
    expect(body).toContain('VERIFICATION_CASE_CLOSED');
    // Deliberately does not CALL loadWorkable — that helper also refuses a red case, and a red case
    // is exactly the one worth correcting. (The docblock names it, hence matching the call.)
    expect(body).not.toMatch(/await loadWorkable\(/);
  });
});
