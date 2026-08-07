/**
 * agentfootprint/embedders — ready-made {@link Embedder} implementations for the
 * embedding-backed scorers (memory retrieval, toolChoiceRecorder / scoreMargin).
 *
 * The core deliberately ships only `mockEmbedder` (bring-your-own). These are
 * OPTIONAL and never pulled into the core: each heavy backend is an OPTIONAL
 * PEER DEPENDENCY, imported LAZILY on first embed, so you install ONLY the one
 * you use and agentfootprint stays dependency-free.
 *
 *   openaiEmbedder()  — hosted; needs OPENAI_API_KEY; no extra install (fetch).
 *   bedrockEmbedder() — hosted on AWS; Titan Text Embeddings V2; credentials
 *                       come from the AWS chain, so no key option at all.
 *                       peer dep: @aws-sdk/client-bedrock-runtime.
 *   localEmbedder()   — on-device sentence-transformer; no key; offline after a
 *                       one-time model fetch. peer dep: @huggingface/transformers.
 *   staticEmbedder()  — pure-JS Model2Vec static vectors; no key, no network
 *                       (weights bundled). peer dep: @yarflam/potion-base-8m.
 *
 * All four satisfy the same `Embedder` shape, so they drop into
 * `toolChoiceRecorder({ embedder })` / `semanticPipeline({ embedder })` etc.
 * unchanged. Dimensions differ per model — never mix two in one store.
 *
 * ─── Bundlers / browsers: pass `backend` ────────────────────────────────
 *
 * The lazy `import(spec)` above keeps the peer deps optional, but a BUNDLER
 * cannot see through a variable specifier: the bare name survives into the
 * output and the browser throws
 * `TypeError: Failed to resolve module specifier '@huggingface/transformers'`
 * at first embed. So both on-device factories also accept an ALREADY-IMPORTED
 * module — a static import your own bundler resolves:
 *
 *   import * as transformers from '@huggingface/transformers';
 *   const embedder = localEmbedder({ backend: transformers });
 *
 * Same mechanism as the `client` option on the store adapters (RedisStore,
 * AgentCoreStore): the library states the surface it needs, the host owns the
 * construction. Nothing changes for Node callers who pass nothing.
 *
 * @deprecated Since 8.0.0 — import from `agentfootprint/providers` instead.
 * This path keeps working for all of 8.x and is removed in 9.0.0. Every name
 * here is the same symbol on the new door, not a copy.
 */
export type { Embedder } from '../memory/embedding/types.js';
import type { Embedder } from '../memory/embedding/types.js';
import { lazyRequire } from '../lib/lazyRequire.js';

// ---------------------------------------------------------------------------
// OpenAI (hosted) — no extra dependency, just a fetch + an API key.
// ---------------------------------------------------------------------------

export interface OpenAIEmbedderOptions {
  /** Default: process.env.OPENAI_API_KEY. */
  readonly apiKey?: string;
  /** Default: 'text-embedding-3-small'. */
  readonly model?: string;
  /**
   * Shorten the vectors the model returns (OpenAI's Matryoshka truncation).
   *
   * When set, the value is SENT as the `dimensions` request parameter AND
   * reported as `.dimensions` — the two can never disagree. Only supported on
   * `text-embedding-3` and later models; ada-002 rejects it, which is exactly
   * why nothing is sent unless you ask.
   *
   * Leave it unset to get the model's native size (looked up from
   * {@link NATIVE_DIMENSIONS}). Required for a model this library doesn't know
   * — see {@link openaiEmbedder}.
   */
  readonly dimensions?: number;
  /** Override the API base (Azure/OpenAI-compatible gateways). */
  readonly baseURL?: string;
}

/**
 * Native output size of every OpenAI embedding model, so `.dimensions` reports
 * the truth instead of one hard-coded guess.
 *
 * Sources: OpenAI embeddings guide — text-embedding-3-small "By default, the
 * length of the embedding vector is 1536", text-embedding-3-large "3072"
 * (https://developers.openai.com/api/docs/guides/embeddings); Microsoft Learn's
 * Azure OpenAI model table, "Output Dimensions" column, for ada-002 = 1,536
 * (https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/models).
 */
