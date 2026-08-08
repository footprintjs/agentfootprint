/**
 * embeddingSummary — what a recording keeps of a vector: its shape, not its
 * bytes.
 *
 * Pattern: pure copy-on-write projection, in the `storedPreview` family —
 *          "summarise structured values rather than serialize them", applied
 *          to the one field measured to dominate a recording's size.
 * Role:    recorders/observability layer. Applied at the RECORDING boundary
 *          (BoundaryRecorder payload capture, `recordRun` freeze), never to
 *          live run state — stages and stores keep their real vectors.
 * Emits:   N/A.
 *
 * ── The measurement this exists for ─────────────────────────────────────────
 * A single retrieval turn's recording measured 2.76 MB in a production RAG
 * deployment — about 1.1 MB of it embedding floats, because the memory-read
 * subflow's boundary output carries every retrieved entry, and every entry
 * carries its full vector (1,024 floats serializing at ~19 bytes each). No
 * consumer of a recording reads those floats: retrieval debugging needs the
 * score, the passage, the document and the rejected candidates — all of which
 * live in the retrieval evidence and none of which this touches. The vector's
 * only recording-worthy facts are that it existed, its dimensionality, and a
 * checksum-grade magnitude. That is exactly what `{ dims, norm }` keeps.
 *
 * The walk is copy-on-write: a value with no embeddings anywhere is returned
 * BY REFERENCE, so the common payload costs one traversal and zero
 * allocation. It never mutates its input — recordings share structure with
 * live run state, and live state is borrowed, not owned.
 *
 * Two spellings are recognised, because the memory layer writes both:
 *   - `embedding: number[]`     — a `MemoryEntry`'s vector (read side);
 *   - `embeddings: number[][]`  — the write pipeline's per-message batch.
 *
 * Idempotent by construction: a summary is not a numeric array, so a value
 * that has already been summarised passes through unchanged.
 */

/** What remains of a vector in a recording: dimensionality and L2 norm. */
export interface EmbeddingSummary {
  readonly dims: number;
  readonly norm: number;
}

/** Round to 4 decimals — a checksum, not an operand. */
function l2norm(vector: readonly number[]): number {
  let sum = 0;
  for (const v of vector) sum += v * v;
  return Math.round(Math.sqrt(sum) * 1e4) / 1e4;
}

function isNumericVector(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number');
}

/** Summarise one vector. Exported for consumers that render recordings. */
export function summarizeVector(vector: readonly number[]): EmbeddingSummary {
  return { dims: vector.length, norm: l2norm(vector) };
}

/**
 * Replace every `embedding` / `embeddings` field in a JSON-ish value with its
 * `{ dims, norm }` summary. Copy-on-write: returns the SAME reference when
 * nothing needed replacing; otherwise a structurally-shared copy. Never
 * mutates the input.
 *
 * Shared nodes stay shared: a snapshot holds the same entry object at several
 * paths (live state, stage writes, commit history), so results are memoized
 * per input object — every path gets the SAME summarized copy, not one copy
 * and one raw leak. Cycle-safe: an object seen again while still being walked
 * resolves to its original reference (a cyclic value could not be serialized
 * anyway).
 */
export function summarizeEmbeddings(value: unknown): unknown {
  return walk(value, new WeakMap());
}

function walk(value: unknown, memo: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (memo.has(value)) return memo.get(value);
  // Placeholder for cycles: a back-edge met mid-walk resolves to the original.
  memo.set(value, value);

  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const walked = walk(value[i], memo);
      if (walked !== value[i]) {
        copy ??= [...value];
        copy[i] = walked;
      }
    }
    const result = copy ?? value;
    memo.set(value, result);
    return result;
  }

  // Walk plain objects only. Class instances, Dates, Maps and the like are
  // opaque values here — the recording layer stores POJOs, and reaching into
  // somebody's live object to rewrite a field is what "never mutate" forbids.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, field] of Object.entries(record)) {
    let replacement: unknown = field;
    if (key === 'embedding' && isNumericVector(field)) {
      replacement = summarizeVector(field);
    } else if (key === 'embeddings' && Array.isArray(field) && field.some(isNumericVector)) {
      replacement = field.map((v) => (isNumericVector(v) ? summarizeVector(v) : walk(v, memo)));
    } else {
      replacement = walk(field, memo);
    }
    if (replacement !== field) {
      copy ??= { ...record };
      copy[key] = replacement;
    }
  }
  const result = copy ?? value;
  memo.set(value, result);
  return result;
}
