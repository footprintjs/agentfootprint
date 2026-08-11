/**
 * ContextWindowExceededError — "the request did not fit" as a typed error
 * that names the fixes (9.6.0).
 *
 * Every vendor refuses an over-long request in its own words, and until now
 * every one of them reached the caller as an opaque provider error:
 *
 *   [openai] 400 Input tokens exceed the configured limit of 272000 tokens.
 *   Your messages resulted in 879073 tokens.
 *
 * That is the message a production field deployment spent a day on. It is a
 * true sentence and a useless one: it does not say which of the framework's
 * dials moves that number, and it looks exactly like a transient 400 — so the
 * natural next move is to retry, which re-sends the same oversized history and
 * fails identically, forever.
 *
 * So the adapters translate it, ONCE, into an error whose message contains the
 * three fixes in the order they are worth trying, and which carries the two
 * numbers (limit, actual) when the vendor stated them.
 *
 * **Detection is deliberately conservative.** Only unmistakable phrases and
 * vendor codes translate; everything else passes through untouched as the
 * provider error it always was. In particular a RATE limit ("rate limit
 * reached … tokens per min") is a different failure with a different fix and
 * must never land here — which is why no pattern matches on "too many tokens".
 *
 * @see ../../core/runCheckpoint.ts  where this class makes `resumeOnError`
 *                                   stop advertising a resume that cannot work
 */

/** Discriminator carried on the error — stable across releases. */
export const ERR_CONTEXT_WINDOW_EXCEEDED = 'ERR_CONTEXT_WINDOW_EXCEEDED' as const;

/**
 * Thrown by an LLM adapter when the provider refused the request because the
 * prompt did not fit the model's context window.
 *
 * A refusal, not a failure of the model: nothing was generated and nothing was
 * charged for output. Retrying the identical request is deterministic — it
 * fails the same way — so this is one of the classes
 * {@link canResume} reports as not resumable.
 *
 * @example
 * ```ts
 * import { ContextWindowExceededError } from 'agentfootprint';
 *
 * try {
 *   await agent.run({ message: 'summarise the fabric inventory' });
 * } catch (err) {
 *   if (err instanceof ContextWindowExceededError) {
 *     console.error(`sent ${err.actualTokens} against ${err.limitTokens}`);
 *     // …cap the tool result, or add .window(slidingWindow({ keepRecentTurns: 2 }))
 *   }
 * }
 * ```
 */
export class ContextWindowExceededError extends Error {
  readonly code = ERR_CONTEXT_WINDOW_EXCEEDED;

  /** Which adapter refused — `'openai'`, `'anthropic'`, `'bedrock'`, … */
  readonly provider: string;

  /** The model's (or gateway's) ceiling in tokens, when the vendor said it. */
  readonly limitTokens?: number;

  /** What the request actually came to in tokens, when the vendor said it. */
  readonly actualTokens?: number;

  /** HTTP status, when there was one. Kept so retry policies still see a 4xx. */
  readonly status?: number;

  /** The provider's own error, unchanged. */
  override readonly cause?: Error;

  constructor(args: {
    provider: string;
    providerMessage: string;
    limitTokens?: number;
    actualTokens?: number;
    status?: number;
    cause?: Error;
  }) {
    super(buildMessage(args));
    this.name = 'ContextWindowExceededError';
    this.provider = args.provider;
    if (args.limitTokens !== undefined) this.limitTokens = args.limitTokens;
    if (args.actualTokens !== undefined) this.actualTokens = args.actualTokens;
    if (args.status !== undefined) this.status = args.status;
    if (args.cause !== undefined) this.cause = args.cause;
  }
}

/** `true` for the typed error, including across a `structuredClone`-free
 *  boundary where `instanceof` still holds. Kept as a function so callers do
 *  not have to import the class to ask the question. */
export function isContextWindowExceeded(err: unknown): err is ContextWindowExceededError {
  return (
    err instanceof ContextWindowExceededError ||
    (err instanceof Error && (err as { code?: string }).code === ERR_CONTEXT_WINDOW_EXCEEDED)
  );
}

// ─── Detection ───────────────────────────────────────────────────────

