/**
 * embedders — ready-made {@link Embedder} implementations for the
 * embedding-backed scorers (memory retrieval, toolChoiceRecorder / scoreMargin).
 *
 * The core deliberately ships only `mockEmbedder` (bring-your-own). These are
 * OPTIONAL and never pulled into the core: each heavy backend is an OPTIONAL
 * PEER DEPENDENCY, imported LAZILY on first embed, so you install ONLY the one
 * you use and agentfootprint stays dependency-free.
 *
 *   openaiEmbedder()  — hosted; needs OPENAI_API_KEY; no extra install (fetch).
 *   bedrockEmbedder() — hosted on AWS; Titan Text Embeddings and Cohere Embed
 *                       v3 (the model id picks the body shape); credentials
 *                       come from the AWS chain, so no key option at all.
 *                       peer dep: @aws-sdk/client-bedrock-runtime.
 *   geminiEmbedder()  — hosted on Google; Vertex (project + Application
 *                       Default Credentials) or the Gemini API (one key), the
 *                       same two doors as `gemini()`. Matryoshka sizes, real
 *                       task types, and it REFUSES a vector the service admits
 *                       it clipped. peer dep: @google/genai.
 *   localEmbedder()   — on-device sentence-transformer; no key; offline after a
 *                       one-time model fetch. peer dep: @huggingface/transformers.
 *   staticEmbedder()  — pure-JS Model2Vec static vectors; no key, no network
 *                       (weights bundled). peer dep: @yarflam/potion-base-8m.
 *
 * All five satisfy the same `Embedder` shape, so they drop into
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
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/providers`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */
export type { Embedder } from '../memory/embedding/types.js';
import type { Embedder } from '../memory/embedding/types.js';
import { lazyRequire } from '../lib/lazyRequire.js';
import {
  createGoogleGenAIClientResolver,
  type GoogleGenAIConnectionOptions,
} from '../adapters/llm/googleGenAI.js';

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
 * Chars-per-token used to convert a documented TOKEN window into the CHARACTER
 * ceiling {@link Embedder.maxInputChars} states (9.1.0).
 *
 * **4 characters per token**, the standard rule of thumb for English prose, and
 * the number every ceiling below is derived from — 8,191 tokens becomes 32,000
 * characters (floored to a round number a warning can state plainly).
 *
 * It is an ASSUMPTION, not a measurement, and it is stated here so it can be
 * argued with. Code, tables, CJK text and heavy punctuation all tokenise
 * DENSER than prose, so a chunk of exactly 32,000 characters of such material
 * can still exceed 8,191 tokens and be clipped. That is what an explicit
 * `maxChunkChars` is for: it always wins over a declared ceiling, precisely so
 * a caller who knows their corpus is dense can say a smaller number. For the
 * shipped splitter defaults (1,000 characters a chunk) the distinction never
 * arises — the ceiling matters when a consumer RAISES the splitter, which is
 * the case this whole mechanism exists to keep honest.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Documented input window per OpenAI embedding model, in TOKENS.
 *
 * All three current models accept 8,191 tokens — OpenAI's embeddings guide and
 * the model pages state the same limit for `text-embedding-3-small`,
 * `text-embedding-3-large` and `text-embedding-ada-002`. A model this library
 * does not know gets NO declared ceiling rather than a guessed one: the same
 * rule `.dimensions` applies, for the same reason — a wrong ceiling clips in
 * silence, and an absent one simply leaves the indexer's conservative default
 * in place.
 */
const NATIVE_MAX_INPUT_TOKENS: Readonly<Record<string, number>> = {
  'text-embedding-3-small': 8191,
  'text-embedding-3-large': 8191,
  'text-embedding-ada-002': 8191,
};

/** Tokens → characters, floored to a round number a message can state plainly. */
function charsFor(tokens: number | undefined): number | undefined {
  return tokens === undefined ? undefined : Math.floor((tokens * CHARS_PER_TOKEN) / 1000) * 1000;
}

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
 * `.maxInputChars` (9.1.0) reports **32,000** for the three models above:
 * their documented 8,191-token window at the stated {@link CHARS_PER_TOKEN}
 * assumption. An indexer reads it in preference to its own 2,000-character
 * default, so a corpus split at 2,500 characters is embedded WHOLE here
 * instead of being clipped by a default measured on an on-device model.
 * An unknown model declares no ceiling — the indexer's default stands, which
 * is conservative rather than wrong.
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
  const maxInputChars = charsFor(NATIVE_MAX_INPUT_TOKENS[model]);
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
    // The documented window, in the unit a splitter cuts in. Spread rather
    // than assigned so an unknown model declares NOTHING instead of
    // `undefined` — the field is optional and its absence is meaningful.
    ...(maxInputChars !== undefined && { maxInputChars }),
    async embed({ text, signal }) {
      return (await call([text], signal))[0];
    },
    async embedBatch({ texts, signal }) {
      return call([...texts], signal);
    },
  };
}

// ---------------------------------------------------------------------------
// Amazon Bedrock (hosted) — Titan and Cohere embeddings, via the AWS SDK.
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

/**
 * The request/response SHAPE a Bedrock embedding model speaks (9.3.0).
 *
 * `InvokeModel` is one operation with a vendor-specific body on both sides:
 * Titan takes `{ inputText }` and answers `{ embedding }`, Cohere takes
 * `{ texts, input_type }` and answers `{ embeddings }`. One model id therefore
 * does not describe one call, and until 9.3.0 this factory sent Titan's body to
 * everything — so a Cohere model id was accepted at construction (with
 * `dimensions`) and failed at the first embed, against the real service, with a
 * validation error from AWS rather than a sentence from here.
 */
export type BedrockEmbeddingFamily = 'titan' | 'cohere';

