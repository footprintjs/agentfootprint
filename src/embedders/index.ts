/**
 * agentfootprint/embedders — ready-made {@link Embedder} implementations for the
 * embedding-backed scorers (memory retrieval, toolChoiceRecorder / scoreMargin).
 *
 * The core deliberately ships only `mockEmbedder` (bring-your-own). These are
 * OPTIONAL and never pulled into the core: each heavy backend is an OPTIONAL
 * PEER DEPENDENCY, imported LAZILY on first embed, so you install ONLY the one
 * you use and agentfootprint stays dependency-free.
 *
 *   openaiEmbedder() — hosted; needs OPENAI_API_KEY; no extra install (fetch).
 *   localEmbedder()  — on-device sentence-transformer; no key; offline after a
 *                      one-time model fetch. peer dep: @huggingface/transformers.
 *   staticEmbedder() — pure-JS Model2Vec static vectors; no key, no network
 *                      (weights bundled). peer dep: @yarflam/potion-base-8m.
 *
 * All three satisfy the same `Embedder` shape, so they drop into
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
    async embed({ text, signal }) {
      return (await call([text], signal))[0];
    },
    async embedBatch({ texts, signal }) {
      return call([...texts], signal);
    },
  };
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