/**
 * The phrases that mean "your request was too big for the context window",
 * as the four shipped wire vendors actually word them. Every one of these is
 * unambiguous on its own — which is the bar for being on this list, because a
 * pattern that also matches a rate limit or a `max_tokens` validation error
 * would send callers to the wrong fix.
 *
 *   openai        This model's maximum context length is 8192 tokens. However,
 *                 your messages resulted in 9000 tokens.
 *   openai (code) context_length_exceeded
 *   gateways      Input tokens exceed the configured limit of 272000 tokens.
 *                 Your messages resulted in 879073 tokens.
 *   anthropic     prompt is too long: 250000 tokens > 200000 maximum
 *   anthropic     input length and `max_tokens` exceed context limit:
 *                 195000 + 8192 > 200000
 *   bedrock       Input is too long for requested model.
 *   bedrock       (ValidationException carrying either anthropic phrase)
 */
const CONTEXT_PHRASES: readonly RegExp[] = [
  /context_length_exceeded/i,
  /maximum context length/i,
  /prompt is too long/i,
  /exceed(?:s)? context limit/i,
  /input (?:is )?too long for (?:the )?requested model/i,
  /input tokens exceed the configured limit/i,
  // "input tokens" spelled out on purpose. A gateway saying "exceeds the
  // maximum allowed number of tokens" with no side named could equally be an
  // OUTPUT `max_tokens` cap, which has a different fix — and a pattern that
  // cannot tell those apart sends callers to the wrong one.
  /exceeds? the maximum (?:allowed )?(?:number of )?input tokens/i,
];

