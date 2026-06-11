/**
 * llmEdgeWeigher (RFC-003 D7) — unit / functional / determinism /
 * property / security tiers.
 *
 * D7 acceptance: a 12-parent hairball → ranked shortlist, deterministic
 * across fresh handles (and fresh caches).
 *
 * Fixtures RUN real flowcharts (no hand-built CommitBundles) so the
 * commit-log shapes stay honest to the engine. The "LLM call" is just a
 * designated step id — the weigher is agent-agnostic.
 */
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { causalChain, type CausalNode } from 'footprintjs/trace';
import type { CommitBundle, RuntimeSnapshot, StageSnapshot } from 'footprintjs/advanced';

import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { embeddingCache, type Embedder } from '../../../src/lib/influence-core';
import { llmEdgeWeigher, stepOutputText } from '../../../src/lib/context-bisect';

// ── Fixture: the 12-parent hairball ─────────────────────────────────

const ANSWER =
  'zebra quartz xylophone jubilee: the migration corridor crosses the quartz plateau at dawn.';

/** Parent texts with GRADED similarity to the answer (mock embedder =
 *  char frequency, so shared substrings → higher cosine). p0 shares the
 *  answer verbatim; later parents drift to pure digit noise. */
function parentValue(i: number): string {
  if (i === 0) return ANSWER; // verbatim reuse — must rank #1
  if (i < 4) return 'zebra quartz plateau migration notes, partially related field report.';
  if (i < 8) return 'standard operating procedure for filing cabinet maintenance requests.';
  return `${'0123456789'.repeat(8)} #${i}`; // digit noise — must rank last
}

interface Hairball {
  commitLog: CommitBundle[];
  snapshot: RuntimeSnapshot;
  llmId: string;
  keysRead: (id: string) => string[];
  dag: CausalNode;
}

async function runHairball(): Promise<Hairball> {
  type State = Record<string, string>;
  let builder = flowChart<State>(
    'P0',
    async (scope) => {
      scope.k0 = parentValue(0);
    },
    'p0',
  );
  for (let i = 1; i < 12; i++) {
    builder = builder.addFunction(
      `P${i}`,
      async (scope) => {
        (scope as Record<string, string>)[`k${i}`] = parentValue(i);
      },
      `p${i}`,
    );
  }
  const chart = builder
    .addFunction(
      'TheLLM',
      async (scope) => {
        // Read all 12 parents (the hairball), produce the answer.
        let touched = 0;
        for (let i = 0; i < 12; i++) touched += (scope as Record<string, string>)[`k${i}`].length;
        scope.answer = touched > 0 ? ANSWER : '';
      },
      'the-llm',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run({});
  const snapshot = executor.getSnapshot();
  const commitLog = snapshot.commitLog as CommitBundle[];

  const reads = new Map<string, string[]>();
  const visit = (node: StageSnapshot | undefined): void => {
    if (!node) return;
    if (node.runtimeStageId) reads.set(node.runtimeStageId, Object.keys(node.stageReads ?? {}));
    for (const child of node.children ?? []) visit(child);
    visit(node.next);
  };
  visit(snapshot.executionTree as StageSnapshot | undefined);
  const keysRead = (id: string): string[] => reads.get(id) ?? [];

  const llmId = commitLog.find((b) => b.stageId === 'the-llm')!.runtimeStageId;
  const dag = causalChain(commitLog, llmId, keysRead, { maxDepth: 5, maxNodes: 50 })!;
  return { commitLog, snapshot, llmId, keysRead, dag };
}

function freshWeigher(fixture: Hairball, embedder?: Embedder) {
  return llmEdgeWeigher({
    embedder: embedder ?? embeddingCache(mockEmbedder()),
    llmCallIds: [fixture.llmId],
    commitLog: fixture.commitLog,
  });
}

// ── Unit ─────────────────────────────────────────────────────────────

describe('llmEdgeWeigher — unit', () => {
  it('weigh() returns undefined before prime, for control edges, and for non-LLM children', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    const root = fixture.dag;
    const parent = root.parentEdges[0].parent;

    // Unprimed → undefined (engine default 1.0).
    expect(handle.weigh(root, parent, 'k0', 'data')).toBeUndefined();

    await handle.prime(root);
    // Control edges are never weighed (a routing decision is not content).
    expect(handle.weigh(root, parent, 'rule', 'control')).toBeUndefined();
    // Non-LLM child → undefined.
    expect(handle.weigh(parent, root, 'k0', 'data')).toBeUndefined();
    // Primed LLM data edge → a number in [0, 1].
    const weight = handle.weigh(root, parent, root.parentEdges[0].key, 'data');
    expect(typeof weight).toBe('number');
  });

  it('stepOutputText serializes committed values, capped, and is undefined off the log', async () => {
    const fixture = await runHairball();
    const lastIdxOf = new Map(fixture.commitLog.map((b, i) => [b.runtimeStageId, i] as const));
    const text = stepOutputText(fixture.commitLog, lastIdxOf, fixture.llmId, 2000);
    expect(text).toContain('answer=');
    expect(text).toContain('zebra quartz');
    expect(stepOutputText(fixture.commitLog, lastIdxOf, fixture.llmId, 10)!.length).toBe(10);
    expect(stepOutputText(fixture.commitLog, lastIdxOf, 'nope#9', 2000)).toBeUndefined();
  });

  it('rankedParents is empty for unknown / unprimed ids', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    expect(handle.rankedParents(fixture.llmId)).toEqual([]);
    expect(handle.rankedParents('ghost#0')).toEqual([]);
  });
});

// ── Functional: the hairball acceptance ──────────────────────────────