const NATIVE_DIMENSIONS: Readonly<Record<string, number>> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * OpenAI's hosted embeddings endpoint.
 *
 * `.dimensions` is the length callers WILL get back, never an assumption:
 * an explicit `{ dimensions }` is sent to the API and reported; otherwise the
 * model's documented native size is reported. A model outside
 * {@link NATIVE_DIMENSIONS} (a gateway, a self-hosted model behind `baseURL`,
 * an Azure deployment name, a future OpenAI model) has no size this library can
 * know, so it is a construction-time error rather than a guess that a vector
 * store would silently trust.
 *
 * @throws if there is no API key, or if `model` is unknown and `dimensions`
 *         was not supplied.
 */
export function openaiEmbedder(options: OpenAIEmbedderOptions = {}): Embedder {
  const apiKey =
    options.apiKey ??
    (typeof process !== 'undefined' ? process.env?.['OPENAI_API_KEY'] : undefined);
  if (!apiKey || !apiKey.trim()) {
    throw new Error('openaiEmbedder: no API key — set OPENAI_API_KEY or pass { apiKey }.');
  }
  const model = options.model ?? 'text-embedding-3-small';
  // Only an EXPLICIT request is sent. Defaulting it and sending that would
  // break ada-002 (which rejects the parameter) for callers who asked for
  // nothing — the request body stays byte-identical unless you opt in.
  const requested = options.dimensions;
  const dimensions = requested ?? NATIVE_DIMENSIONS[model];
  if (dimensions === undefined) {
    throw new Error(
      `openaiEmbedder: unknown model '${model}' — its vector length is not something this ` +
        `library can know, and reporting a wrong .dimensions silently corrupts a vector store. ` +
        `Pass { dimensions } with the length that model returns.`,
    );
  }
  const url = `${options.baseURL ?? 'https://api.openai.com/v1'}/embeddings`;

  async function call(input: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        requested === undefined ? { model, input } : { model, input, dimensions: requested },
      ),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`openaiEmbedder: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  return {
    dimensions,
    // The embedding SPACE, not the instance: two `openaiEmbedder()` calls with
    // the same model produce interchangeable vectors, and a store must treat
    // them as one index. The SIZE is deliberately not in here — a store's
    // fingerprint is `'<id>@<dims>'`, so it appends the dimensions itself and
    // a truncated vector is already a different fingerprint from a native one.
    id: `openai:${model}`,
    async embed({ text, signal }) {
      return (await call([text], signal))[0];
    },
    async embedBatch({ texts, signal }) {
      return call([...texts], signal);
    },
  };
}

// ---------------------------------------------------------------------------
// Amazon Bedrock (hosted) — Titan Text Embeddings, via the AWS SDK.
// ---------------------------------------------------------------------------

/**
 * The slice of `@aws-sdk/client-bedrock-runtime` {@link bedrockEmbedder} uses.
 *
 * Structural, so the real SDK, a pre-built client shared with the rest of your
 * app, or a test double all satisfy it without this package taking a hard type
 * dependency on the optional peer.
 */
export interface BedrockRuntimeLikeClient {
  /**
   * `send(command, options?)` — the second argument is where the AWS SDK
   * takes an `abortSignal`, and it is passed whenever the caller supplied
   * one, so an aborted indexing run stops paying for embeddings it will
   * throw away.
   */
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/** The two SDK constructors this embedder needs. */
export interface BedrockRuntimeSdkModule {
  readonly BedrockRuntimeClient?: new (config: { region?: string }) => BedrockRuntimeLikeClient;
  readonly InvokeModelCommand?: new (input: unknown) => unknown;
}

export interface BedrockEmbedderOptions {
  /**
   * Bedrock model id. Default `'amazon.titan-embed-text-v2:0'`.
   *
   * Titan V2 is the one this factory knows the sizes of. Another model (V1,
   * a Cohere embedding model, an inference profile ARN) works, but its
   * output length is not something this library can know — pass
   * `dimensions` with it, the same rule `openaiEmbedder` applies.
   */
  readonly model?: string;
  /**
   * Vector length to request. Titan V2 supports 1024 (default), 512 and 256;
   * the value is SENT to the model AND reported as `.dimensions`, so the two
   * can never disagree.
   *
   * Required for a model outside {@link TITAN_DIMENSIONS} — a wrong
   * `.dimensions` silently corrupts a vector store.
   */
  readonly dimensions?: number;
  /** AWS region. Passed to the SDK client when this factory builds one. */
  readonly region?: string;
  /** A pre-built Bedrock runtime client, so one SDK config serves the whole app. */
  readonly client?: BedrockRuntimeLikeClient;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: BedrockRuntimeLikeClient;
  /** @internal Test injection — the AWS SDK module (exercises the real shim with a mock SDK). */
  readonly _sdk?: BedrockRuntimeSdkModule;
}

/**
 * Default output size per Titan text-embedding model, so `.dimensions` reports
 * the truth rather than one hard-coded guess.
 *
 * Titan Text Embeddings **V2** is configurable — 1024 (default), 512, 256.
 * Titan Embeddings G1 – Text (**V1**) has one size, 1536, and no `dimensions`
 * parameter at all. Every other model on Bedrock (Cohere's, a custom
 * deployment, one released after this version) has a size this library cannot
 * know, so it must state its own rather than be guessed at — the same rule
 * `openaiEmbedder` applies, for the same reason: a store that trusts
 * `.dimensions` and gets a different length back corrupts silently.
 */
const TITAN_DIMENSIONS: Readonly<Record<string, number>> = {
  'amazon.titan-embed-text-v2:0': 1024,
  'amazon.titan-embed-text-v1': 1536,
};

const TITAN_V2_SUPPORTED = [1024, 512, 256];

/**
 * Amazon Bedrock's hosted embeddings, through `InvokeModel`.
 *
 * No API key option, deliberately: Bedrock authenticates through the AWS
 * credential chain (environment, profile, instance role, SSO), and inventing
 * a key parameter would be a second, worse way to configure the same thing.
 *
 * ── Why the id carries the DIMENSION COUNT ───────────────────────────────
 * `openaiEmbedder` deliberately leaves the size out of its id, because a
 * store's fingerprint is `'<id>@<dims>'` and appends it. This one puts it in,
 * and the difference is not an inconsistency — it is the one place the
 * fingerprint cannot reach.
 *
 * `MemoryEntry.embeddingModel` stores the id ALONE, and it is the only thing
 * `SearchOptions.embedderId` filters on: the filter the port describes as
 * preventing "silent cross-model similarity pollution". Titan V2 at 512 and
 * Titan V2 at 1024 are different embedding spaces from one model id, so an id
 * without the size makes those two indistinguishable to that filter — and the
 * size alone cannot separate them either, since V1 and V2 both answer at
 * 1024. Only `'bedrock:<model>:<dims>'` separates all of them. The store's
 * fingerprint then reads `'bedrock:amazon.titan-embed-text-v2:0:512@512'`,
 * which restates the size once; a redundant fingerprint is harmless, and a
 * filter that cannot tell two vector spaces apart is not.
 *
 * (Precedent: `localEmbedder` puts `dtype` in its id for the same reason — a
 * q8 and an fp32 build of one model are near-identical spaces, and "near" is
 * exactly the difference that surfaces as a mysteriously worse ranking.)
 *
 * @throws if `model` is unknown and `dimensions` was not supplied; if
 *         `dimensions` is not one of Titan V2's supported sizes; or if the SDK
 *         is missing and no `client` / `_client` / `_sdk` was passed.
 *
 * @example
 * ```ts
 * import { bedrockEmbedder } from 'agentfootprint/providers';
 * import { sqliteVectorStore } from 'agentfootprint/memory';
 * import { indexFolder } from 'agentfootprint/rag';
 *
 * const embedder = bedrockEmbedder({ region: 'us-east-1', dimensions: 512 });
 * await indexFolder('./docs', { to: sqliteVectorStore({ file: './corpus.db' }), embedder });
 * ```
 */
export function bedrockEmbedder(options: BedrockEmbedderOptions = {}): Embedder {
  const model = options.model ?? 'amazon.titan-embed-text-v2:0';
  const isTitanV2 = model.startsWith('amazon.titan-embed-text-v2');
  const requested = options.dimensions;
  const dimensions = requested ?? TITAN_DIMENSIONS[model];
  if (dimensions === undefined) {
    throw new Error(
      `bedrockEmbedder: unknown model '${model}' — its vector length is not something this ` +
        `library can know, and reporting a wrong .dimensions silently corrupts a vector store. ` +
        `Pass { dimensions } with the length that model returns.`,
    );
  }
  if (isTitanV2 && requested !== undefined && !TITAN_V2_SUPPORTED.includes(requested)) {
    throw new Error(
      `bedrockEmbedder: Titan Text Embeddings V2 returns ${TITAN_V2_SUPPORTED.join(', ')} ` +
        `dimensions — received ${String(requested)}. Asking for a size the model does not ` +
        `produce would store vectors of a length that disagrees with the .dimensions this ` +
        `embedder reports.`,
    );
  }

  type Connection = {
    readonly client: BedrockRuntimeLikeClient;
    readonly Command: new (input: unknown) => unknown;
  };
  let connection: Connection | undefined;

  /**
   * Resolve the client + command constructor, once, on first embed.
   *
   * Three ways in, and the first is what keeps the tests free of AWS:
   *   `_client`  — test injection. The SDK is never required at all, and the
   *                command is a plain object carrying the request, so a
   *                double sees exactly what would have been sent.
   *   `client`   — your own pre-built client. The SDK still has to be
   *                present for `InvokeModelCommand` (you built a client, so
   *                it is), but the config and credentials stay yours.
   *   neither    — this factory builds one from `region`.
   */
  const connect = (): Connection => {
    if (connection) return connection;
    if (options._client) {
      connection = {
        client: options._client,
        Command: options._sdk?.InvokeModelCommand ?? IdentityCommand,
      };
      return connection;
    }
    const sdk = options._sdk ?? loadBedrockRuntimeSdk();
    if (!sdk.InvokeModelCommand) {
      throw new Error(
        'bedrockEmbedder: `@aws-sdk/client-bedrock-runtime` is installed but ' +
          '`InvokeModelCommand` was not found. Update the SDK.',
      );
    }
    if (!options.client && !sdk.BedrockRuntimeClient) {
      throw new Error(
        'bedrockEmbedder: `@aws-sdk/client-bedrock-runtime` is installed but ' +
          '`BedrockRuntimeClient` was not found. Update the SDK.',
      );
    }
    connection = {
      client:
        options.client ??
        // Checked directly above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        new sdk.BedrockRuntimeClient!({ ...(options.region && { region: options.region }) }),
      Command: sdk.InvokeModelCommand,
    };
    return connection;
  };

  /**
   * One text in, one vector out. Titan's `InvokeModel` embeds a SINGLE
   * `inputText` per call — there is no batch operation on the API, so
   * `embedBatch` below is honest about being N calls rather than pretending
   * to a batch discount that does not exist.
   */
  async function invoke(text: string, signal?: AbortSignal): Promise<number[]> {
    const conn = connect();
    const body = JSON.stringify({
      inputText: text,
      // Only an EXPLICIT request is sent. Titan V2 defaults to 1024 on its own
      // side, and V1 rejects the field — so a caller who asked for nothing
      // gets a request body identical to the one before this option existed.
      ...(requested !== undefined && isTitanV2 && { dimensions: requested }),
    });
    const command = new conn.Command({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    });
    const out = await (signal
      ? conn.client.send(command, { abortSignal: signal })
      : conn.client.send(command));
    return readEmbedding(out, model);
  }

  return {
    dimensions,
    // The embedding SPACE, size included — see the note above.
    id: `bedrock:${model}:${dimensions}`,
    async embed({ text, signal }) {
      return invoke(text, signal);
    },
    async embedBatch({ texts, signal }) {
      // Titan has no batch embed operation. Sequential rather than parallel:
      // callers of this path are usually indexing a whole corpus, and
      // `indexCorpus` already fans out over batches with its own bounded
      // parallelism and retry. Racing N more requests inside one of those
      // branches is how a corpus index meets a throttling error.
      //
      // The abort is checked between calls as well as passed into each one,
      // so an aborted batch stops at the next boundary instead of embedding
      // the rest of a corpus nobody is waiting for.
      const out: number[][] = [];
      for (const text of texts) {
        signal?.throwIfAborted();
        out.push(await invoke(text, signal));
      }
      return out;
    },
  };
}

/** A no-op command shim: an injected `_client` receives the raw input object. */
const IdentityCommand = class {
  constructor(input: unknown) {
    Object.assign(this, input);
  }
} as new (input: unknown) => unknown;

function loadBedrockRuntimeSdk(): BedrockRuntimeSdkModule {
  try {
    return lazyRequire<BedrockRuntimeSdkModule>('@aws-sdk/client-bedrock-runtime');
  } catch {
    throw new Error(
      'bedrockEmbedder requires the `@aws-sdk/client-bedrock-runtime` peer dependency.\n' +
        '  Install:  npm install @aws-sdk/client-bedrock-runtime\n' +
        '  Or pass `client` with a pre-built Bedrock runtime client.',
    );
  }
}

/**
 * Pull the vector out of an `InvokeModel` response.
 *
 * The SDK hands back `body` as a `Uint8Array`; a hand-rolled or mock client
 * may hand back the decoded object or a string. All three are read, and
 * anything else is refused by NAME rather than returning an empty vector —
 * an embedder that silently returns `[]` writes a row a store will never
 * rank, which is indistinguishable from "the corpus does not mention that".
 */
function readEmbedding(response: unknown, model: string): number[] {
  const body = (response as { body?: unknown } | null)?.body ?? response;
  let parsed: unknown = body;
  if (body instanceof Uint8Array) {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } else if (typeof body === 'string') {
    parsed = JSON.parse(body);
  }
  const embedding = (parsed as { embedding?: unknown } | null)?.embedding;
  if (!Array.isArray(embedding) || embedding.some((n) => typeof n !== 'number')) {
    throw new Error(
      `bedrockEmbedder: '${model}' returned no \`embedding\` array. Bedrock answered with ` +
        `${describeShape(parsed)}, which this adapter cannot read — check the model id names an ` +
        `EMBEDDING model (a text-generation model answers a different shape).`,
    );
  }
  return embedding as number[];
}