/**
 * Cohere's `input_type`, which is a real parameter and not a hint: the v3
 * models embed a QUERY and a DOCUMENT into deliberately different places, and
 * the two are meant to be compared with each other. Sending one value for both
 * halves is a measurable loss of retrieval quality, not a style choice — and
 * Cohere requires the field, so there is no "unset" to fall back to.
 */
export type CohereInputType = 'search_document' | 'search_query';

export interface BedrockEmbedderOptions {
  /**
   * Bedrock model id. Default `'amazon.titan-embed-text-v2:0'`.
   *
   * Four are known by name — Titan V2, Titan V1, and Cohere Embed English /
   * Multilingual v3 (see {@link BEDROCK_EMBEDDING_MODELS}) — and each brings
   * its own body shape, vector length and input window. An id that WRAPS one of
   * those (a cross-region inference profile `us.amazon.titan-embed-text-v2:0`,
   * or an ARN ending in the model id) is resolved to the model it names.
   *
   * Anything else is a model this library has never met: pass `dimensions`
   * with it (its vector length is not something this can know) and `family` if
   * it is not Titan-shaped.
   */
  readonly model?: string;
  /**
   * Vector length to request.
   *
   * Titan V2 is the one CONFIGURABLE model — 1024 (default), 512 or 256 — and
   * the value is SENT to the model AND reported as `.dimensions`, so the two
   * can never disagree. Every other known model has ONE size, and asking for a
   * different one is refused rather than reported: `.dimensions` is what a
   * vector store fingerprints on, and a wrong one corrupts it silently.
   *
   * Required for a model outside {@link BEDROCK_EMBEDDING_MODELS}.
   */
  readonly dimensions?: number;
  /**
   * The body shape to speak, when the model id does not say (9.3.0).
   *
   * Inferred for every known model and for anything that wraps one, so this is
   * only for a model id this library has never met — a provisioned-throughput
   * ARN, a custom deployment. Unknown and unstated, the body is **Titan's**,
   * which is the shape every release before 9.3.0 sent to everything.
   *
   * Stating a family that contradicts a known model id is refused by name.
   */
  readonly family?: BedrockEmbeddingFamily;
  /**
   * Pin Cohere's `input_type` instead of deriving it from the call (9.3.0).
   *
   * Unset — the default — `embed()` sends `'search_query'` and `embedBatch()`
   * sends `'search_document'`, because that is what this library's own two
   * call sites are: retrieval embeds ONE question (`loadRelevant`), indexing
   * embeds MANY passages (`indexDocuments`, `embedMessages`). Pin it when your
   * own code uses the two calls differently — embedding a single document, say,
   * or scoring a batch of queries.
   *
   * Ignored by Titan, which has no such parameter.
   */
  readonly inputType?: CohereInputType;
  /**
   * The longest input this model reads whole, in CHARACTERS
   * ({@link Embedder.maxInputChars}). Declared for every known model from its
   * documented token window; this option is how a model this library does not
   * know states its own, rather than declaring none and leaving the indexer's
   * conservative default in place. An explicit value always wins.
   */
  readonly maxInputChars?: number;
  /** AWS region. Passed to the SDK client when this factory builds one. */
  readonly region?: string;
  /** A pre-built Bedrock runtime client, so one SDK config serves the whole app. */
  readonly client?: BedrockRuntimeLikeClient;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: BedrockRuntimeLikeClient;
  /** @internal Test injection — the AWS SDK module (exercises the real shim with a mock SDK). */
  readonly _sdk?: BedrockRuntimeSdkModule;
}

/** Everything this library knows about ONE Bedrock embedding model. */
interface BedrockModelFacts {
  /** Which body shape it speaks on the way in and out. */
  readonly family: BedrockEmbeddingFamily;
  /** Native output size — what `.dimensions` reports when nothing is asked for. */
  readonly dimensions: number;
  /**
   * The sizes it can be ASKED for, when it takes a size at all. Absent means
   * one fixed length: the request carries no size field, and an explicit
   * `dimensions` that disagrees with {@link dimensions} is refused rather than
   * reported.
   */
  readonly sizes?: readonly number[];
  /** Documented input window, in TOKENS, converted at {@link CHARS_PER_TOKEN}. */
  readonly maxInputTokens: number;
}

/**
 * The Bedrock embedding models this library knows by name — three facts each,
 * in one table, because they arrive together and drift apart when they are
 * kept apart (9.3.0; two Titan-only tables until then).
 *
 * **Size.** Titan Text Embeddings **V2** is the configurable one — 1024
 * (default), 512, 256. Titan Embeddings G1 – Text (**V1**) has one size, 1536,
 * and no `dimensions` parameter at all. Cohere Embed v3 (English and
 * Multilingual) returns 1024 and likewise takes no size. A model outside this
 * table has a length this library cannot know and must state its own — the same
 * rule `openaiEmbedder` applies, for the same reason: a store that trusts
 * `.dimensions` and gets a different length back corrupts silently.
 *
 * **Window.** Both Titan text-embedding models accept **8,192 tokens** —
 * sixteen times the on-device model the shipped default ceiling was measured
 * on. Cohere Embed v3 accepts **512**, and that number is the whole argument
 * for a per-MODEL ceiling rather than a per-VENDOR one: 512 tokens is ~2,000
 * characters, so the same corpus that is embedded whole by Titan is silently
 * truncated by Cohere at a quarter of the chunk. Declared, the indexers cut to
 * fit; guessed from a sibling model, they would not.
 *
 * **Family.** The body shape (see {@link BedrockEmbeddingFamily}) — the fact
 * whose absence made a Cohere model id constructible and unusable before 9.3.0.
 */
