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
 */
import type { Embedder } from '../memory/embedding/types.js';

// ---------------------------------------------------------------------------
// OpenAI (hosted) — no extra dependency, just a fetch + an API key.
// ---------------------------------------------------------------------------

export interface OpenAIEmbedderOptions {
  /** Default: process.env.OPENAI_API_KEY. */
  readonly apiKey?: string;
  /** Default: 'text-embedding-3-small'. */
  readonly model?: string;
  /** Vector length the model returns. Default 1536 (text-embedding-3-small). */
  readonly dimensions?: number;
  /** Override the API base (Azure/OpenAI-compatible gateways). */
  readonly baseURL?: string;
}

export function openaiEmbedder(options: OpenAIEmbedderOptions = {}): Embedder {
  const apiKey =
    options.apiKey ??
    (typeof process !== 'undefined' ? process.env?.['OPENAI_API_KEY'] : undefined);
  if (!apiKey || !apiKey.trim()) {
    throw new Error('openaiEmbedder: no API key — set OPENAI_API_KEY or pass { apiKey }.');
  }
  const model = options.model ?? 'text-embedding-3-small';
  const dimensions = options.dimensions ?? 1536;
  const url = `${options.baseURL ?? 'https://api.openai.com/v1'}/embeddings`;

  async function call(input: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input }),
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

export interface LocalEmbedderOptions {
  /** ONNX model id. Default 'Xenova/all-MiniLM-L6-v2' (384-dim). */
  readonly model?: string;
  /** Vector length of the model. Default 384. */
  readonly dimensions?: number;
  /** Quantization. Default 'q8' (smallest); use 'fp32' for max fidelity. */
  readonly dtype?: string;
  /** On-disk model cache directory. */
  readonly cacheDir?: string;
}

interface FeaturePipeline {
  (text: unknown, opts: unknown): Promise<{ data: ArrayLike<number>; tolist(): number[][] }>;
}

export function localEmbedder(options: LocalEmbedderOptions = {}): Embedder {
  const model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
  const dimensions = options.dimensions ?? 384;
  const dtype = options.dtype ?? 'q8';
  let pipe: Promise<FeaturePipeline> | undefined;

  const getPipe = (): Promise<FeaturePipeline> => {
    // Variable specifier so the compiler/bundler does NOT resolve the module at
    // build time — @huggingface/transformers stays an optional peer dep, loaded
    // only when localEmbedder is actually used.
    const spec = '@huggingface/transformers';
    return (pipe ??= import(spec).then((mod: unknown) => {
      const m = mod as {
        pipeline: (task: string, model: string, opts: unknown) => Promise<FeaturePipeline>;
        env: Record<string, unknown>;
      };
      if (options.cacheDir) m.env['cacheDir'] = options.cacheDir;
      return m.pipeline('feature-extraction', model, { dtype });
    }));
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

export interface StaticEmbedderOptions {
  /** Vector length of the bundled model. Default 256 (potion-base-8m). */
  readonly dimensions?: number;
  /** Override the package specifier for a different Model2Vec build. */
  readonly module?: string;
}

/** A batch embed fn: text(s) → array of vectors, one per input (potion's shape). */
type StaticEmbedFn = (texts: readonly string[]) => unknown;

export function staticEmbedder(options: StaticEmbedderOptions = {}): Embedder {
  const dimensions = options.dimensions ?? 256;
  const spec = options.module ?? '@yarflam/potion-base-8m';
  let embedFn: Promise<StaticEmbedFn> | undefined;

  const getEmbed = (): Promise<StaticEmbedFn> => {
    return (embedFn ??= import(spec).then((mod: unknown) => {
      // potion-base-8m exports `embed(texts) => Promise<Float32Array[]>` (a batch
      // async fn, also on its default export). Accept a small set of shapes so
      // other Model2Vec builds slot in: a named `embed`/`encode` on the module or
      // its default, or a default export that IS the fn.
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
          `staticEmbedder: no embed()/encode() export on '${spec}'. Pass { module } or wrap it in your own Embedder.`,
        );
      }
      return fn;
    }));
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