/** `"272,000"` → `272000`; anything unparseable → undefined. */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw.replace(/[,_\s]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Pull `{ limit, actual }` out of the vendor's sentence when it stated them. */
function readNumbers(text: string): { limitTokens?: number; actualTokens?: number } {
  // anthropic: "prompt is too long: 250000 tokens > 200000 maximum"
  const tooLong = /prompt is too long:\s*([\d,_]+)\s*tokens?\s*>\s*([\d,_]+)/i.exec(text);
  if (tooLong) {
    return { actualTokens: num(tooLong[1]), limitTokens: num(tooLong[2]) };
  }

  // anthropic / bedrock: "input length and `max_tokens` exceed context limit:
  //                       195000 + 8192 > 200000"
  const sum = /exceed(?:s)? context limit:\s*([\d,_]+)\s*\+\s*([\d,_]+)\s*>\s*([\d,_]+)/i.exec(
    text,
  );
  if (sum) {
    const input = num(sum[1]);
    const output = num(sum[2]);
    return {
      ...(input !== undefined && output !== undefined && { actualTokens: input + output }),
      ...(num(sum[3]) !== undefined && { limitTokens: num(sum[3]) }),
    };
  }

  const limit =
    num(/maximum context length is\s*([\d,_]+)/i.exec(text)?.[1]) ??
    num(/configured limit of\s*([\d,_]+)/i.exec(text)?.[1]) ??
    num(/limit of\s*([\d,_]+)\s*tokens/i.exec(text)?.[1]);
  const actual =
    num(/resulted in\s*([\d,_]+)\s*tokens/i.exec(text)?.[1]) ??
    num(/requested\s*([\d,_]+)\s*tokens/i.exec(text)?.[1]) ??
    num(/you (?:sent|submitted|provided)\s*([\d,_]+)\s*tokens/i.exec(text)?.[1]);

  return {
    ...(limit !== undefined && { limitTokens: limit }),
    ...(actual !== undefined && { actualTokens: actual }),
  };
}

/** Every place a vendor hides its sentence, flattened into one string. */
function textOf(err: unknown, extraText?: string): string {
  const parts: string[] = [];
  if (typeof extraText === 'string') parts.push(extraText);
  const seen = new Set<unknown>();
  let node: unknown = err;
  for (let depth = 0; depth < 4 && node !== undefined && node !== null; depth++) {
    if (seen.has(node)) break;
    seen.add(node);
    const record = node as {
      message?: unknown;
      code?: unknown;
      type?: unknown;
      name?: unknown;
      error?: unknown;
      cause?: unknown;
    };
    for (const value of [record.message, record.code, record.type, record.name]) {
      if (typeof value === 'string') parts.push(value);
    }
    node = record.error ?? record.cause;
  }
  return parts.join(' • ');
}

/** HTTP status from wherever the SDK put it. */
function statusOf(err: unknown): number | undefined {
  const record = err as {
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    response?: { status?: unknown };
  };
  for (const value of [
    record?.status,
    record?.statusCode,
    record?.$metadata?.httpStatusCode,
    record?.response?.status,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export interface ContextWindowTranslation {
  /** Which adapter is asking — appears in the message prefix. */
  readonly provider: string;
  /**
   * Extra text to search — the HTTP body, for adapters that read the response
   * themselves instead of going through a vendor SDK.
   */
  readonly bodyText?: string;
  /** Status the adapter already knows (browser adapters read it off `Response`). */
  readonly status?: number;
}

/**
 * Does this error SAY it is a context overflow, whoever produced it?
 *
 * The same conservative phrase test the adapters translate on, asked without
 * building anything — for code that has to classify an error it did not
 * catch at an adapter boundary. A custom `LLMProvider`, a gateway wrapper or
 * a proxy in front of a vendor produces the vendor's sentence without ever
 * passing through `wrapError`, and a caller reading that error deserves the
 * same answer an adapter would have given.
 *
 * @see ../../core/runCheckpoint.ts — the caller this exists for
 */
export function looksLikeContextWindowExceeded(err: unknown, bodyText?: string): boolean {
  if (isContextWindowExceeded(err)) return true;
  const text = textOf(err, bodyText);
  return text.length > 0 && CONTEXT_PHRASES.some((pattern) => pattern.test(text));
}

/**
 * Translate a provider error into {@link ContextWindowExceededError} — or
 * return `undefined`, which means "not this failure, leave it alone".
 *
 * Already-translated errors are returned as they are, so an adapter that
 * wraps another adapter cannot double-wrap.
 */
export function asContextWindowExceeded(
  err: unknown,
  options: ContextWindowTranslation,
): ContextWindowExceededError | undefined {
  if (isContextWindowExceeded(err)) return err as ContextWindowExceededError;
  if (!looksLikeContextWindowExceeded(err, options.bodyText)) return undefined;

  const text = textOf(err, options.bodyText);

  const numbers = readNumbers(text);
  // The status the SDK attached, else the one the adapter read off the
  // response, else a leading `400` the vendor put in the message itself
  // (several gateways do). Kept because retry policies classify on it, and a
  // context overflow must never look retryable.
  const status = statusOf(err) ?? options.status ?? num(/^\s*(4\d\d)\b/.exec(messageOf(err))?.[1]);

  return new ContextWindowExceededError({
    provider: options.provider,
    providerMessage: messageOf(err) || options.bodyText || text,
    ...numbers,
    ...(status !== undefined && { status }),
    ...(err instanceof Error && { cause: err }),
  });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

// ─── The message ─────────────────────────────────────────────────────

function tokens(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value.toLocaleString('en-US')} tokens`;
}

/**
 * The teaching half. Three fixes, cheapest first, and the one thing about
 * `.compaction()` that is not obvious until it fails: folding a span means
 * SENDING that span to the summarizer, so compaction cannot rescue a single
 * round that is already bigger than the window.
 */
function buildMessage(args: {
  provider: string;
  providerMessage: string;
  limitTokens?: number;
  actualTokens?: number;
}): string {
  const sent = tokens(args.actualTokens);
  const limit = tokens(args.limitTokens);
  const size =
    sent && limit
      ? ` — ${sent} sent against a limit of ${limit}`
      : limit
      ? ` — the limit is ${limit}`
      : sent
      ? ` — the request came to ${sent}`
      : '';

  return (
    `[${args.provider}] the request did not fit the context window${size}. ` +
    `The provider refused it before the model saw it, so nothing was generated ` +
    `and re-sending the same conversation fails the same way.\n` +
    `  Fix 1 — cap oversized TOOL RESULTS where they are produced. One raw ` +
    `database dump returned to the model is the usual whole overrun: return a ` +
    `summary plus an id the model can ask about, not every row.\n` +
    `  Fix 2 — .window(slidingWindow({ keepRecentTurns: 2 })) drops older ` +
    `rounds before the request is assembled, so the conversation stops growing ` +
    `without bound.\n` +
    `  Fix 3 — .compaction() keeps a LONG conversation small, but it cannot ` +
    `fold a span that is already bigger than the window: the summarizer call ` +
    `sends that span, so it fails exactly as this call did. Fix the oversized ` +
    `round first, then compact.\n` +
    `  Provider said: ${args.providerMessage}`
  );
}
