const MODEL_UNAVAILABLE = /模型不存在|model(?:\s+code)?[^.]{0,40}(?:not found|does not exist|unavailable)|invalid[_ -]?model/iu;

/** User-safe agent failure copy: never surface provider-localized diagnostics in the chat. */
export function presentAgentError(errorMessage: string, budgetHit: boolean): string {
  if (budgetHit) {
    return `I had to stop early: ${errorMessage}. Here is what I have so far — please narrow the request.`;
  }
  if (MODEL_UNAVAILABLE.test(errorMessage)) {
    return 'The configured AI model is currently unavailable. Please retry; the incident has been recorded for an administrator.';
  }
  return 'The AI service failed to complete this request. Please retry.';
}
