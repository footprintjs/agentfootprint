/**
 * Unit tests — the TypeSafe classifier adapter, against a stubbed global
 * `fetch`. The hosted classifier is never called: the ONE real response
 * (the 2026-09-17 probe) is the fixture below, quoted byte for byte.
 *
 * Pattern: Test-as-specification (7-type matrix, Convention 3):
 *   - unit:        request bytes, the auth header, the URL, the model alias
 *   - integration: the fixture maps field for field into `ClassifyResult`
 *   - property:    no renormalisation — the distribution is the wire's own
 *   - edge:        usage absent, an unknown answer type, a non-JSON body
 *   - regression:  backoff on 429 / 529 only, bounded by maxRetries
 *   - security:    the key is never in an error message; missing key refuses at construction
 *   - documentation: latency is measured around the whole call
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifierError, typesafe } from '../../src/classify/index.js';

/** The probe's response, verbatim (docs/design/2026-09-scored-choice.md § Track). */
export const PROBE_RESPONSE = {
  model: 'jev-1.13.0',
  answers: {
    standing: {
      type: 'choice',
      choice: 'noise',
      confidence: 0.59,
      probabilities: { fact: 0.0, noise: 0.69, open: 0.3, 'ruled-out': 0.01 },
    },
    tests_proposition: { type: 'noul', noul: 0.19 },
  },
  usage: { input_tokens: 494, output_tokens: 68 },
} as const;

const REQUEST = {
  state: { proposition: 'the optic was swapped', tool: 'search_logs', result: 'no entries' },
  questions: {
    standing: {
      type: 'choice' as const,
      instructions: 'What is this result to the proposition?',
      criteria: { fact: 'f', open: 'o', noise: 'n', 'ruled-out': 'r' },
    },
    tests_proposition: { type: 'noul' as const, instructions: 'Does the result test it?' },
  },
};

type Call = { url: string; init: RequestInit };

/** A fetch stub answering a script of replies, recording every call. */
function stubFetch(replies: readonly (() => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return reply();
  });
  vi.stubGlobal('fetch', impl);
  return { calls, impl };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
const text = (body: string, status: number) => () => new Response(body, { status });

const KEY = 'sk-typesafe-test-0000';
const build = (extra: Parameters<typeof typesafe>[0] = {}) =>
  typesafe({ apiKey: KEY, retryDelayMs: 0, ...extra });

describe('typesafe — construction', () => {
  beforeEach(() => vi.stubEnv('TYPESAFE_API_KEY', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('refuses at construction, naming the variable, when no key is in reach', () => {
    expect(() => typesafe()).toThrow(/TYPESAFE_API_KEY/);
  });

  it('reads the key from the environment when not passed', () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'sk-from-env');
    expect(() => typesafe()).not.toThrow();
    expect(typesafe().name).toBe('typesafe');
  });
});

describe('typesafe — the request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs JSON { model, state, questions } to /v1/systemone with a bearer key', async () => {
    const { calls } = stubFetch([json(PROBE_RESPONSE)]);
    await build().classify(REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['content-type']).toBe('application/json');
    // The body is the request as given, under the default alias — nothing added, nothing renamed.
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: 'jev-latest',
      state: REQUEST.state,
      questions: REQUEST.questions,
    });
  });

  it('honours `model` and `baseUrl` (trailing slash tolerated)', async () => {
    const { calls } = stubFetch([json(PROBE_RESPONSE)]);
    await build({ model: 'jev-1.13.0', baseUrl: 'https://proxy.example/' }).classify(REQUEST);
    expect(calls[0]!.url).toBe('https://proxy.example/v1/systemone');
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe('jev-1.13.0');
  });
});

