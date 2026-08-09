/**
 * bedrockEmbedder (8.19.0) — Titan and Cohere embeddings through the AWS SDK.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * Every test here injects a client. NOTHING in this file reaches AWS, needs a
 * credential, or installs the SDK — the `_client` seam exists so an adapter
 * can be exercised without an account, the same way every other vendor
 * adapter in this repo is.
 *
 * Two load-bearing claims:
 *
 *   1. **The ID.** Titan V2 at 512 dimensions and Titan V2 at 1024 are
 *      different embedding spaces from one model id, and `embeddingModel` (the
 *      only thing `SearchOptions.embedderId` filters on) stores the id ALONE.
 *      An id without the size cannot separate them; the size without the model
 *      cannot either, because Titan V2 and Cohere v3 both answer at 1024.
 *   2. **The BODY SHAPE (9.3.0).** `InvokeModel` is one operation over
 *      vendor-specific JSON, so the model id selects a family and the family
 *      owns the request, the response and the batching. The tests that pin
 *      this are the ones a mock cannot fake honestly — they assert what would
 *      have reached Bedrock, byte for byte.
 */

import { describe, expect, it } from 'vitest';

import { bedrockEmbedder } from '../../src/embedders/index.js';
import { InMemoryStore } from '../../src/memory/index.js';
import { indexDocuments } from '../../src/index.js';

/** A Bedrock runtime double: records what was sent, answers a fixed vector. */
function fakeBedrock(vector: number[] = [0.1, 0.2, 0.3]) {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    client: {
      send: async (command: unknown): Promise<unknown> => {
        sent.push(command as Record<string, unknown>);
        return {
          body: new TextEncoder().encode(
            JSON.stringify({ embedding: vector, inputTextTokenCount: 4 }),
          ),
        };
      },
    },
  };
}

/** The request body as it would have reached Bedrock. */
function bodyOf(command: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(String(command['body'])) as Record<string, unknown>;
}

// ─── Unit — one call, one vector ───────────────────────────────────

describe('bedrockEmbedder — unit', () => {
  it('embeds one text through InvokeModel and returns the vector', async () => {
    const bedrock = fakeBedrock([0.5, 0.6]);
    const e = bedrockEmbedder({ _client: bedrock.client, dimensions: 512 });
    expect(await e.embed({ text: 'refund policy' })).toEqual([0.5, 0.6]);
    expect(bedrock.sent).toHaveLength(1);
    expect(bedrock.sent[0]?.['modelId']).toBe('amazon.titan-embed-text-v2:0');
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)['inputText']).toBe('refund policy');
  });

  it('defaults to Titan V2 at its native 1024 and sends NO dimensions field', async () => {
    const bedrock = fakeBedrock();
    const e = bedrockEmbedder({ _client: bedrock.client });
    expect(e.dimensions).toBe(1024);
    await e.embed({ text: 'hello' });
    // A caller who asked for nothing gets the request body Bedrock's own
    // default produces — nothing invented on their behalf.
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)).not.toHaveProperty('dimensions');
  });

  it('an explicit size is SENT and REPORTED — the two cannot disagree', async () => {
    const bedrock = fakeBedrock();
    const e = bedrockEmbedder({ _client: bedrock.client, dimensions: 256 });
    expect(e.dimensions).toBe(256);
    await e.embed({ text: 'hello' });
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)['dimensions']).toBe(256);
  });

  it('embedBatch is N calls, one row per input, in order', async () => {
    const bedrock = fakeBedrock([1, 2]);
    const e = bedrockEmbedder({ _client: bedrock.client });
    const rows = await e.embedBatch!({ texts: ['a', 'b', 'c'] });
    expect(rows).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    expect(bedrock.sent).toHaveLength(3);
    expect(bedrock.sent.map((c) => bodyOf(c)['inputText'])).toEqual(['a', 'b', 'c']);
  });

  it('an abort signal reaches the SDK, and stops a batch at the next boundary', async () => {
    const options: ({ abortSignal?: AbortSignal } | undefined)[] = [];
    const controller = new AbortController();
    const e = bedrockEmbedder({
      _client: {
        send: async (_command: unknown, opts?: { abortSignal?: AbortSignal }) => {
          options.push(opts);
          controller.abort(); // the caller gives up while the first call is in flight
          return { body: JSON.stringify({ embedding: [1] }) };
        },
      },
    });
    await expect(
      e.embedBatch!({ texts: ['a', 'b', 'c'], signal: controller.signal }),
    ).rejects.toThrow();
    // One call made, two never billed.
    expect(options).toHaveLength(1);
    expect(options[0]?.abortSignal).toBe(controller.signal);
  });
});

