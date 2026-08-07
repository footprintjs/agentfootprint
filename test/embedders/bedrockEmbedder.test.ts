/**
 * bedrockEmbedder (8.19.0) — Titan Text Embeddings V2 through the AWS SDK.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * Every test here injects a client. NOTHING in this file reaches AWS, needs a
 * credential, or installs the SDK — the `_client` seam exists so an adapter
 * can be exercised without an account, the same way every other vendor
 * adapter in this repo is.
 *
 * The load-bearing claim is the ID. Titan V2 at 512 dimensions and Titan V2 at
 * 1024 are different embedding spaces from one model id, and `embeddingModel`
 * (the only thing `SearchOptions.embedderId` filters on) stores the id ALONE.
 * An id without the size cannot separate them; the size without the model
 * cannot either, because V1 and V2 both answer at 1024.
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

  it('two models at the SAME size are two ids — V1 and V2 both answer at 1024', () => {
    const v2 = bedrockEmbedder({ _client: fakeBedrock().client, dimensions: 1024 });
    const v1 = bedrockEmbedder({
      _client: fakeBedrock().client,
      model: 'amazon.titan-embed-text-v1',
      dimensions: 1024,
    });
    expect(v1.id).not.toBe(v2.id);
    // Neither the model nor the size alone separates all four combinations;
    // together they do, which is why both are in the id.
    expect(v1.id).toContain('amazon.titan-embed-text-v1');
    expect(v2.id).toContain('amazon.titan-embed-text-v2');
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
    expect(() => bedrockEmbedder({ model: 'cohere.embed-english-v3' })).toThrow(/unknown model/);
  });

  it('accepts an unknown model once it says its own size', () => {
    const e = bedrockEmbedder({
      model: 'cohere.embed-english-v3',
      dimensions: 1024,
      _client: fakeBedrock().client,
    });
    expect(e.dimensions).toBe(1024);
  });

  it('refuses a size Titan V2 does not produce', () => {
    expect(() => bedrockEmbedder({ dimensions: 768 })).toThrow(/1024, 512, 256/);
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
