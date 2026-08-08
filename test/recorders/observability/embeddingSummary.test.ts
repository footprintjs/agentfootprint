/**
 * Embedding summarisation at the recording boundary (8.20.0) — R4 of the
 * second production RAG field report.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * The measurement this pins: a retrieval turn's recording weighed 2.76 MB,
 * ~1.1 MB of it embedding floats, because the memory-read subflow's boundary
 * output carries each retrieved entry's full vector. No consumer of a
 * recording reads those floats. The law: recordings keep a vector's SHAPE
 * (`{ dims, norm }`), never its bytes — unless `recordEmbeddings: true` asks
 * for the bytes back. Retrieval evidence (scores, passages, documents,
 * rejected candidates) is untouched.
 */

import { describe, expect, it } from 'vitest';

import {
  boundaryRecorder,
  recordRun,
  summarizeEmbeddings,
  summarizeVector,
  type EmbeddingSummary,
} from '../../../src/observe.js';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { defineRAG, indexDocuments } from '../../../src/index.js';
import { InMemoryStore, mockEmbedder } from '../../../src/doors/memory.js';

// ─── Unit ──────────────────────────────────────────────────────────

describe('summarizeEmbeddings — unit', () => {
  it('replaces an `embedding` numeric array with { dims, norm }', () => {
    const entry = { id: 'a', value: { content: 'x' }, embedding: [3, 4] };
    const out = summarizeEmbeddings(entry) as { embedding: EmbeddingSummary };
    expect(out.embedding).toEqual({ dims: 2, norm: 5 });
  });

  it('replaces a write-side `embeddings` batch, one summary per vector', () => {
    const state = {
      embeddings: [
        [3, 4],
        [0, 0, 2],
      ],
    };
    const out = summarizeEmbeddings(state) as { embeddings: EmbeddingSummary[] };
    expect(out.embeddings).toEqual([
      { dims: 2, norm: 5 },
      { dims: 3, norm: 2 },
    ]);
  });

  it('is copy-on-write: a value with no embeddings comes back BY REFERENCE', () => {
    const value = { loaded: [{ id: 'a', value: { content: 'passage' } }], retrieved: { k: 3 } };
    expect(summarizeEmbeddings(value)).toBe(value);
  });

  it('never mutates its input — the original keeps its floats', () => {
    const entry = { id: 'a', embedding: [1, 0] };
    const wrapper = { loaded: [entry] };
    const out = summarizeEmbeddings(wrapper);
    expect(out).not.toBe(wrapper);
    expect(entry.embedding).toEqual([1, 0]);
  });

  it('is idempotent — a summary is not a vector, so a second pass changes nothing', () => {
    const once = summarizeEmbeddings({ embedding: [3, 4] });
    expect(summarizeEmbeddings(once)).toBe(once);
  });

  it('summarizeVector rounds the norm to 4 decimals — a checksum, not an operand', () => {
    expect(summarizeVector([0.1, 0.1]).norm).toBe(0.1414);
  });
});

// ─── Boundary ──────────────────────────────────────────────────────

describe('summarizeEmbeddings — boundary', () => {
  it('leaves an EMPTY embedding array alone — nothing to summarise', () => {
    const value = { embedding: [] as number[] };
    expect(summarizeEmbeddings(value)).toBe(value);
  });

  it('leaves a non-numeric `embedding` field alone — the key is not enough', () => {
    const value = { embedding: ['not', 'a', 'vector'] };
    expect(summarizeEmbeddings(value)).toBe(value);
  });

  it('walks arrays and nested objects, replacing only where vectors live', () => {
    const value = {
      turns: [{ loaded: [{ id: 'a', embedding: [1, 0], value: { content: 'kept' } }] }],
    };
    const out = summarizeEmbeddings(value) as typeof value & {
      turns: { loaded: { embedding: EmbeddingSummary; value: { content: string } }[] }[];
    };
    expect(out.turns[0]?.loaded[0]?.embedding).toEqual({ dims: 2, norm: 1 });
    expect(out.turns[0]?.loaded[0]?.value.content).toBe('kept');
  });

  it('treats class instances as opaque and survives cycles', () => {
    class Live {
      embedding = [1, 2, 3];
    }
    const live = new Live();
    expect(summarizeEmbeddings(live)).toBe(live);

    const cyclic: Record<string, unknown> = { embedding: [3, 4] };
    cyclic.self = cyclic;
    // Must terminate; the embedding at the top level is still summarised.
    const out = summarizeEmbeddings(cyclic) as { embedding: EmbeddingSummary };
    expect(out.embedding).toEqual({ dims: 2, norm: 5 });
  });
});

// ─── Scenario + integration — a real retrieval turn, recorded ──────