const BEDROCK_EMBEDDING_MODELS: Readonly<Record<string, BedrockModelFacts>> = {
  'amazon.titan-embed-text-v2:0': {
    family: 'titan',
    dimensions: 1024,
    sizes: [1024, 512, 256],
    maxInputTokens: 8192,
  },
  'amazon.titan-embed-text-v1': { family: 'titan', dimensions: 1536, maxInputTokens: 8192 },
  'cohere.embed-english-v3': { family: 'cohere', dimensions: 1024, maxInputTokens: 512 },
  'cohere.embed-multilingual-v3': { family: 'cohere', dimensions: 1024, maxInputTokens: 512 },
};

/**
 * Titan V2's configurable sizes, kept as a constant because an id this table
 * has never seen can still be recognisably Titan V2 (a variant released after
 * this version) — and for such an id the size must still be SENT, or the model
 * returns 1024 while `.dimensions` reports 512.
 */
const TITAN_V2_SIZES: readonly number[] = [1024, 512, 256];

/**
 * How many texts Cohere embeds in ONE `InvokeModel` call.
 *
 * **96**, the documented maximum, and the reason `embedBatch` is a real batch
 * here and N calls for Titan: a 500-chunk corpus is 6 round-trips instead of
 * 500. Chunked at exactly the documented number rather than under it, because
 * unlike a byte limit this one is a count the caller can see — and a batch that
 * silently used half the allowance would be a cost nobody asked for.
 */
const COHERE_MAX_TEXTS_PER_CALL = 96;

/**
 * The body shape sent to a model id this library has never met.
 *
 * Titan's — because it is the shape EVERY release before 9.3.0 sent to every
 * model, so an unknown id keeps doing exactly what it did. `family` is how a
 * caller says otherwise, and the read-side refusal names that option.
 */
const DEFAULT_BEDROCK_FAMILY: BedrockEmbeddingFamily = 'titan';

/**
 * The facts for a model id, including ids that WRAP a known one.
 *
 * A cross-region inference profile (`us.amazon.titan-embed-text-v2:0`) and an
 * inference-profile ARN both END in the model id they route to, so containment
 * resolves them exactly rather than by guess — and an id that names its model is
 * not "unknown" just because it has a prefix. Before 9.3.0 those were refused
 * as unknown models, which is why widening this is safe: it accepts what used
 * to throw.
 */
function bedrockFactsFor(model: string): BedrockModelFacts | undefined {
  const exact = BEDROCK_EMBEDDING_MODELS[model];
  if (exact) return exact;
  for (const [id, facts] of Object.entries(BEDROCK_EMBEDDING_MODELS)) {
    if (model.includes(id)) return facts;
  }
  return undefined;
}

/**
 * The family a model id NAMES, or `undefined` when it names none.
 *
 * Substring, not prefix: the id may be wrapped by a region prefix or an ARN.
 * An id that says neither gets Titan's body — the shape every release before
 * 9.3.0 sent to everything — and `family` is how you say otherwise.
 */
