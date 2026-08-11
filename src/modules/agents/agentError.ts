const MODEL_UNAVAILABLE = /模型不存在|model(?:\s+code)?[^.]{0,40}(?:not found|does not exist|unavailable)|invalid[_ -]?model/iu;

/**
 * Provider rate limiting. Measured 2026-08-12: at ~28,700 input tokens per turn against a 200,000
 * tokens-per-minute organisation limit, roughly SEVEN turns per minute saturate the whole org — and
 * a single developer running the bench tripped it three times in one day.
 *
 * This has to be its own message. A 429 fell through to "The AI service failed to complete this
 * request", which is indistinguishable from a broken model and tells the user to do the one thing
 * that makes it worse: retry immediately. The provider usually says to wait about a second.
 */
const RATE_LIMITED = /\b429\b|rate[_ -]?limit|tokens per min|requests per min|too many requests/i;

/** User-safe agent failure copy: never surface provider-localized diagnostics in the chat. */
export function presentAgentError(errorMessage: string, budgetHit: boolean): string {
  if (budgetHit) {
    return `I had to stop early: ${errorMessage}. Here is what I have so far — please narrow the request.`;
  }
  // Checked BEFORE model-unavailable: a rate-limit body can name the model, and "unavailable" would
  // send the user to an administrator for something that clears itself in seconds.
  if (RATE_LIMITED.test(errorMessage)) {
    return (
      'The assistant is at capacity right now — too many requests are in flight across the team. ' +
      'Please wait a few seconds and send that again. Nothing is broken and nothing was lost.'
    );
  }
  if (MODEL_UNAVAILABLE.test(errorMessage)) {
    return 'The configured AI model is currently unavailable. Please retry; the incident has been recorded for an administrator.';
  }
  return 'The AI service failed to complete this request. Please retry.';
}

/** True when the failure is provider throttling — worth distinguishing in audit and metrics. */
export function isRateLimitError(errorMessage: string): boolean {
  return RATE_LIMITED.test(errorMessage);
}