// ─── Boundary — the identity of an embedding space ─────────────────

describe('bedrockEmbedder — the id names the SPACE', () => {
  it('two sizes of ONE model are two ids', () => {
    const at512 = bedrockEmbedder({ _client: fakeBedrock().client, dimensions: 512 });
    const at1024 = bedrockEmbedder({ _client: fakeBedrock().client, dimensions: 1024 });
    expect(at512.id).not.toBe(at1024.id);
    expect(at512.id).toContain('512');
    expect(at1024.id).toContain('1024');
  });

  it('two models at the SAME size are two ids — Titan V2 and Cohere v3 both answer at 1024', () => {
    const titan = bedrockEmbedder({ _client: fakeBedrock().client, dimensions: 1024 });
    const cohere = bedrockEmbedder({
      _client: fakeBedrock().client,
      model: 'cohere.embed-english-v3',
    });
    expect(titan.dimensions).toBe(cohere.dimensions);
    expect(titan.id).not.toBe(cohere.id);
    // Neither the model nor the size alone separates all the combinations;
    // together they do, which is why both are in the id.
    expect(titan.id).toContain('amazon.titan-embed-text-v2');
    expect(cohere.id).toContain('cohere.embed-english-v3');
  });

  it('the same configuration is the same id — an id is a SPACE, not an instance', () => {
    const a = bedrockEmbedder({ _client: fakeBedrock().client, dimensions: 512 });
    const b = bedrockEmbedder({
      _client: fakeBedrock().client,
      dimensions: 512,
      region: 'eu-west-1',
    });
    expect(a.id).toBe(b.id);
  });
});

// ─── Scenario — an SDK module, exercised through the real shim ─────

describe('bedrockEmbedder — scenario', () => {
  it('builds a client from an injected SDK module and passes the region', async () => {
    const built: { region?: string }[] = [];
    const commands: unknown[] = [];
    const e = bedrockEmbedder({
      region: 'us-east-1',
      _sdk: {
        BedrockRuntimeClient: class {
          constructor(config: { region?: string }) {
            built.push(config);
          }
          async send(command: unknown): Promise<unknown> {
            commands.push(command);
            return { body: JSON.stringify({ embedding: [7, 8] }) };
          }
        },
        InvokeModelCommand: class {
          constructor(input: unknown) {
            Object.assign(this, input);
          }
        },
      },
    });
    expect(await e.embed({ text: 'hi' })).toEqual([7, 8]);
    expect(built).toEqual([{ region: 'us-east-1' }]);
    expect(commands).toHaveLength(1);
  });

  it('a pre-built client is used as given — one SDK config for the whole app', async () => {
    const bedrock = fakeBedrock([3]);
    const e = bedrockEmbedder({
      client: bedrock.client,
      _sdk: {
        InvokeModelCommand: class {
          constructor(input: unknown) {
            Object.assign(this, input);
          }
        },
      },
      dimensions: 256,
    });
    expect(await e.embed({ text: 'hi' })).toEqual([3]);
    expect(bedrock.sent).toHaveLength(1);
  });

  it('reads the response whether the body arrives as bytes, a string, or an object', async () => {
    const shapes: unknown[] = [
      { body: new TextEncoder().encode(JSON.stringify({ embedding: [1] })) },
      { body: JSON.stringify({ embedding: [1] }) },
      { body: { embedding: [1] } },
      { embedding: [1] },
    ];
    for (const response of shapes) {
      const e = bedrockEmbedder({ _client: { send: async () => response } });
      expect(await e.embed({ text: 'x' })).toEqual([1]);
    }
  });
});

