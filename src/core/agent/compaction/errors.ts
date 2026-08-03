/**
 * compaction/errors — the one refusal compaction makes out loud.
 *
 * Pattern: Typed terminal error (peer of PolicyHaltError).
 * Role:    core/ layer.
 * Emits:   N/A.
 */

/**
 * Thrown when compaction is configured but the provider reports no token
 * usage, so the threshold cannot be COUNTED.
 *
 * Compaction is counted, not guessed. Given a provider that reports nothing,
 * the library has three options: guess the window size (a lie), silently do
 * nothing (a configured budget that never applies — config that lies), or say
 * so. It says so, by name, at the first iteration boundary where a completed
 * call reported zero tokens in AND zero out.
 *
 * Terminal: `Agent.run` does not wrap this in `RunCheckpointError`, because
 * resuming would walk into the same wall with the same provider.
 */
export class CompactionUnmeasurableError extends Error {
  override readonly name = 'CompactionUnmeasurableError';
  /** `provider.name` of the adapter that reported nothing. */
  readonly provider: string;

  constructor(provider: string) {
    super(
      `Compaction is counted, not guessed: provider '${provider}' reported 0 input and 0 output ` +
        `tokens for the last call, so the window cannot be measured against thresholdTokens. ` +
        `Compaction refuses rather than guess the size of the window or leave a configured ` +
        `budget silently unenforced. Fixes: use a provider that reports usage (anthropic, ` +
        `openai, bedrock and the mock provider all do), or remove .compaction() from this agent. ` +
        `Note that some OpenAI-compatible endpoints (Ollama, vLLM) do not send usage while ` +
        `streaming.`,
    );
    this.provider = provider;
  }
}
