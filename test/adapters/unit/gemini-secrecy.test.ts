/**
 * THE GEMINI KEY-SECRECY PIN (9.13.0).
 *
 * One of Gemini's two doors is an API KEY — a bearer secret that is enough, on
 * its own, to spend somebody's quota. It is handed to `gemini({ apiKey })` and
 * `geminiEmbedder({ apiKey })`, both of which are lined with refusals, and
 * both of whose failures reach a model and an observability sink: a thrown
 * provider error becomes the run's failure, lands in the commit log and the
 * narrative, and is serialized by every attached recorder. One interpolation is
 * a leak to all of them at once.
 *
 * The suite is the vault adapter's, applied to this path:
 *   P1 every construction and call failure, with the key placed where each one
 *      could plausibly pick it up — including an SDK that echoes the request it
 *      just sent, which is how a real client reports a transport failure.
 *   P2 the refusals still SAY something: the door, the option, the fix. A
 *      redaction that also deletes the teaching is a worse bug than the leak.
 *   P3 through the framework — the thrown error, the snapshot, the narrative
 *      and every emitted event payload.
 *   P4 the positive control: the key really is used, so a suite that would pass
 *      with the feature deleted is not what is being run here.
 *
 * Nothing here reaches Google.
 */

import { describe, expect, it } from 'vitest';

import { gemini, type GeminiClientLike } from '../../../src/adapters/llm/GeminiProvider.js';
import { geminiEmbedder } from '../../../src/embedders/index.js';
import { Agent } from '../../../src/index.js';

/** The secret. Nothing in this file may echo it. */
const API_KEY = 'AIzaSyD-THE-REAL-GEMINI-KEY-do-not-print-me';

/** Everything a failure can carry into a log: message, name, stack, and the
 *  JSON somebody's error handler will call on it. */
async function failureStrings(run: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await run();
    return '';
  } catch (err) {
    const e = err as Error;
    return [e.message, e.name, e.stack ?? '', JSON.stringify(e, Object.getOwnPropertyNames(e))]
      .filter(Boolean)
      .join('\n');
  }
}

// ── P1 — every failure path ──────────────────────────────────────────

describe('P1 no failure path prints the API key', () => {
  it('not on any of the ways a Gemini call can fail', async () => {
    /** A client that fails the way a real one does: by echoing its own config. */
    const echoing = (): GeminiClientLike => ({
      models: {
        generateContent: (params) =>
          Promise.reject(
            new Error(
              `connect ECONNREFUSED — request was ${JSON.stringify({
                ...params,
                apiKey: API_KEY,
              })}`,
            ),
          ),
        generateContentStream: () =>
          Promise.reject(Object.assign(new Error('401 Unauthorized'), { status: 401 })),
      },
    });

    const request = { model: 'gemini', messages: [{ role: 'user' as const, content: 'hi' }] };
    // `defaultModel` is not decoration: since 9.29.0 the key door has NO
    // default model, so a provider without one refuses the shorthand before it
    // ever reaches the client — and a refusal carrying no key would pass every
    // assertion below while proving nothing. See the reach check after the loop.
    const keyDoor = (): ReturnType<typeof gemini> =>
      gemini({ apiKey: API_KEY, defaultModel: 'gemini-2.5-flash', _client: echoing() });
    const failures = await Promise.all([
      // The provider was built WITH the key and the call failed.
      failureStrings(() => keyDoor().complete(request)),
      failureStrings(async () => {
        for await (const _c of keyDoor().stream!(request)) {
          /* drain */
        }
      }),
      // The key is present but the OTHER half of the configuration contradicts
      // it — the refusal that names Vertex.
      failureStrings(() => gemini({ apiKey: API_KEY, vertexai: true })),
      // The embedder's construction refusals, with a key in hand.
      failureStrings(() => geminiEmbedder({ apiKey: API_KEY, model: 'not-a-model-we-know' })),
      failureStrings(() =>
        geminiEmbedder({ apiKey: API_KEY, model: 'gemini-embedding-2', taskType: 'CLUSTERING' }),
      ),
      // And its read-side refusals, which describe a response SHAPE.
      failureStrings(() =>
        geminiEmbedder({
          apiKey: API_KEY,
          _client: { models: { embedContent: () => Promise.resolve({ embeddings: [] }) } },
        }).embed({ text: 'x' }),
      ),
      failureStrings(() =>
        geminiEmbedder({
          apiKey: API_KEY,
          _client: {
            models: {
              embedContent: () =>
                Promise.resolve({
                  embeddings: [{ values: [1, 2, 3], statistics: { truncated: true } }],
                }),
            },
          },
          dimensions: 3,
        }).embed({ text: 'a very long passage' }),
      ),
    ]);

    // Every one of them FAILED (a passing call proves nothing about leaks)…
    for (const [index, text] of failures.entries()) {
      expect(text, `case ${index} did not fail`).not.toBe('');
    }
    // …and the two call cases failed AT THE CLIENT, not at a guard in front of
    // it. This is what stops the first two assertions from going vacuous the
    // next time a refusal moves earlier in the call.
    expect(failures[0], 'the complete() case never reached the client').toContain('ECONNREFUSED');
    expect(failures[1], 'the stream() case never reached the client').toContain('401');
    // …and not one of them printed the key.
    for (const [index, text] of failures.entries()) {
      expect(text, `case ${index} leaked the API key`).not.toContain(API_KEY);
    }
  });
});