// ─── Property — the client is built once, not per call ─────────────

describe('bedrockEmbedder — property', () => {
  it('the SDK client is constructed once and reused across every embed', async () => {
    let constructed = 0;
    const e = bedrockEmbedder({
      _sdk: {
        BedrockRuntimeClient: class {
          constructor() {
            constructed += 1;
          }
          async send(): Promise<unknown> {
            return { body: JSON.stringify({ embedding: [1] }) };
          }
        },
        InvokeModelCommand: class {
          constructor(input: unknown) {
            Object.assign(this, input);
          }
        },
      },
    });
    await e.embed({ text: 'a' });
    await e.embed({ text: 'b' });
    await e.embedBatch!({ texts: ['c', 'd'] });
    expect(constructed).toBe(1);
  });

  it('constructing the embedder touches no SDK and no network at all', () => {
    // No `_client`, no `_sdk`, no peer dep in this repo's test env: if the
    // factory loaded anything eagerly, this line would throw.
    expect(() => bedrockEmbedder({ region: 'us-east-1' })).not.toThrow();
  });
});

// ─── Security — a refusal describes, never quotes ──────────────────

describe('bedrockEmbedder — security', () => {
  it('an unreadable response is described by SHAPE, never by content', async () => {
    const secret = 'PATIENT SSN 123-45-6789';
    const e = bedrockEmbedder({
      _client: { send: async () => ({ body: JSON.stringify({ outputText: secret }) }) },
    });
    const message = await e.embed({ text: 'x' }).then(
      () => '',
      (err: unknown) => String(err),
    );
    expect(message).toMatch(/no `embedding` array/);
    expect(message).toMatch(/keys: outputText/);
    expect(message).not.toContain(secret);
  });
});

// ─── Refusal — what it will not guess ──────────────────────────────

describe('bedrockEmbedder — refusal', () => {
  it('refuses an unknown model rather than guessing its vector length', () => {
    expect(() => bedrockEmbedder({ model: 'my-provisioned-deployment' })).toThrow(/unknown model/);
  });

  it('accepts an unknown model once it says its own size', () => {
    const e = bedrockEmbedder({
      model: 'my-provisioned-deployment',
      dimensions: 768,
      _client: fakeBedrock().client,
    });
    expect(e.dimensions).toBe(768);
  });

  it('refuses a size Titan V2 does not produce', () => {
    expect(() => bedrockEmbedder({ dimensions: 768 })).toThrow(/1024, 512, 256/);
  });

  it('refuses a size a FIXED-size model does not produce (9.3.0)', () => {
    // Titan V1 answers at 1536 and takes no size parameter. Accepting 1024
    // here would report a length that never comes back — and `.dimensions` is
    // what a store fingerprints on.
    expect(() =>
      bedrockEmbedder({ model: 'amazon.titan-embed-text-v1', dimensions: 1024 }),
    ).toThrow(/takes no size parameter/);
    expect(() => bedrockEmbedder({ model: 'cohere.embed-english-v3', dimensions: 512 })).toThrow(
      /takes no size parameter/,
    );
  });

  it('refuses a `family` that contradicts the model id', () => {
    expect(() => bedrockEmbedder({ model: 'cohere.embed-english-v3', family: 'titan' })).toThrow(
      /is a cohere model/,
    );
  });

  it('refuses a response that carries no embedding rather than returning []', async () => {
    const e = bedrockEmbedder({
      _client: { send: async () => ({ body: '{"embedding":"nope"}' }) },
    });
    await expect(e.embed({ text: 'x' })).rejects.toThrow(/no `embedding` array/);
  });

  it('names the missing peer dependency when there is no SDK and no client', async () => {
    const e = bedrockEmbedder({ region: 'us-east-1' });
    await expect(e.embed({ text: 'x' })).rejects.toThrow(
      /@aws-sdk\/client-bedrock-runtime peer dependency|`@aws-sdk\/client-bedrock-runtime` peer dependency/,
    );
  });
});

