/**
 * classify/typesafe — the TypeSafe "System One" adapter (model `jev`).
 *
 * Pattern: adapter over the `Classifier` port (the `AnthropicProvider`
 *          shape: key from the environment, retries, a timeout, errors
 *          wrapped by name). No SDK: one `fetch` against
 *          `POST {baseUrl}/v1/systemone` with a bearer key.
 * Role:    the one shipped classifier that scores. Verified 2026-09-17 by
 *          one real call (docs/design/2026-09-scored-choice.md § Track); the
 *          wire below is that probe's, quoted, not guessed.
 *
 * THE WIRE (request)
 *   { model, state, questions: { [id]: { type: 'choice', instructions, criteria: { option: description } }
 *                               | { type: 'noul', instructions, criteria?: { true, false } }
 *                               | { type: 'score', instructions, criteria: string[] } } }
 * THE WIRE (response)
 *   { model: 'jev-1.13.0',
 *     answers: { [id]: { type: 'choice', choice, confidence, probabilities }
 *                     | { type: 'noul', noul }
 *                     | { type: 'score', score, confidence, probabilities, legend? } },
 *     usage: { input_tokens, output_tokens } }
 * Errors: 401 bad key · 422 validation · 429 rate limit · 529 overloaded.
 * 429 and 529 are retried with exponential backoff up to `maxRetries`; every
 * other status is final on the first reply.
 *
 * LAWS. The response is mapped field for field: `probabilities` is the
 * provider's object as sent (never renormalised, never rounded), `model` is
 * the provider's resolved string, `usage` is renamed to the port's camelCase
 * and dropped when absent. `latencyMs` is measured around the WHOLE call —
 * retries and their waits included — because that is what the judgment cost
 * the run. The key is read once at construction and appears in the
 * `Authorization` header only: never in an error, never in a log.
 */

import {
  ClassifierError,
  type ClassifyAnswer,
  type Classifier,
  type ClassifyRequest,
  type ClassifyResult,
} from './types.js';