/** Describe a response by shape, never by content — it may carry customer text. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? 'an object with no keys' : `an object with keys: ${keys.join(', ')}`;
  }
  return typeof value;
}

// ---------------------------------------------------------------------------
// Local sentence-transformer via transformers.js — no key, runs on device.
// ---------------------------------------------------------------------------

/**
 * The slice of `@huggingface/transformers` {@link localEmbedder} uses.
 *
 * Structural, so `await import('@huggingface/transformers')` (or a stub, or a
 * pinned fork) satisfies it without this package taking a hard type dependency
 * on the optional peer.
 */
export interface TransformersBackend {
  /** transformers.js `pipeline(task, model, options)`. */
  pipeline(task: string, model?: string, options?: Record<string, unknown>): Promise<unknown>;
  /** transformers.js `env` — mutated only when `cacheDir` is set. */
  env?: unknown;
}

export interface LocalEmbedderOptions {
  /** ONNX model id. Default 'Xenova/all-MiniLM-L6-v2' (384-dim). */
  readonly model?: string;
  /** Vector length of the model. Default 384. */
  readonly dimensions?: number;
  /** Quantization. Default 'q8' (smallest); use 'fp32' for max fidelity. */
  readonly dtype?: string;
  /** On-disk model cache directory. */
  readonly cacheDir?: string;
  /**
   * An ALREADY-IMPORTED `@huggingface/transformers`. Supply this and the lazy
   * `import('@huggingface/transformers')` never happens — which is what makes
   * the embedder work in a BUNDLED app, where a bare specifier reaches the
   * browser unresolved:
   *
   *   import * as transformers from '@huggingface/transformers';
   *   localEmbedder({ backend: transformers });
   *
   * Your bundler resolves that static import; the peer dep stays optional for
   * everyone who doesn't.
   */
  readonly backend?: TransformersBackend;
}