// ─── The body-shape registry (9.3.0) ───────────────────────────────
//
// `InvokeModel` is ONE operation over vendor-specific JSON. Until 9.3.0 this
// factory sent Titan's body to every model, so a Cohere model id constructed
// fine and failed at the first embed — against the real service, with a
// validation error from AWS rather than a sentence from here.

/** A Cohere-shaped Bedrock double: records what was sent, answers `embeddings`. */
function fakeCohere(vector: number[] = [0.1, 0.2]) {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    client: {
      send: async (command: unknown): Promise<unknown> => {
        const cmd = command as Record<string, unknown>;
        sent.push(cmd);
        const body = JSON.parse(String(cmd['body'])) as { texts: string[] };
        return {
          body: new TextEncoder().encode(
            JSON.stringify({
              embeddings: body.texts.map(() => vector),
              response_type: 'embeddings_floats',
            }),
          ),
        };
      },
    },
  };
}

describe('bedrockEmbedder — one operation, two body shapes', () => {
  it('a Cohere model sends { texts, input_type } and reads `embeddings`', async () => {
    const bedrock = fakeCohere([0.7, 0.8]);
    const e = bedrockEmbedder({ model: 'cohere.embed-english-v3', _client: bedrock.client });
    expect(await e.embed({ text: 'refund policy' })).toEqual([0.7, 0.8]);
    const body = bodyOf(bedrock.sent[0] as Record<string, unknown>);
    expect(body['texts']).toEqual(['refund policy']);
    expect(body).not.toHaveProperty('inputText');
  });

  it('a Titan model still sends { inputText } and reads `embedding`', async () => {
    const bedrock = fakeBedrock([0.5]);
    const e = bedrockEmbedder({ _client: bedrock.client });
    expect(await e.embed({ text: 'hi' })).toEqual([0.5]);
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)).not.toHaveProperty('texts');
  });

  it('a QUERY and a DOCUMENT are told apart — Cohere embeds them differently', async () => {
    const bedrock = fakeCohere();
    const e = bedrockEmbedder({ model: 'cohere.embed-multilingual-v3', _client: bedrock.client });
    // One text is this library's query shape (loadRelevant embeds the question).
    await e.embed({ text: 'how do refunds work?' });
    // Many texts is its document shape (indexDocuments, embedMessages).
    await e.embedBatch!({ texts: ['Refunds take 3 days.', 'Returns are free.'] });
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)['input_type']).toBe('search_query');
    expect(bodyOf(bedrock.sent[1] as Record<string, unknown>)['input_type']).toBe(
      'search_document',
    );
  });

  it('`inputType` pins both calls for code whose shapes differ', async () => {
    const bedrock = fakeCohere();
    const e = bedrockEmbedder({
      model: 'cohere.embed-english-v3',
      inputType: 'search_document',
      _client: bedrock.client,
    });
    await e.embed({ text: 'one passage, not a question' });
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)['input_type']).toBe(
      'search_document',
    );
  });

  it('Cohere batches at 96 per call; Titan is one call per text', async () => {
    const texts = Array.from({ length: 200 }, (_, i) => `chunk ${String(i)}`);

    const cohere = fakeCohere([1]);
    const c = bedrockEmbedder({ model: 'cohere.embed-english-v3', _client: cohere.client });
    const cohereRows = await c.embedBatch!({ texts });
    expect(cohereRows).toHaveLength(200);
    expect(cohere.sent).toHaveLength(3); // 96 + 96 + 8
    expect(bodyOf(cohere.sent[0] as Record<string, unknown>)['texts'] as string[]).toHaveLength(96);

    const titan = fakeBedrock([1]);
    const t = bedrockEmbedder({ _client: titan.client });
    expect(await t.embedBatch!({ texts })).toHaveLength(200);
    expect(titan.sent).toHaveLength(200);
  });

  it('reads Cohere typed embeddings — { embeddings: { float: [...] } }', async () => {
    const e = bedrockEmbedder({
      model: 'cohere.embed-english-v3',
      _client: { send: async () => ({ body: JSON.stringify({ embeddings: { float: [[9]] } }) }) },
    });
    expect(await e.embed({ text: 'x' })).toEqual([9]);
  });

  it('an id that WRAPS a known model resolves to that model', () => {
    // A cross-region inference profile and an ARN both end in the model id
    // they route to, so containment resolves them exactly — this used to be
    // refused as an unknown model.
    const profile = bedrockEmbedder({ model: 'us.amazon.titan-embed-text-v2:0' });
    expect(profile.dimensions).toBe(1024);
    expect(profile.maxInputChars).toBe(32000);
    const arn = bedrockEmbedder({
      model: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/cohere.embed-english-v3',
    });
    expect(arn.dimensions).toBe(1024);
    expect(arn.maxInputChars).toBe(2000);
  });

  it('a wrapped Titan V2 profile still SENDS the requested size', async () => {
    // The failure this prevents: the size is validated and reported but never
    // sent, so the model answers 1024 while `.dimensions` says 512.
    const bedrock = fakeBedrock();
    const e = bedrockEmbedder({
      model: 'us.amazon.titan-embed-text-v2:0',
      dimensions: 512,
      _client: bedrock.client,
    });
    await e.embed({ text: 'x' });
    expect(bodyOf(bedrock.sent[0] as Record<string, unknown>)['dimensions']).toBe(512);
  });

  it('an unknown model gets the body every earlier release sent, and `family` overrides it', async () => {
    const titanShaped = fakeBedrock([1]);
    const legacy = bedrockEmbedder({
      model: 'my-provisioned-deployment',
      dimensions: 768,
      _client: titanShaped.client,
    });
    await legacy.embed({ text: 'x' });
    expect(bodyOf(titanShaped.sent[0] as Record<string, unknown>)).toHaveProperty('inputText');

    const cohereShaped = fakeCohere([1]);
    const declared = bedrockEmbedder({
      model: 'my-provisioned-deployment',
      dimensions: 768,
      family: 'cohere',
      _client: cohereShaped.client,
    });
    await declared.embed({ text: 'x' });
    expect(bodyOf(cohereShaped.sent[0] as Record<string, unknown>)).toHaveProperty('texts');
  });

  it('names `family` when an UNKNOWN model answered a shape it could not read', async () => {
    // The one case where the response is valid and the guess was wrong: only
    // this refusal can say so, so it names the option that fixes it.
    const e = bedrockEmbedder({
      model: 'my-provisioned-deployment',
      dimensions: 1024,
      _client: { send: async () => ({ body: JSON.stringify({ embeddings: [[1]] }) }) },
    });
    await expect(e.embed({ text: 'x' })).rejects.toThrow(/pass `family: 'cohere'`/);
  });

  it('refuses a short answer rather than pairing vectors with the wrong texts', async () => {
    const e = bedrockEmbedder({
      model: 'cohere.embed-english-v3',
      _client: { send: async () => ({ body: JSON.stringify({ embeddings: [[1]] }) }) },
    });
    await expect(e.embedBatch!({ texts: ['a', 'b', 'c'] })).rejects.toThrow(
      /3 text\(s\) and answered with 1 vector\(s\)/,
    );
  });

  it('the id names the SPACE across families — same size, different model', () => {
    const cohere = bedrockEmbedder({ model: 'cohere.embed-english-v3' });
    const titan = bedrockEmbedder({ dimensions: 1024 });
    expect(cohere.dimensions).toBe(titan.dimensions);
    expect(cohere.id).not.toBe(titan.id);
    expect(cohere.id).toBe('bedrock:cohere.embed-english-v3:1024');
  });
});

// ─── Integration — it is an Embedder, so it indexes a corpus ───────

describe('bedrockEmbedder — integration', () => {
  it('indexes a corpus, and the stored fingerprint carries model AND size', async () => {
    const store = new InMemoryStore();
    const e = bedrockEmbedder({ _client: fakeBedrock([0.1, 0.2]).client, dimensions: 512 });
    await indexDocuments(store, e, [
      { id: 'refunds.md#0', content: 'Refunds take 3 business days.' },
    ]);
    const page = await store.list({ conversationId: '_global' });
    expect(page.entries[0]?.embeddingModel).toBe('bedrock:amazon.titan-embed-text-v2:0:512');
    expect(page.entries[0]?.embedding).toEqual([0.1, 0.2]);
  });
});