describe('llmEdgeWeigher — 12-parent hairball (D7 acceptance)', () => {
  it('ranks the verbatim-reuse parent #1 and digit noise last', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    await handle.prime(fixture.dag);

    const ranked = handle.rankedParents(fixture.llmId);
    expect(ranked).toHaveLength(12);
    expect(ranked[0].key).toBe('k0'); // verbatim answer reuse
    // Digit-noise parents (k8..k11) occupy the bottom of the shortlist.
    const bottomKeys = ranked.slice(-4).map((edge) => edge.key);
    expect(new Set(bottomKeys)).toEqual(new Set(['k8', 'k9', 'k10', 'k11']));
    // Mock-embedder discipline: assert RELATIVE ordering, not absolutes.
    expect(ranked[0].weight).toBeGreaterThan(ranked[11].weight);
  });

  it('re-slicing with the primed weigher stamps weights onto parentEdges', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    await handle.prime(fixture.dag);

    const weighted = causalChain(fixture.commitLog, fixture.llmId, fixture.keysRead, {
      maxDepth: 5,
      maxNodes: 50,
      weigh: handle.weigh,
    })!;
    const weights = weighted.parentEdges.map((edge) => edge.weight);
    expect(weights).toHaveLength(12);
    expect(weights.some((weight) => weight !== 1)).toBe(true);
  });
});

// ── Determinism ──────────────────────────────────────────────────────

describe('llmEdgeWeigher — determinism', () => {
  it('two fresh handles (fresh caches) produce identical rankings and weights', async () => {
    const fixture = await runHairball();
    const a = freshWeigher(fixture);
    const b = freshWeigher(fixture);
    await a.prime(fixture.dag);
    await b.prime(fixture.dag);
    expect(a.rankedParents(fixture.llmId)).toEqual(b.rankedParents(fixture.llmId));
  });

  it('prime is idempotent — re-priming changes nothing', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    await handle.prime(fixture.dag);
    const first = handle.rankedParents(fixture.llmId);
    await handle.prime(fixture.dag);
    expect(handle.rankedParents(fixture.llmId)).toEqual(first);
  });
});

// ── Property ─────────────────────────────────────────────────────────

describe('llmEdgeWeigher — property', () => {
  it('every weight is clamped to [0, 1] (negative composites floor at 0)', async () => {
    const fixture = await runHairball();
    const handle = freshWeigher(fixture);
    await handle.prime(fixture.dag);
    for (const edge of handle.rankedParents(fixture.llmId)) {
      expect(edge.weight).toBeGreaterThanOrEqual(0);
      expect(edge.weight).toBeLessThanOrEqual(1);
    }
  });

  it('consumer text overrides are honored', async () => {
    const fixture = await runHairball();
    const handle = llmEdgeWeigher({
      embedder: embeddingCache(mockEmbedder()),
      llmCallIds: [fixture.llmId],
      commitLog: fixture.commitLog,
      childTextOf: () => 'aaaa',
      // Identical parent texts → identical weights → ties keep slice order.
      parentTextOf: () => 'aaaa',
    });
    await handle.prime(fixture.dag);
    const ranked = handle.rankedParents(fixture.llmId);
    const distinct = new Set(ranked.map((edge) => edge.weight));
    expect(distinct.size).toBe(1);
    // Stable tie order = the slice's edge discovery order (k0..k11).
    expect(ranked.map((edge) => edge.key)).toEqual(Array.from({ length: 12 }, (_, i) => `k${i}`));
  });
});

// ── Security ─────────────────────────────────────────────────────────

describe('llmEdgeWeigher — security (redaction respected)', () => {
  it('the embedder never sees a value redacted by policy', async () => {
    const SECRET = 'SECRET-CARD-4242424242424242';
    type State = { cardNumber: string; note: string; answer: string };
    const chart = flowChart<State>(
      'Seed',
      async (scope) => {
        scope.cardNumber = SECRET;
        scope.note = 'public note';
      },
      'seed',
    )
      .addFunction(
        'TheLLM',
        async (scope) => {
          scope.answer = `processed ${scope.cardNumber.length} chars (${scope.note})`;
        },
        'the-llm',
      )
      .build();
    const executor = new FlowChartExecutor(chart);
    executor.setRedactionPolicy({ keys: ['cardNumber'] });
    await executor.run({});
    const snapshot = executor.getSnapshot();
    const commitLog = snapshot.commitLog as CommitBundle[];

    const reads = new Map<string, string[]>();
    const visit = (node: StageSnapshot | undefined): void => {
      if (!node) return;
      if (node.runtimeStageId) reads.set(node.runtimeStageId, Object.keys(node.stageReads ?? {}));
      for (const child of node.children ?? []) visit(child);
      visit(node.next);
    };
    visit(snapshot.executionTree as StageSnapshot | undefined);

    const llmId = commitLog.find((b) => b.stageId === 'the-llm')!.runtimeStageId;
    const dag = causalChain(commitLog, llmId, (id) => reads.get(id) ?? [])!;

    const seen: string[] = [];
    const inner = mockEmbedder();
    const spy: Embedder = {
      dimensions: inner.dimensions,
      embed: async (args) => {
        seen.push(args.text);
        return inner.embed(args);
      },
      embedBatch: async (args) => {
        seen.push(...args.texts);
        return inner.embedBatch(args);
      },
    };
    const handle = llmEdgeWeigher({ embedder: spy, llmCallIds: [llmId], commitLog });
    await handle.prime(dag);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join('\n')).not.toContain(SECRET);
    // The redacted edge still participates — with the placeholder text.
    expect(handle.rankedParents(llmId).map((edge) => edge.key)).toContain('cardNumber');
  });
});