interface FeaturePipeline {
  (text: unknown, opts: unknown): Promise<{ data: ArrayLike<number>; tolist(): number[][] }>;
}

export function localEmbedder(options: LocalEmbedderOptions = {}): Embedder {
  const model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
  const dimensions = options.dimensions ?? 384;
  const dtype = options.dtype ?? 'q8';
  let pipe: Promise<FeaturePipeline> | undefined;

  const build = (m: TransformersBackend): Promise<FeaturePipeline> => {
    if (options.cacheDir && m.env && typeof m.env === 'object') {
      (m.env as Record<string, unknown>)['cacheDir'] = options.cacheDir;
    }
    return m.pipeline('feature-extraction', model, { dtype }) as Promise<FeaturePipeline>;
  };

  const getPipe = (): Promise<FeaturePipeline> => {
    const injected = options.backend;
    if (injected) return (pipe ??= build(injected));
    // Variable specifier so the compiler/bundler does NOT resolve the module at
    // build time — @huggingface/transformers stays an optional peer dep, loaded
    // only when localEmbedder is actually used. A bundler cannot see through
    // this; bundled apps pass { backend } instead.
    const spec = '@huggingface/transformers';
    return (pipe ??= import(spec).then((mod: unknown) => build(mod as TransformersBackend)));
  };

  return {
    dimensions,
    // `dtype` is part of the name because a q8 and an fp32 build of one model
    // are close but not identical spaces, and "close" is exactly the kind of
    // difference that shows up as a mysteriously worse ranking.
    id: `local:${model}:${dtype}`,
    async embed({ text }) {
      const p = await getPipe();
      const out = await p(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    },
    async embedBatch({ texts }) {
      const p = await getPipe();
      const out = await p([...texts], { pooling: 'mean', normalize: true });
      return out.tolist();
    },
  };
}

// ---------------------------------------------------------------------------
// Static Model2Vec vectors (potion) — no key, no network (weights bundled).
// ---------------------------------------------------------------------------

/**
 * The slice of a Model2Vec package {@link staticEmbedder} uses: a batch
 * `embed`/`encode`, on the module or on its default export.
 *
 * Structural, so `await import('@yarflam/potion-base-8m')` — or any other
 * Model2Vec build with one of those shapes — satisfies it.
 */
export interface Model2VecBackend {
  /** Batch embed: `embed(texts) => vectors` (may be async). */
  embed?(texts: readonly string[]): unknown;
  /** Alternative name some builds use. */
  encode?(texts: readonly string[]): unknown;
  /** A default export that is the fn, or carries `embed`/`encode`. */
  readonly default?: unknown;
}

export interface StaticEmbedderOptions {
  /** Vector length of the bundled model. Default 256 (potion-base-8m). */
  readonly dimensions?: number;
  /** Override the package specifier for a different Model2Vec build. */
  readonly module?: string;
  /**
   * An ALREADY-IMPORTED Model2Vec module. Supply this and no dynamic import
   * happens — the only way this embedder can run in a BUNDLED app, since a
   * bundler cannot resolve the specifier `module` names:
   *
   *   import * as potion from '@yarflam/potion-base-8m';
   *   staticEmbedder({ backend: potion });
   *
   * Takes precedence over `module`. (The potion backend itself is Node-only
   * today — see the embedders guide.)
   */
  readonly backend?: Model2VecBackend;
}

/** A batch embed fn: text(s) → array of vectors, one per input (potion's shape). */
type StaticEmbedFn = (texts: readonly string[]) => unknown;

export function staticEmbedder(options: StaticEmbedderOptions = {}): Embedder {
  const dimensions = options.dimensions ?? 256;
  const spec = options.module ?? '@yarflam/potion-base-8m';
  let embedFn: Promise<StaticEmbedFn> | undefined;

  // potion-base-8m exports `embed(texts) => Promise<Float32Array[]>` (a batch
  // async fn, also on its default export). Accept a small set of shapes so
  // other Model2Vec builds slot in: a named `embed`/`encode` on the module or
  // its default, or a default export that IS the fn.
  const pick = (mod: unknown, source: string): StaticEmbedFn => {
    const m = mod as Record<string, unknown> & { default?: unknown };
    const d = (m.default ?? {}) as Record<string, unknown>;
    const fn =
      (m['embed'] as StaticEmbedFn | undefined) ??
      (d['embed'] as StaticEmbedFn | undefined) ??
      (m['encode'] as StaticEmbedFn | undefined) ??
      (d['encode'] as StaticEmbedFn | undefined) ??
      (typeof m.default === 'function' ? (m.default as StaticEmbedFn) : undefined);
    if (!fn) {
      throw new Error(
        `staticEmbedder: no embed()/encode() export on ${source}. Pass { module } or wrap it in your own Embedder.`,
      );
    }
    return fn;
  };

  const getEmbed = (): Promise<StaticEmbedFn> => {
    const injected = options.backend;
    if (injected) {
      return (embedFn ??= Promise.resolve(pick(injected, 'the module passed as { backend }')));
    }
    return (embedFn ??= import(spec).then((mod: unknown) => pick(mod, `'${spec}'`)));
  };

  // Normalize a batch result into number[][] (one row per input). Handles
  // Float32Array[] (potion), number[][], and a single flat vector for the call.
  const toRows = (out: unknown): number[][] => {
    const rows = out as ArrayLike<unknown> | null;
    if (rows == null || typeof rows.length !== 'number') {
      throw new Error('staticEmbedder: embed() did not return an array of vectors.');
    }
    if (rows.length > 0 && typeof rows[0] === 'number') {
      return [Array.from(rows as ArrayLike<number>)]; // one flat vector for the call
    }
    return Array.from(rows as ArrayLike<ArrayLike<number>>, (v) => Array.from(v));
  };

  return {
    dimensions,
    id: `static:${spec}`,
    async embed({ text }) {
      const fn = await getEmbed();
      const rows = toRows(await fn([text]));
      return rows[0] ?? [];
    },
    async embedBatch({ texts }) {
      const fn = await getEmbed();
      return toRows(await fn([...texts]));
    },
  };
}
