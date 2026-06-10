/**
 * humanizeLLMError — turn a raw provider/SDK error into a plain-language
 * sentence a NON-developer can act on.
 *
 * agentfootprint targets vibe-coding / non-developer builders. A raw
 * "[browser-anthropic] Failed to fetch" or "401 Unauthorized" means
 * nothing to them. This maps the common failure shapes to a friendly,
 * actionable message. The raw error is preserved on `.cause` (and via
 * `wrapLLMError`) so developers can still dig in.
 *
 * Pure + dependency-light: string/shape matching only. Extend the cases
 * as new provider failure modes surface — keep each message short and
 * tell the user what to DO.
 */

interface ErrorLike {
  readonly code?: string;
  readonly status?: number;
  readonly statusCode?: number;
  readonly message?: string;
  readonly name?: string;
}

/** Map a thrown provider/SDK error to a friendly, actionable sentence. */
export function humanizeLLMError(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  const raw = (e.message ?? String(err ?? '')).toString();
  const status = e.status ?? e.statusCode;
  const lc = raw.toLowerCase();

  // Network / unreachable — the most common "Failed to fetch" case.
  // "connection error" is the Stainless SDKs' APIConnectionError message
  // (@anthropic-ai/sdk, openai v4/v5) — it carries NO status code.
  if (
    /failed to fetch|fetch failed|network ?error|connection error|enotfound|eai_again|econnrefused|econnreset|socket hang up|load failed/i.test(
      raw,
    )
  ) {
    return "Couldn't reach the AI model. Check your internet connection, and that the provider/API key is set up correctly.";
  }

  // Auth — missing/invalid API key (or, for Bedrock, IAM/model access:
  // AccessDeniedException says "You don't have access to the model..."
  // with the status only under $metadata, which we never see).
  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|api[ _-]?key|authentication|invalid x-api-key|permission|access denied|don.?t have access/i.test(
      lc,
    )
  ) {
    return 'The AI provider rejected the request — the API key looks missing or invalid. Add or fix it in Settings.';
  }

  // Rate limit.
  if (status === 429 || /rate.?limit|too many requests|quota/i.test(lc)) {
    return 'The AI provider is busy (rate limit / quota). Wait a moment, then try again.';
  }

  // Timeout.
  if (/timeout|timed out|etimedout|deadline/i.test(lc)) {
    return 'The AI model took too long to respond. Try again — if it keeps happening, simplify the request.';
  }

  // Transient server-side (5xx).
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return 'The AI provider had a temporary problem on their end. Try again in a moment.';
  }

  // Bad request — usually a model name or payload issue.
  if (status === 400 || /not found|no such model|invalid model|model.*not/i.test(lc)) {
    return 'The AI request was rejected — the model name or request may be wrong. Check the model in the code.';
  }

  // Fallback: keep the raw text but frame it so it doesn't read as a crash.
  return raw ? `The AI call failed: ${raw}` : 'The AI call failed for an unknown reason.';
}

/**
 * Wrap a raw provider error in a fresh Error whose `.message` is the
 * humanized sentence, preserving the original on `.cause` for developers
 * (and "Copy for LLM"). Re-throw this from the LLM call site so the
 * friendly message flows through onError → onRunFailed → the monitor.
 */
export function wrapLLMError(err: unknown): Error {
  const friendly = humanizeLLMError(err);
  // `cause` keeps the raw error for devs; non-devs see only `.message`.
  return new Error(friendly, err instanceof Error ? { cause: err } : undefined);
}
