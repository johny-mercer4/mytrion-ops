export function zeroTokenOutcome(
  startedAt: number,
  finalText: string,
  usage: Record<string, unknown> = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    openai_calls: 0,
  },
): {
  finalText: string;
  stats: {
    durationMs: number;
    numTurns: number;
    usage: Record<string, unknown>;
    isError: boolean;
  };
} {
  return {
    finalText,
    stats: {
      durationMs: Date.now() - startedAt,
      numTurns: 0,
      usage,
      isError: false,
    },
  };
}