function inferBedrockFamily(model: string): BedrockEmbeddingFamily | undefined {
  if (model.includes('cohere.embed')) return 'cohere';
  if (model.includes('titan-embed')) return 'titan';
  return undefined;
}

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
 * ── One operation, two body shapes (9.3.0) ───────────────────────────────
 * `InvokeModel` is a single API over vendor-specific JSON. Titan takes
 * `{ inputText }` and answers `{ embedding }`; Cohere takes
 * `{ texts, input_type }` and answers `{ embeddings }`, embeds up to
 * {@link COHERE_MAX_TEXTS_PER_CALL} of them per call, and distinguishes a
 * QUERY from a DOCUMENT. So the model id selects a FAMILY
 * ({@link BedrockEmbeddingFamily}), and the family owns the request, the
 * response and the batching. Before this, one shape was sent to everything —
 * a Cohere id constructed fine and failed at the first embed.
 *
 * ── The input ceiling (9.1.0) ────────────────────────────────────────────
 * `.maxInputChars` is per MODEL, from its documented token window converted at
 * the stated {@link CHARS_PER_TOKEN} assumption of 4 characters per token:
 * **32,000** for both Titan text-embedding models (8,192 tokens — sixteen
 * times the indexer's own default, which was measured on an on-device model),
 * and **2,000** for Cohere Embed v3 (512 tokens). Those two numbers are why the
 * ceiling cannot be a per-vendor constant: the same 2,500-character chunk is
 * read whole by Titan and truncated by Cohere. Dense text (code, tables, CJK)
 * tokenises tighter than the assumption; pass an explicit `maxChunkChars` for
 * such a corpus, and it wins over this number.
 *
 * @throws if `model` is unknown and `dimensions` was not supplied; if
 *         `dimensions` is a size the model does not produce; if `family`
 *         contradicts a known model id; or if the SDK is missing and no
 *         `client` / `_client` / `_sdk` was passed.
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
 *
 * @example  A Cohere embedding model on the same runtime
 * ```ts
 * // Body shape, response field, batch size and 512-token window all follow
 * // from the model id — nothing else changes at the call site.
 * const embedder = bedrockEmbedder({ model: 'cohere.embed-english-v3' });
 * ```
 */
export function bedrockEmbedder(options: BedrockEmbedderOptions = {}): Embedder {
  const model = options.model ?? 'amazon.titan-embed-text-v2:0';
  const facts = bedrockFactsFor(model);
  const named = inferBedrockFamily(model);
  if (options.family !== undefined && facts !== undefined && options.family !== facts.family) {
    throw new Error(
      `bedrockEmbedder: model '${model}' is a ${facts.family} model, and \`family: ` +
        `'${options.family}'\` says otherwise. The two cannot both be right, and guessing ` +
        `which line is the mistake would decide the request body — the one thing a wrong ` +
        `answer here breaks at the first embed. Drop \`family\` (the model id already says ` +
        `it), or name the model you meant.`,
    );
  }
  // Explicit, then what the id names, then Titan — which is the body every
  // release before 9.3.0 sent to every model, so an id this library has never
  // met keeps behaving exactly as it did.
  const family: BedrockEmbeddingFamily =
    options.family ?? facts?.family ?? named ?? DEFAULT_BEDROCK_FAMILY;
  const requested = options.dimensions;
  const dimensions = requested ?? facts?.dimensions;
  if (dimensions === undefined) {
    throw new Error(
      `bedrockEmbedder: unknown model '${model}' — its vector length is not something this ` +
        `library can know, and reporting a wrong .dimensions silently corrupts a vector store. ` +
        `Pass { dimensions } with the length that model returns.`,
    );
  }
  // A model this table has never seen can still be recognisably Titan V2, and
  // for one of those the requested size must still be validated and SENT.
  const sizes =
    facts?.sizes ??
    (family === 'titan' && model.includes('titan-embed-text-v2') ? TITAN_V2_SIZES : undefined);
  if (requested !== undefined && sizes !== undefined && !sizes.includes(requested)) {
    throw new Error(
      `bedrockEmbedder: '${model}' returns ${sizes.join(', ')} ` +
        `dimensions — received ${String(requested)}. Asking for a size the model does not ` +
        `produce would store vectors of a length that disagrees with the .dimensions this ` +
        `embedder reports.`,
    );
  }
  if (
    requested !== undefined &&
    sizes === undefined &&
    facts !== undefined &&
    requested !== facts.dimensions
  ) {
    throw new Error(
      `bedrockEmbedder: '${model}' returns ${facts.dimensions}-dimension vectors and takes no ` +
        `size parameter — received ${String(requested)}, which would be reported as ` +
        `.dimensions and never be the length that comes back. Drop \`dimensions\`: this ` +
        `factory already knows this model's size.`,
    );
  }
  const maxInputChars = options.maxInputChars ?? charsFor(facts?.maxInputTokens);
  // Only a size the model actually TAKES is sent. Titan V2 defaults to 1024 on
  // its own side, V1 and Cohere reject the field — so a caller who asked for
  // nothing gets a request body identical to the one before this option
  // existed.
  const sendSize = requested !== undefined && sizes !== undefined;

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
   * ONE `InvokeModel` round-trip, with the family's body on the way in and the
   * family's field on the way out.
   *
   * Takes a slice of texts rather than one, because how many fit in a call is
   * itself a family fact: Titan embeds a single `inputText`, Cohere embeds up
   * to {@link COHERE_MAX_TEXTS_PER_CALL}. The callers below never have to know
   * which — they hand over texts and get one vector per text back, in order.
   */
  async function invoke(
    texts: readonly string[],
    inputType: CohereInputType,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const conn = connect();
    const body = JSON.stringify(
      family === 'cohere'
        ? {
            texts: [...texts],
            // Required by the model, so there is no "unset" — see `inputType`.
            input_type: options.inputType ?? inputType,
          }
        : {
            inputText: texts[0],
            ...(sendSize && { dimensions: requested }),
          },
    );
    const command = new conn.Command({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    });
    const out = await (signal
      ? conn.client.send(command, { abortSignal: signal })
      : conn.client.send(command));
    return readEmbeddings(out, model, family, texts.length, facts === undefined);
  }

  /**
   * The calls one batch becomes: Titan one text at a time, Cohere in chunks.
   *
   * Sequential rather than parallel either way: callers of the batch path are
   * usually indexing a whole corpus, and `indexCorpus` already fans out over
   * batches with its own bounded parallelism and retry. Racing N more requests
   * inside one of those branches is how a corpus index meets a throttling
   * error.
   *
   * The abort is checked between calls as well as passed into each one, so an
   * aborted batch stops at the next boundary instead of embedding the rest of a
   * corpus nobody is waiting for.
   */
  async function invokeAll(
    texts: readonly string[],
    inputType: CohereInputType,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const perCall = family === 'cohere' ? COHERE_MAX_TEXTS_PER_CALL : 1;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += perCall) {
      signal?.throwIfAborted();
      out.push(...(await invoke(texts.slice(i, i + perCall), inputType, signal)));
    }
    return out;
  }

  return {
    dimensions,
    // The embedding SPACE, size included — see the note above.
    id: `bedrock:${model}:${dimensions}`,
    // Spread, so a model this factory does not know declares NO ceiling rather
    // than one it cannot stand behind.
    ...(maxInputChars !== undefined && { maxInputChars }),
    async embed({ text, signal }) {
      // ONE text is this library's query shape (`loadRelevant` embeds the
      // question) — so Cohere is told it is a query unless `inputType` says
      // otherwise. Titan ignores the argument entirely.
      return (await invoke([text], 'search_query', signal))[0] as number[];
    },
    async embedBatch({ texts, signal }) {
      // MANY texts is this library's document shape (`indexDocuments`,
      // `embedMessages`), and Cohere embeds a document into a different place
      // from a query on purpose.
      return invokeAll(texts, 'search_document', signal);
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
 * Pull the vectors out of an `InvokeModel` response, by FAMILY.
 *
 * The SDK hands back `body` as a `Uint8Array`; a hand-rolled or mock client
 * may hand back the decoded object or a string. All three are read, and
 * anything else is refused by NAME rather than returning an empty vector —
 * an embedder that silently returns `[]` writes a row a store will never
 * rank, which is indistinguishable from "the corpus does not mention that".
 *
 * The field differs with the family (`embedding` vs `embeddings`), so the
 * refusal has to as well: told the wrong family, the response is perfectly
 * valid and this is the only place that can say so — which is why the message
 * names `family` when the model id was not one this library knows.
 *
 * @param expected how many vectors were asked for. A count mismatch is refused
 *   rather than returned short: the caller pairs vectors with texts by
 *   POSITION, so a missing one does not go missing — it silently re-labels
 *   every passage after it.
 * @param guessedFamily whether the family was a fallback rather than a fact.
 */
function readEmbeddings(
  response: unknown,
  model: string,
  family: BedrockEmbeddingFamily,
  expected: number,
  guessedFamily: boolean,
): number[][] {
  const body = (response as { body?: unknown } | null)?.body ?? response;
  let parsed: unknown = body;
  if (body instanceof Uint8Array) {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } else if (typeof body === 'string') {
    parsed = JSON.parse(body);
  }
  const field = family === 'cohere' ? 'embeddings' : 'embedding';
  const raw = (parsed as Record<string, unknown> | null)?.[field];
  // Cohere answers `{ embeddings: [[...]] }`, or `{ embeddings: { float: [[...]] } }`
  // when a caller asked for typed embeddings. This never asks, and reads both.
  const rows =
    family === 'cohere'
      ? Array.isArray(raw)
        ? raw
        : (raw as { float?: unknown } | null)?.float
      : [raw];
  const vectors =
    Array.isArray(rows) &&
    rows.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'number'))
      ? (rows as number[][])
      : undefined;
  if (vectors === undefined) {
    throw new Error(
      `bedrockEmbedder: '${model}' returned no \`${field}\` array. Bedrock answered with ` +
        `${describeShape(parsed)}, which this adapter cannot read — check the model id names an ` +
        `EMBEDDING model (a text-generation model answers a different shape).` +
        (guessedFamily
          ? `\n  This model id is not one this library knows, so it was sent the ${family} ` +
            `request body. If it is a ${family === 'titan' ? 'Cohere' : 'Titan'} model, pass ` +
            `\`family: '${family === 'titan' ? 'cohere' : 'titan'}'\` — the request body and ` +
            `the response field both differ per family.`
          : ''),
    );
  }
  if (vectors.length !== expected) {
    throw new Error(
      `bedrockEmbedder: '${model}' was sent ${expected} text(s) and answered with ` +
        `${vectors.length} vector(s). Vectors are paired with texts by POSITION, so a short ` +
        `answer would not lose one passage — it would attach every later vector to the wrong ` +
        `passage, and the corpus would rank confidently and wrongly forever.`,
    );
  }
  return vectors;
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
// Google Gemini embeddings (hosted) — Vertex or the Gemini API, one SDK.
// ---------------------------------------------------------------------------

/**
 * The slice of `@google/genai` {@link geminiEmbedder} uses — one method.
 *
 * Structural, so the real `GoogleGenAI`, a client shared with `gemini()`, or a
 * `{ models: { embedContent } }` double all satisfy it without this package
 * taking a hard type dependency on the optional peer. The double is what the
 * Google pin injects.
 */
export interface GeminiEmbedClientLike {
  readonly models: {
    embedContent(params: GeminiEmbedParams): Promise<GeminiEmbedResponse>;
  };
}

/** `EmbedContentParameters`, narrowed to what this adapter sends. */
export interface GeminiEmbedParams {
  readonly model: string;
  readonly contents: readonly string[];
  readonly config?: {
    readonly taskType?: string;
    readonly outputDimensionality?: number;
    readonly abortSignal?: AbortSignal;
  };
}

/** `EmbedContentResponse`, narrowed to what this adapter reads. */
export interface GeminiEmbedResponse {
  readonly embeddings?: readonly {
    readonly values?: readonly number[];
    /**
     * Present on Vertex. `truncated: true` is the service TELLING us it clipped
     * the input — the one signal that turns the silent half of
     * {@link Embedder.maxInputChars} into something an adapter can act on.
     */
    readonly statistics?: { readonly truncated?: boolean; readonly tokenCount?: number };
  }[];
}

/**
 * Gemini's `task_type` — a real parameter, not a hint.
 *
 * `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT` embed a question and a passage
 * into deliberately different projections that are MEANT to be compared with
 * each other, so using one value for both halves is a measurable loss of
 * retrieval quality. The rest are separate objectives; mixing them in one store
 * is mixing spaces.
 */
export type GeminiEmbeddingTaskType =
  | 'RETRIEVAL_QUERY'
  | 'RETRIEVAL_DOCUMENT'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING'
  | 'CODE_RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION';

/** What this adapter does when the service says it clipped the input. */
export type GeminiTruncationPolicy = 'refuse' | 'allow';

export interface GeminiEmbedderOptions extends GoogleGenAIConnectionOptions {
  /**
   * Embedding model id. Default `'gemini-embedding-001'`.
   *
   * Two are known by name (see {@link GEMINI_EMBEDDING_MODELS}); anything else
   * is a model this library has never met, so pass `dimensions` with it — its
   * vector length is not something this can know, and a wrong `.dimensions`
   * corrupts a vector store in silence.
   */
  readonly model?: string;
  /**
   * Vector length to request (`outputDimensionality`).
   *
   * Both known models are Matryoshka models: they emit 3072 numbers and can be
   * asked for fewer, and the shorter vector is a genuinely usable embedding
   * rather than a slice of a longer one. The value is SENT to the model AND
   * reported as `.dimensions`, so the two can never disagree. Google recommends
   * 768, 1536 or 3072; any length up to the model's native size is accepted.
   *
   * Required for a model outside {@link GEMINI_EMBEDDING_MODELS}.
   *
   * Note for stores that rank by DOT PRODUCT or euclidean distance: Google's
   * shortened vectors are not re-normalised, and Google recommends normalising
   * them yourself. Nothing in this library needs it — `cosineSimilarity`
   * divides by both magnitudes — so this adapter returns the model's numbers
   * unchanged rather than quietly rescaling what you store.
   */
  readonly dimensions?: number;
  /**
   * Pin `task_type` instead of deriving it from the call.
   *
   * Unset — the default — `embed()` sends `RETRIEVAL_QUERY` and `embedBatch()`
   * sends `RETRIEVAL_DOCUMENT`, because that is what this library's own two
   * call sites are: retrieval embeds ONE question (`loadRelevant`), indexing
   * embeds MANY passages (`indexDocuments`, `embedMessages`). Pin it when your
   * own code uses the two calls differently, or when the objective is
   * classification or clustering rather than search.
   *
   * Refused by name on a model that does not take the parameter.
   */
  readonly taskType?: GeminiEmbeddingTaskType;
  /**
   * What to do when the service reports it CLIPPED the input. Default
   * `'refuse'`.
   *
   * Over-long input is not rejected by Gemini — it is silently truncated, and a
   * full-looking vector comes back for the opening of the passage. An indexer
   * then stores the whole chunk as the passage and the clipped vector as its
   * index, so retrieval cannot find text that is visibly present in the passage
   * it later serves. Nothing throws, nothing scores zero; the corpus is quietly,
   * partially indexed.
   *
   * `.maxInputChars` exists to stop that BEFORE the call, and it is an
   * assumption (see {@link CHARS_PER_TOKEN}) — dense text tokenises tighter.
   * `statistics.truncated` is the service saying it happened anyway, and this
   * adapter is the only thing that sees it. `'refuse'` turns it into an error
   * naming the fix; `'allow'` returns the clipped vector, which is what every
   * library that does not look at the field already does.
   *
   * Detection depends on the service RETURNING `statistics` — Vertex does. When
   * it is absent this adapter cannot tell, and says so here rather than
   * implying a guarantee.
   */
  readonly onTruncation?: GeminiTruncationPolicy;
  /**
   * The longest input this model reads whole, in CHARACTERS
   * ({@link Embedder.maxInputChars}). Declared for every known model from its
   * documented token window; this option is how a model this library does not
   * know states its own. An explicit value always wins.
   */
  readonly maxInputChars?: number;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: GeminiEmbedClientLike;
}

/** Everything this library knows about ONE Gemini embedding model. */
interface GeminiEmbeddingModelFacts {
  /** Native output size — what `.dimensions` reports when nothing is asked for. */
  readonly dimensions: number;
  /** Documented input window, in TOKENS, converted at {@link CHARS_PER_TOKEN}. */
  readonly maxInputTokens: number;
  /** Does it take `task_type` at all? */
  readonly supportsTaskType: boolean;
}

/**
 * The Gemini embedding models this library knows by name.
 *
 * **`gemini-embedding-001`** — text only, 3072 dimensions, a **2,048-token**
 * input window, and the full `task_type` vocabulary. It is the default because
 * this library's two call sites are a query and a passage, and the query /
 * document task types are exactly that distinction.
 *
 * **`gemini-embedding-2`** — natively multimodal, 3072 dimensions, an
 * **8,192-token** text window, and **no `task_type` parameter at all**: Google
 * replaced it with task instructions written into the prompt. That difference
 * is why the field is a per-model fact here rather than a constant — asked for
 * on the model that does not take it, `task_type` is a request field the
 * service will reject, and this adapter refuses first with the reason.
 *
 * A model outside this table has a length this library cannot know and must
 * state its own — the same rule `openaiEmbedder` and `bedrockEmbedder` apply,
 * for the same reason.
 */
const GEMINI_EMBEDDING_MODELS: Readonly<Record<string, GeminiEmbeddingModelFacts>> = {
  'gemini-embedding-001': { dimensions: 3072, maxInputTokens: 2048, supportsTaskType: true },
  'gemini-embedding-2': { dimensions: 3072, maxInputTokens: 8192, supportsTaskType: false },
};

/**
 * How many texts Gemini embeds in ONE `embedContent` call: **one**.
 *
 * Not a conservative choice — the documented limit. `gemini-embedding-001`
 * accepts exactly one input text per request, and libraries that assumed
 * otherwise (batching 96 or 250 instances the way an OpenAI or Titan client
 * would) send an oversized request that the service rejects on every batch
 * bigger than a single text. `embedBatch` is therefore N sequential calls, and
 * says so rather than looking like a batch that is secretly a loop.
 */
const GEMINI_MAX_TEXTS_PER_CALL = 1;

/**
 * Google's hosted embeddings, through `models.embedContent` — on Vertex or on
 * the Gemini API.
 *
 * The door is chosen exactly as `gemini()` chooses it: `{ project, location }`
 * is Vertex with Application Default Credentials, `{ apiKey }` is the Gemini
 * API, and neither is guessed. One `GoogleGenAI` client serves both this and
 * the LLM provider, so an app that talks to both can build the client once and
 * pass it as `_client`.
 *
 * ── Why the id carries the DIMENSION COUNT ───────────────────────────────
 * `'gemini:<model>:<dims>'`, for the reason `bedrockEmbedder` gives at length:
 * `MemoryEntry.embeddingModel` stores the id ALONE and it is the only thing
 * `SearchOptions.embedderId` filters on. One model id at 768 and the same model
 * id at 3072 are different embedding spaces, so an id without the size cannot
 * tell them apart — and neither can the size alone, since both known models are
 * 3072 natively.
 *
 * The `taskType` is deliberately NOT in the id, matching `bedrockEmbedder`'s
 * treatment of Cohere's `input_type`: the default query/document pair is ONE
 * space by construction (the two projections exist to be compared with each
 * other), and a pinned value pins both call sites at once, so the store stays
 * self-consistent either way.
 *
 * ── The input ceiling, and the service telling on itself (9.1.0) ─────────
 * `.maxInputChars` is per MODEL, from its documented token window at the stated
 * {@link CHARS_PER_TOKEN} assumption: **8,000** for `gemini-embedding-001`
 * (2,048 tokens) and **32,000** for `gemini-embedding-2` (8,192). A quarter of
 * the newer model's window is not a rounding difference — it is the whole
 * reason the ceiling is per-model. Past the ceiling Gemini CLIPS rather than
 * refuses, so `onTruncation` decides what happens when the response admits it.
 *
 * @throws if `model` is unknown and `dimensions` was not supplied; if
 *         `dimensions` exceeds what the model can produce; if `taskType` is set
 *         on a model that takes none; if neither a project nor an API key is
 *         resolvable; or if `@google/genai` is not installed and no `_client`
 *         was passed.
 *
 * @example
 * ```ts
 * import { geminiEmbedder } from 'agentfootprint/providers';
 * import { sqliteVectorStore } from 'agentfootprint/memory';
 * import { indexFolder } from 'agentfootprint/rag';
 *
 * const embedder = geminiEmbedder({ project: 'my-project', dimensions: 768 });
 * await indexFolder('./docs', { to: sqliteVectorStore({ file: './corpus.db' }), embedder });
 * ```
 *
 * @example  The Gemini API door, and a store that must never hold a clipped vector
 * ```ts
 * const embedder = geminiEmbedder({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   onTruncation: 'refuse', // the default — stated here because it is the point
 * });
 * ```
 */
export function geminiEmbedder(options: GeminiEmbedderOptions = {}): Embedder {
  const model = options.model ?? 'gemini-embedding-001';
  const facts = GEMINI_EMBEDDING_MODELS[model];
  const requested = options.dimensions;
  const dimensions = requested ?? facts?.dimensions;
  if (dimensions === undefined) {
    throw new Error(
      `geminiEmbedder: unknown model '${model}' — its vector length is not something this ` +
        `library can know, and reporting a wrong .dimensions silently corrupts a vector store. ` +
        `Pass { dimensions } with the length that model returns.`,
    );
  }
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    throw new Error(
      `geminiEmbedder: \`dimensions\` must be a positive whole number — received ` +
        `${String(requested)}.`,
    );
  }
  if (requested !== undefined && facts !== undefined && requested > facts.dimensions) {
    throw new Error(
      `geminiEmbedder: '${model}' produces at most ${facts.dimensions} dimensions — received ` +
        `${String(requested)}. Asking for more would be reported as .dimensions and never be ` +
        `the length that comes back.`,
    );
  }
  if (options.taskType !== undefined && facts !== undefined && !facts.supportsTaskType) {
    throw new Error(
      `geminiEmbedder: '${model}' takes no \`task_type\` — Google replaced the parameter with ` +
        `task instructions written into the text itself on this model. Drop \`taskType\` and ` +
        `prefix your input (for example "task: search result | query: …"), or use ` +
        `'gemini-embedding-001', which does take it.`,
    );
  }
  const sendTaskType = facts?.supportsTaskType ?? true;
  const maxInputChars = options.maxInputChars ?? charsFor(facts?.maxInputTokens);
  const onTruncation: GeminiTruncationPolicy = options.onTruncation ?? 'refuse';

  // Lazy on purpose, as it always was: constructing an embedder is not
  // connecting to one, and a factory that reached for credentials would refuse
  // at import time in a process that only ever embeds behind a feature flag.
  // Under a callback `apiKey` this also asks for the credential per request —
  // see `createGoogleGenAIClientResolver`.
  const connect = createGoogleGenAIClientResolver<GeminiEmbedClientLike>(
    options,
    'geminiEmbedder',
    options._client,
  );

  /**
   * ONE `embedContent` round-trip, carrying however many texts the model takes
   * ({@link GEMINI_MAX_TEXTS_PER_CALL}) — one, today. Written as a slice rather
   * than a single string so that the day Google raises the limit is a
   * one-number change here and nowhere else.
   */
  async function embedChunk(
    texts: readonly string[],
    taskType: GeminiEmbeddingTaskType,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const config = {
      ...(sendTaskType && { taskType: options.taskType ?? taskType }),
      ...(requested !== undefined && { outputDimensionality: requested }),
      ...(signal && { abortSignal: signal }),
    };
    const { client } = await connect();
    const response = await client.models.embedContent({
      model,
      contents: [...texts],
      ...(Object.keys(config).length > 0 && { config }),
    });
    return readGeminiEmbeddings(response, model, dimensions, texts, onTruncation);
  }

  /** The calls one batch becomes, in order, one chunk at a time. */
  async function embedAll(
    texts: readonly string[],
    taskType: GeminiEmbeddingTaskType,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += GEMINI_MAX_TEXTS_PER_CALL) {
      signal?.throwIfAborted();
      out.push(
        ...(await embedChunk(texts.slice(i, i + GEMINI_MAX_TEXTS_PER_CALL), taskType, signal)),
      );
    }
    return out;
  }

  return {
    dimensions,
    // The embedding SPACE, size included — see the note above.
    id: `gemini:${model}:${dimensions}`,
    // Spread, so a model this factory does not know declares NO ceiling rather
    // than one it cannot stand behind.
    ...(maxInputChars !== undefined && { maxInputChars }),
    async embed({ text, signal }) {
      // ONE text is this library's query shape (`loadRelevant` embeds the
      // question).
      return (await embedChunk([text], 'RETRIEVAL_QUERY', signal))[0] as number[];
    },
    async embedBatch({ texts, signal }) {
      // MANY texts is this library's document shape, and Gemini embeds a
      // document into a different place from a query on purpose.
      //
      // Sequential rather than parallel: callers of this path are usually
      // indexing a whole corpus, and `indexCorpus` already fans out over
      // batches with its own bounded parallelism and retry. Racing N more
      // requests inside one of those branches is how a corpus index meets a
      // throttling error. The abort is checked between calls as well as passed
      // into each one.
      return embedAll(texts, 'RETRIEVAL_DOCUMENT', signal);
    },
  };
}