describe('typesafe — the response, mapped field for field', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the probe response: model, both answers, usage renamed, latency measured', async () => {
    stubFetch([json(PROBE_RESPONSE)]);
    const result = await build().classify(REQUEST);
    expect(result.model).toBe('jev-1.13.0');
    expect(result.answers).toEqual({
      standing: {
        type: 'choice',
        choice: 'noise',
        confidence: 0.59,
        probabilities: { fact: 0, noise: 0.69, open: 0.3, 'ruled-out': 0.01 },
      },
      tests_proposition: { type: 'noul', noul: 0.19 },
    });
    expect(result.usage).toEqual({ inputTokens: 494, outputTokens: 68 });
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('never renormalises: a distribution that does not sum to 1 is kept as sent', async () => {
    const skewed = {
      ...PROBE_RESPONSE,
      answers: {
        standing: {
          type: 'choice',
          choice: 'fact',
          confidence: 0.4,
          probabilities: { fact: 0.5, noise: 0.5, open: 0.5, 'ruled-out': 0.5 },
        },
      },
    };
    stubFetch([json(skewed)]);
    const result = await build().classify(REQUEST);
    const answer = result.answers.standing!;
    expect(answer.type).toBe('choice');
    if (answer.type === 'choice') {
      expect(answer.probabilities).toEqual({ fact: 0.5, noise: 0.5, open: 0.5, 'ruled-out': 0.5 });
      expect(Object.values(answer.probabilities).reduce((s, v) => s + v, 0)).toBe(2);
    }
  });

  it('maps a score answer, legend included when sent', async () => {
    stubFetch([
      json({
        model: 'jev-1.13.0',
        answers: {
          strength: {
            type: 'score',
            score: 2,
            confidence: 0.7,
            probabilities: { '1': 0.1, '2': 0.7, '3': 0.2 },
            legend: { '1': 'weak', '2': 'fair', '3': 'strong' },
          },
        },
      }),
    ]);
    const result = await build().classify(REQUEST);
    expect(result.answers.strength).toEqual({
      type: 'score',
      score: 2,
      confidence: 0.7,
      probabilities: { '1': 0.1, '2': 0.7, '3': 0.2 },
      legend: { '1': 'weak', '2': 'fair', '3': 'strong' },
    });
    expect(result.usage).toBeUndefined();
  });

  it('a usage block with a missing count is dropped rather than half-mapped', async () => {
    stubFetch([json({ ...PROBE_RESPONSE, usage: { input_tokens: 10 } })]);
    const result = await build().classify(REQUEST);
    expect(result.usage).toBeUndefined();
  });

  it('an answer with an unknown type is refused by name, never partially mapped', async () => {
    stubFetch([json({ model: 'x', answers: { q: { type: 'rank', order: [] } } })]);
    await expect(build().classify(REQUEST)).rejects.toMatchObject({
      name: 'ClassifierError',
      message: expect.stringContaining("'q'"),
      retryable: false,
    });
  });

  it('a reply without `answers` and a non-JSON body are both ClassifierErrors', async () => {
    stubFetch([json({ model: 'x' })]);
    await expect(build().classify(REQUEST)).rejects.toBeInstanceOf(ClassifierError);
    vi.unstubAllGlobals();
    stubFetch([text('<html>', 200)]);
    await expect(build().classify(REQUEST)).rejects.toMatchObject({
      name: 'ClassifierError',
      status: 200,
    });
  });

  it('a reply without the provider `model` string is refused — never mapped as `unknown`', async () => {
    const { model: _dropped, ...noModel } = PROBE_RESPONSE;
    for (const reply of [noModel, { ...noModel, model: '' }, { ...noModel, model: 42 }]) {
      vi.unstubAllGlobals();
      stubFetch([json(reply)]);
      await expect(build().classify(REQUEST)).rejects.toMatchObject({
        name: 'ClassifierError',
        message: expect.stringContaining('`model`'),
        retryable: false,
      });
    }
  });

  it('a choice answer without a numeric `confidence` is refused — never a NaN on the record', async () => {
    const { confidence: _dropped, ...noConfidence } = PROBE_RESPONSE.answers.standing;
    for (const standing of [
      noConfidence,
      { ...noConfidence, confidence: 'high' },
      { ...noConfidence, confidence: null },
    ]) {
      vi.unstubAllGlobals();
      stubFetch([json({ ...PROBE_RESPONSE, answers: { ...PROBE_RESPONSE.answers, standing } })]);
      await expect(build().classify(REQUEST)).rejects.toMatchObject({
        name: 'ClassifierError',
        message: expect.stringContaining("'standing' carries no numeric 'confidence'"),
        retryable: false,
      });
    }
  });
});