async function recordedRetrievalTurn(options?: { recordEmbeddings?: boolean }) {
  const store = new InMemoryStore();
  const embedder = mockEmbedder();
  await indexDocuments(store, embedder, [
    {
      id: 'refunds.md#0',
      content: 'Refunds are processed within three business days of the approval.',
      metadata: { source: 'refunds.md' },
    },
    {
      id: 'pricing.md#0',
      content: 'The Pro plan costs twenty dollars per month including support.',
      metadata: { source: 'pricing.md' },
    },
  ]);

  const agent = Agent.create({ provider: mock({ reply: 'three days' }), model: 'mock' })
    .rag(defineRAG({ id: 'docs', store, embedder, threshold: 0, topK: 2 }))
    .build();

  const recorder = recordRun(agent, options);
  await agent.run({ message: 'How long do refunds take?' });
  const recording = recorder.toRecording();
  recorder.stop();
  return recording;
}

/** Depth-first hunt for raw float vectors under `embedding`/`embeddings` keys. */
function findRawVectors(value: unknown, seen = new WeakSet<object>()): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const hits: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) hits.push(...findRawVectors(item, seen));
    return hits;
  }
  for (const [key, field] of Object.entries(value)) {
    const isVector =
      Array.isArray(field) && field.length > 0 && field.every((v) => typeof v === 'number');
    const isBatch =
      Array.isArray(field) &&
      field.some((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number'));
    if ((key === 'embedding' && isVector) || (key === 'embeddings' && isBatch)) {
      hits.push(key);
    }
    hits.push(...findRawVectors(field, seen));
  }
  return hits;
}

describe('recordings — scenario & integration', () => {
  it('a retrieval turn records NO raw vector anywhere: boundary payloads, snapshot, events', async () => {
    const recording = await recordedRetrievalTurn();
    expect(findRawVectors(recording.snapshot)).toEqual([]);
    expect(findRawVectors(recording.events)).toEqual([]);
  }, 20000);

  it('what the debugger needs survives: scores, candidates, passages in the evidence', async () => {
    const recording = await recordedRetrievalTurn();
    const serialized = JSON.stringify(recording);
    // The retrieval evidence still names both candidates with their scores…
    expect(serialized).toContain('refunds.md');
    expect(serialized).toContain('pricing.md');
    expect(serialized).toContain('"score"');
    // …and the vectors are present as summaries, not bytes.
    expect(serialized).toContain('"dims"');
    expect(serialized).toContain('"norm"');
  }, 20000);

  it('recordEmbeddings: true restores the raw vectors', async () => {
    const recording = await recordedRetrievalTurn({ recordEmbeddings: true });
    const hits = findRawVectors(recording.snapshot);
    expect(hits.length).toBeGreaterThan(0);
  }, 20000);

  it('the summarised recording is measurably smaller than the raw one', async () => {
    const lean = JSON.stringify(await recordedRetrievalTurn()).length;
    const raw = JSON.stringify(await recordedRetrievalTurn({ recordEmbeddings: true })).length;
    expect(lean).toBeLessThan(raw);
  }, 30000);
});

// ─── Security ──────────────────────────────────────────────────────

describe('recordings — security', () => {
  it('summarisation only REMOVES information — no field of the payload gains content', () => {
    const payload = { secret: 'stays-as-is', embedding: [1, 2, 3] };
    const out = summarizeEmbeddings(payload) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['embedding', 'secret']);
    expect(out.secret).toBe('stays-as-is');
  });
});

// ─── Refusal (of the silent kind: the recorder option is honoured) ─

describe('boundaryRecorder — recordEmbeddings option', () => {
  it('summarises subflow payloads by default and keeps them raw when opted in', () => {
    const summarising = boundaryRecorder();
    const keeping = boundaryRecorder({ recordEmbeddings: true });
    const flowEvent = {
      subflowId: 'sf-memory-read-docs',
      name: 'Load Memory',
      outputState: { loaded: [{ id: 'a', embedding: [3, 4], value: { content: 'p' } }] },
      traversalContext: { runtimeStageId: 'sf#1', runId: 'r1' },
    };
    summarising.onSubflowExit(flowEvent as never);
    keeping.onSubflowExit(flowEvent as never);

    const summarised = summarising.getEvents()[0] as { payload?: unknown };
    const kept = keeping.getEvents()[0] as { payload?: unknown };
    expect(findRawVectors(summarised.payload)).toEqual([]);
    expect(findRawVectors(kept.payload)).toEqual(['embedding']);
    // The evidence-shaped fields around the vector are untouched.
    expect(JSON.stringify(summarised.payload)).toContain('"content":"p"');
  });
});
