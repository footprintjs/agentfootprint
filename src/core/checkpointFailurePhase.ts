/**
 * Classify a thrown error into one of the failure-point phase
 * buckets. Heuristic — uses error name / code / message inspection.
 * Fast path returns 'unknown' so unrecognized errors still produce
 * a checkpoint (the cause itself is preserved in
 * `RunCheckpointError.cause`).
 *
 * **The FALLBACK since 8.14.0.** It only runs when the tracker observed no
 * open bracket, because an error's own text is the weakest available evidence
 * about where it happened: `TypeError: Load failed` — WebKit's entire message
 * for a failed `fetch` — matches nothing here and produced `'unknown'` on a
 * real production report while the run knew the LLM call was open. Observation
 * first, this second.
 */
export function classifyFailurePhase(err: Error): 'iteration' | 'tool' | 'llm' | 'unknown' {
  const name = err.name;
  const code = (err as { code?: string }).code ?? '';
  const msg = err.message ?? '';
  // LLM provider failures: known codes + name patterns.
  if (
    code === 'ERR_CIRCUIT_OPEN' || // our own circuit breaker
    name === 'AnthropicError' ||
    name === 'OpenAIError' ||
    name === 'BedrockError' ||
    /\b(LLM|provider|anthropic|openai|bedrock)\b/i.test(msg)
  ) {
    return 'llm';
  }
  if (/\b(tool|tool_call)\b/i.test(name) || /\bTool\b/.test(msg)) {
    return 'tool';
  }
  if (/iteration/i.test(msg)) return 'iteration';
  return 'unknown';
}