// ── P2 — the refusals still teach ────────────────────────────────────

describe('P2 the refusals name the door, the option and the fix', () => {
  it('the two-door refusal names both doors and both environment variables', () => {
    expect(() => gemini({ apiKey: API_KEY, vertexai: true })).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(() => gemini({ apiKey: API_KEY, vertexai: true })).toThrow(/addressed by PROJECT/);
  });

  it("the embedder's unknown-model refusal names the option that fixes it", () => {
    expect(() => geminiEmbedder({ apiKey: API_KEY, model: 'mystery-embed' })).toThrow(
      /Pass \{ dimensions \}/,
    );
  });

  it('the truncation refusal names both fixes, not just the failure', async () => {
    const embedder = geminiEmbedder({
      apiKey: API_KEY,
      dimensions: 3,
      _client: {
        models: {
          embedContent: () =>
            Promise.resolve({
              embeddings: [{ values: [1, 2, 3], statistics: { truncated: true } }],
            }),
        },
      },
    });
    await expect(embedder.embed({ text: 'x'.repeat(50_000) })).rejects.toThrow(/maxChunkChars/);
    await expect(embedder.embed({ text: 'x'.repeat(50_000) })).rejects.toThrow(
      /onTruncation: 'allow'/,
    );
  });
});

// ── P3 — through the framework ───────────────────────────────────────

describe('P3 nothing the framework records carries the key', () => {
  it('not the thrown error, the snapshot, the narrative, or any event payload', async () => {
    const events: unknown[] = [];
    const failing: GeminiClientLike = {
      models: {
        generateContent: (params) =>
          Promise.reject(new Error(`upstream said no — sent ${JSON.stringify(params)}`)),
        generateContentStream: (params) =>
          Promise.reject(new Error(`upstream said no — sent ${JSON.stringify(params)}`)),
      },
    };
    const agent = Agent.create({
      // `defaultModel` for the same reason as P1: on the key door the bare
      // 'gemini' shorthand is refused before the client is reached, and this
      // case is about what the CLIENT's failure carries through the framework.
      provider: gemini({ apiKey: API_KEY, defaultModel: 'gemini-2.5-flash', _client: failing }),
      model: 'gemini',
    }).build();
    agent.on('*', (event: unknown) => {
      events.push(event);
    });

    const thrown = await failureStrings(() => agent.run({ message: 'hello' }));
    expect(thrown).not.toBe('');
    // The run failed where this case means it to — inside the client.
    expect(thrown, 'the run never reached the client').toContain('upstream said no');

    const everything = [
      thrown,
      JSON.stringify(events),
      JSON.stringify(agent.getSnapshot?.() ?? {}),
      agent.getNarrative?.() ?? '',
    ].join('\n');
    expect(everything).not.toContain(API_KEY);
  });
});

// ── P4 — the positive control ────────────────────────────────────────

describe('P4 the key is genuinely in use', () => {
  it('a key alone is enough to construct the Gemini-API door', () => {
    // If this threw, every assertion above would be vacuously true: a key that
    // configures nothing cannot leak.
    expect(() => gemini({ apiKey: API_KEY })).not.toThrow();
    expect(() => geminiEmbedder({ apiKey: API_KEY })).not.toThrow();
  });

  it('and it is never re-exposed on the provider it built', () => {
    const provider = gemini({ apiKey: API_KEY });
    expect(JSON.stringify(provider, Object.getOwnPropertyNames(provider))).not.toContain(API_KEY);
  });
});