/**
 * Read the vectors out of an `embedContent` response — and refuse everything
 * else by name.
 *
 * Four refusals, each for a failure that would otherwise be silent:
 *   • a count that disagrees with the texts sent — vectors are paired with
 *     texts by POSITION, so a short answer does not lose one passage, it
 *     re-labels every later one;
 *   • no readable `values` — an embedder that returns `[]` writes a row a store
 *     will never rank, which is indistinguishable from "the corpus does not
 *     mention that";
 *   • a length that disagrees with the declared `.dimensions` — the number a
 *     vector store fingerprints on;
 *   • `statistics.truncated` under `onTruncation: 'refuse'` — the service
 *     saying it indexed the opening of the passage and threw the rest away.
 */
function readGeminiEmbeddings(
  response: GeminiEmbedResponse,
  model: string,
  dimensions: number,
  texts: readonly string[],
  onTruncation: GeminiTruncationPolicy,
): number[][] {
  const rows = response.embeddings;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error(
      `geminiEmbedder: '${model}' was sent ${texts.length} text(s) and answered with ` +
        `${Array.isArray(rows) ? rows.length : describeShape(response)} — vectors are paired ` +
        `with texts by POSITION, so a mismatched answer would attach every later vector to the ` +
        `wrong passage, and the corpus would rank confidently and wrongly forever.`,
    );
  }

  return rows.map((row, index) => {
    const values = row?.values;
    if (!Array.isArray(values) || !values.every((n) => typeof n === 'number')) {
      throw new Error(
        `geminiEmbedder: '${model}' returned no \`embeddings[${index}].values\` array. The ` +
          `service answered with ${describeShape(response)}, which this adapter cannot read — ` +
          `check that the model id names an EMBEDDING model.`,
      );
    }
    if (values.length !== dimensions) {
      throw new Error(
        `geminiEmbedder: '${model}' answered with a ${values.length}-number vector while this ` +
          `embedder reports .dimensions ${dimensions}. A store fingerprints on the reported ` +
          `number, so writing this vector would make the store's own record of its shape a lie. ` +
          `Pass { dimensions: ${values.length} } if that is the size you meant.`,
      );
    }
    if (row?.statistics?.truncated === true && onTruncation === 'refuse') {
      const chars = (texts[index] ?? '').length;
      throw new Error(
        `geminiEmbedder: '${model}' CLIPPED this input — it reported ` +
          `\`statistics.truncated\`, so the vector represents only the opening of the ` +
          `${chars.toLocaleString('en-US')}-character text it was given. Storing it would ` +
          `index a passage by a prefix of itself, and retrieval would then fail to find words ` +
          `the passage visibly contains.\n` +
          `  Fix 1 — cut smaller: pass \`maxChunkChars\` to the indexer (it wins over this ` +
          `embedder's declared .maxInputChars, which is a characters-per-token ASSUMPTION and ` +
          `is optimistic for code, tables and CJK).\n` +
          `  Fix 2 — \`onTruncation: 'allow'\` if a prefix embedding is genuinely what you ` +
          `want. The vector is returned unchanged; only this refusal goes away.`,
      );
    }
    return [...values];
  });
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
   * Longest input this model reads whole, in characters (9.1.0). Default
   * {@link LOCAL_MAX_INPUT_CHARS} — the MEASURED cliff of the default model.
   *
   * The option exists because `model` is swappable and the cliff belongs to
   * the MODEL, not to this factory. A long-context embedding model (one of the
   * 8k-token sentence-transformer builds) reads far more than the default
   * says, and without a way to state that, an indexer would keep cutting its
   * corpus into pieces a quarter the size the model can take. Nothing verifies
   * it — it is your model's documented window, declared for the indexer to
   * read.
   */
  readonly maxInputChars?: number;
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