describe('typesafe — retries and errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('backs off on 429 then succeeds; the latency spans every attempt', async () => {
    const { calls } = stubFetch([text('rate limited', 429), json(PROBE_RESPONSE)]);
    const result = await build({ maxRetries: 2, retryDelayMs: 5 }).classify(REQUEST);
    expect(calls).toHaveLength(2);
    expect(result.model).toBe('jev-1.13.0');
    expect(result.latencyMs).toBeGreaterThanOrEqual(5);
  });

  it('backs off on 529 too, and stops after maxRetries with the status on the error', async () => {
    const { calls } = stubFetch([text('overloaded', 529)]);
    await expect(build({ maxRetries: 2 }).classify(REQUEST)).rejects.toMatchObject({
      name: 'ClassifierError',
      status: 529,
      retryable: true,
      message: expect.stringContaining('overloaded'),
    });
    expect(calls).toHaveLength(3); // one attempt + two retries
  });

  it('every other status is final on the first reply (401, 422)', async () => {
    for (const status of [401, 422]) {
      vi.unstubAllGlobals();
      const { calls } = stubFetch([text('nope', status)]);
      await expect(build({ maxRetries: 3 }).classify(REQUEST)).rejects.toMatchObject({
        status,
        retryable: false,
      });
      expect(calls).toHaveLength(1);
    }
  });

  it('the key never appears in an error message', async () => {
    stubFetch([text(`bad key: ${KEY}?`, 401)]);
    let caught: unknown;
    try {
      await build().classify(REQUEST);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ClassifierError);
    // The body is the PROVIDER's text and is quoted — a body that echoes the
    // credential (whole, or a 12+ character run of it) is redacted before
    // the quote, so the key never reaches a log through this path either.
    const message = (caught as Error).message;
    expect(message.startsWith('typesafe: HTTP 401')).toBe(true);
    expect(message).not.toContain(KEY);
    expect(message).not.toContain(KEY.slice(4, 20));
    expect(message).toContain('[redacted]');
    vi.unstubAllGlobals();
    stubFetch([
      () => {
        throw new Error('ECONNRESET');
      },
    ]);
    await expect(build().classify(REQUEST)).rejects.toMatchObject({
      name: 'ClassifierError',
      message: expect.not.stringContaining(KEY),
      retryable: false,
    });
  });

  it('a fetch that never resolves is cut by `timeout` after ONE attempt: a ClassifierError, not retryable', async () => {
    // A stub that never resolves on its own and, like a real fetch, rejects
    // only when the signal the adapter passed it is aborted.
    const impl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', impl);
    const startedAt = Date.now();
    await expect(build({ timeout: 20, maxRetries: 3 }).classify(REQUEST)).rejects.toMatchObject({
      name: 'ClassifierError',
      message: 'typesafe: request failed — timeout',
      retryable: false,
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(impl).toHaveBeenCalledTimes(1);
    const err = await build({ timeout: 20 })
      .classify(REQUEST)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClassifierError);
    expect((err as ClassifierError).status).toBeUndefined();
  });

  it("an aborted signal rejects with the caller's reason, not a ClassifierError", async () => {
    stubFetch([json(PROBE_RESPONSE)]);
    const controller = new AbortController();
    controller.abort(new Error('run cancelled'));
    await expect(build().classify(REQUEST, controller.signal)).rejects.toThrow('run cancelled');
  });

  it('an abort during a backoff wait ends the call', async () => {
    stubFetch([text('rate limited', 429)]);
    const controller = new AbortController();
    const pending = build({ maxRetries: 3, retryDelayMs: 10_000 }).classify(
      REQUEST,
      controller.signal,
    );
    await new Promise((r) => setTimeout(r, 5));
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });
});