export interface TypesafeClassifierOptions {
  /** API key. Defaults to the `TYPESAFE_API_KEY` environment variable. */
  readonly apiKey?: string;
  /** The model alias sent on every request. Default `'jev-latest'`. */
  readonly model?: string;
  /** Origin of the API. Default `'https://api.typesafe.ai'`. */
  readonly baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  readonly timeout?: number;
  /** Retries on 429 / 529 after the first attempt. Default 2 (three attempts). */
  readonly maxRetries?: number;
  /**
   * The first backoff wait in milliseconds; each retry doubles it. Default
   * 250. A test that stubs `fetch` sets it to 0 so a backoff case is not a
   * slow case.
   */
  readonly retryDelayMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
/** The two statuses the provider documents as transient. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 529]);
/** How much of an error body an error message quotes. */
const ERROR_BODY_CHARS = 300;

/**
 * A provider's error body is quoted into the thrown message so a 422 names
 * the field it refused — and a body that echoed the credential back (some
 * auth layers do) would carry the key into logs. The key is replaced before
 * the quote, whole or by any run of 12+ of its characters, so a masked or
 * partial echo is caught too. The adapter itself never inserts the key.
 */
function redact(text: string, apiKey: string): string {
  if (apiKey.length === 0) return text;
  let out = text.split(apiKey).join('[redacted]');
  if (apiKey.length >= 12) {
    for (let i = 0; i + 12 <= apiKey.length; i += 4) {
      const piece = apiKey.slice(i, i + 12);
      if (out.includes(piece)) out = out.split(piece).join('[redacted]');
    }
  }
  return out;
}

/**
 * Build the TypeSafe classifier. Throws at construction — not at the first
 * call — when no key is in reach, naming the variable, so a misconfigured
 * agent fails at build rather than filing an error row per tool result.
 */
export function typesafe(options: TypesafeClassifierOptions = {}): Classifier {
  const apiKey = options.apiKey ?? readEnvKey();
  if (apiKey === undefined || apiKey === '') {
    throw new Error(
      'typesafe: no API key. Pass `apiKey` or set the TYPESAFE_API_KEY environment variable.',
    );
  }
  const model = options.model ?? DEFAULT_MODEL;
  const url = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/systemone`;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };

  return {
    name: 'typesafe',
    async classify(request: ClassifyRequest, signal?: AbortSignal): Promise<ClassifyResult> {
      const body = JSON.stringify({ model, state: request.state, questions: request.questions });
      const startedAt = Date.now();
      for (let attempt = 0; ; attempt++) {
        throwIfAborted(signal);
        const response = await attemptOnce(url, headers, body, timeout, signal);
        if (response.ok) {
          const wire = await readJson(response);
          return mapResult(wire, Date.now() - startedAt);
        }
        const status = response.status;
        const text = await response.text().catch(() => '');
        const retryable = RETRYABLE_STATUSES.has(status);
        if (!retryable || attempt >= maxRetries) {
          throw new ClassifierError(
            `typesafe: HTTP ${status}${
              text ? ` — ${redact(text.slice(0, ERROR_BODY_CHARS), apiKey)}` : ''
            }`,
            { status, retryable },
          );
        }
        await wait(retryDelayMs * 2 ** attempt, signal);
      }
    },
  };
}

// ─── One attempt ───────────────────────────────────────────────────────

/** One HTTP attempt under the per-attempt timeout and the caller's signal. */
async function attemptOnce(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeout: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  try {
    return await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw err; // the caller's abort: theirs to read, not wrapped
    throw new ClassifierError(
      `typesafe: request failed — ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (err) {
    throw new ClassifierError(
      `typesafe: response was not JSON — ${err instanceof Error ? err.message : String(err)}`,
      { status: response.status, retryable: false },
    );
  }
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('aborted');
}

function readEnvKey(): string | undefined {
  return typeof process !== 'undefined' ? process.env?.TYPESAFE_API_KEY : undefined;
}

// ─── Mapping the wire ──────────────────────────────────────────────────

interface WireUsage {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
}

/**
 * The wire → the port, field for field. A reply missing `answers` or the
 * provider's `model` string, an answer with an unknown `type`, or a numeric
 * field (`confidence`, `score`, `noul`) that is missing or not a finite
 * number is a `ClassifierError`, never a partial result: a judgment row must
 * never carry a shape nobody produced, a model nobody named (`'unknown'`
 * would be the library's word on the record) or a `NaN` confidence a bench
 * would average.
 */
function mapResult(wire: unknown, latencyMs: number): ClassifyResult {
  const w = wire as { model?: unknown; answers?: unknown; usage?: WireUsage } | null;
  if (w === null || typeof w !== 'object' || w.answers === null || typeof w.answers !== 'object') {
    throw new ClassifierError('typesafe: response carries no `answers` object', {
      retryable: false,
    });
  }
  if (typeof w.model !== 'string' || w.model.length === 0) {
    throw new ClassifierError('typesafe: response carries no `model` string', {
      retryable: false,
    });
  }
  const answers: Record<string, ClassifyAnswer> = {};
  for (const [id, raw] of Object.entries(w.answers as Record<string, unknown>)) {
    answers[id] = mapAnswer(id, raw);
  }
  const usage = mapUsage(w.usage);
  return {
    model: w.model,
    answers,
    ...(usage !== undefined && { usage }),
    latencyMs,
  };
}

function mapAnswer(id: string, raw: unknown): ClassifyAnswer {
  const a = raw as Record<string, unknown> | null;
  const type = a?.type;
  if (type === 'choice') {
    return {
      type: 'choice',
      choice: String(a!.choice),
      confidence: numberField(id, a!, 'confidence'),
      probabilities: numbersOf(a!.probabilities),
    };
  }
  if (type === 'noul') return { type: 'noul', noul: numberField(id, a!, 'noul') };
  if (type === 'score') {
    const legend = a!.legend;
    return {
      type: 'score',
      score: numberField(id, a!, 'score'),
      confidence: numberField(id, a!, 'confidence'),
      probabilities: numbersOf(a!.probabilities),
      ...(legend !== null &&
        typeof legend === 'object' && { legend: legend as Readonly<Record<string, string>> }),
    };
  }
  throw new ClassifierError(
    `typesafe: answer '${id}' has an unknown type ${JSON.stringify(type)}`,
    { retryable: false },
  );
}

/** A numeric field the provider must have produced — missing or not a finite number is refused. */
function numberField(id: string, answer: Record<string, unknown>, field: string): number {
  const v = answer[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ClassifierError(
      `typesafe: answer '${id}' carries no numeric '${field}' (got ${JSON.stringify(v)})`,
      { retryable: false },
    );
  }
  return v;
}

/** The distribution as sent — every value read as a number, none rescaled. */
function numbersOf(raw: unknown): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (raw !== null && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = Number(v);
  }
  return out;
}

function mapUsage(raw: WireUsage | undefined): ClassifyResult['usage'] | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') return undefined;
  if (typeof raw.input_tokens !== 'number' || typeof raw.output_tokens !== 'number') {
    return undefined;
  }
  return { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
}