/**
 * The MEASURED cliff of the default model, and the origin of the whole
 * mechanism: `Xenova/all-MiniLM-L6-v2` silently truncates at 512 wordpiece
 * tokens ≈ 1,800–2,000 characters of English. Measured directly — at 508 base
 * tokens an appended tail still moves the vector (cosine 0.9965); at 596 it
 * does not (0.999999). Nothing is thrown and nothing says so.
 *
 * It is the number `indexCorpus` used as its own default for every embedder,
 * which is why a hosted model with an 8k-token window was being cut into
 * pieces a sixteenth of what it could read. Here it is declared by the
 * embedder it was measured on, where it is true.
 */
const LOCAL_MAX_INPUT_CHARS = 2000;

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
    maxInputChars: options.maxInputChars ?? LOCAL_MAX_INPUT_CHARS,
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

/**
 * Declared input ceiling for the static path (9.1.0), and the one case where
 * the honest answer is "there isn't a cliff".
 *
 * A Model2Vec model has no transformer and therefore no context window: it
 * looks each token's vector up and pools them, so the ten-thousandth token
 * contributes exactly like the first. Nothing is dropped at any length. The
 * number is a practical bound (a megabyte of text), declared rather than
 * omitted so that an indexer does not fall back to a 2,000-character default
 * measured on a model with a real cliff and warn about clipping that never
 * happened.
 */
const STATIC_MAX_INPUT_CHARS = 1_000_000;

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
    // No context window to fall off — see the constant.
    maxInputChars: STATIC_MAX_INPUT_CHARS,
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
