/**
 * toBacktrackTrace — the BacktrackTrace serializer for agentThinkingUI's
 * <BacktrackView> ("why?" board). Convention-3 tiers in one file:
 * unit (field mapping) · functional (full report → trace) · integration
 * (REAL localizer run → trace invariants) · property (random reports
 * never lie about ranks/bounds) · security (no field invention, report
 * redaction preserved) · performance/load (pure-mapper budgets).
 */
import { describe, expect, it } from 'vitest';

import { mockEmbedder } from '../../../src/index';
import {
  embeddingCache,
  llmCallIdsFromEvents,
  localizeContextBug,
  toBacktrackTrace,
  type BacktrackTrace,
  type ContextBugReport,
  type Suspect,
} from '../../../src/observe';
import { plantedScenario, runPlantedScenario, decisionChanged } from './plantedFactFixture';

/* ── builders ─────────────────────────────────────────────────────────── */

function suspect(partial: Partial<Suspect> & Pick<Suspect, 'kind'>): Suspect {
  return {
    source: 's#0',
    stageName: 'S',
    score: 1,
    structuralScore: 1,
    hasContentEvidence: false,
    edgePath: [],
    ...partial,
  } as Suspect;
}

function report(partial: Partial<ContextBugReport> = {}): ContextBugReport {
  return {
    step: 'call-llm#40',
    stepName: 'CallLLM',
    triggerSource: 'explicit',
    mode: 'causal',
    suspects: [],
    sliceStats: {
      nodes: 1,
      dataEdges: 0,
      controlEdges: 0,
      weightedEdges: 0,
      incompleteNodes: 0,
      maxDepth: 12,
      maxNodes: 80,
    },
    honestyFlags: [],
    ...partial,
  } as ContextBugReport;
}

const ANSWER = { text: 'Refund APPROVED wrongly', label: 'the wrong answer' } as const;

/* ── unit — field mapping ─────────────────────────────────────────────── */

describe('toBacktrackTrace — unit: field mapping', () => {
  it('maps the trigger to decidedAt and derives a default claim', () => {
    const t = toBacktrackTrace(report(), { answer: ANSWER });
    expect(t.decidedAt).toEqual({ id: 'call-llm#40', label: 'CallLLM', kind: 'llm' });
    expect(t.claim).toContain('CallLLM');
    expect(t.claim).toContain('call-llm#40');
    expect(t.answer).toEqual(ANSWER);
    const rule = toBacktrackTrace(report(), {
      answer: ANSWER,
      claim: 'why?',
      decidedAtKind: 'rule',
    });
    expect(rule.decidedAt.kind).toBe('rule');
    expect(rule.claim).toBe('why?');
  });

  it('names a suspect by injectionId, then toolName, then source', () => {
    const r = report({
      suspects: [
        suspect({
          kind: 'injection',
          detail: { injectionId: 'vip-fact', flavor: 'fact', text: 'planted' },
          hasContentEvidence: true,
        }),
        suspect({
          kind: 'tool',
          detail: { toolName: 'lookup_order', text: 'data' },
          hasContentEvidence: true,
        }),
        suspect({ kind: 'stage', source: 'normalize#1' }),
      ],
    });
    const names = toBacktrackTrace(r, { answer: ANSWER }).suspects.map((s) => s.name);
    expect(names).toEqual(['vip-fact', 'lookup_order', 'normalize#1']);
  });

  it('takes the suspect-adjacent edge (LAST edgePath hop) and emits the full path only when multi-hop', () => {
    const r = report({
      suspects: [
        suspect({
          kind: 'stage',
          source: 'normalize#1',
          edgePath: [
            {
              from: 'approve#3',
              fromName: 'Approve',
              to: 'adjudicate#2',
              toName: 'Adjudicate',
              kind: 'control',
              key: 'Prime credit',
              weight: 1,
            },
            {
              from: 'adjudicate#2',
              fromName: 'Adjudicate',
              to: 'normalize#1',
              toName: 'Normalize',
              kind: 'data',
              key: 'dti',
              weight: 1,
            },
          ],
        }),
        suspect({
          kind: 'injection',
          detail: { injectionId: 'i1' },
          hasContentEvidence: true,
          edgePath: [
            {
              from: 'call-llm#40',
              fromName: 'CallLLM',
              to: 'context#6',
              toName: 'Context',
              kind: 'data',
              key: 'systemPromptInjections',
              weight: 0.92,
            },
          ],
        }),
      ],
    });
    const [multi, single] = toBacktrackTrace(r, { answer: ANSWER }).suspects;
    expect(multi.edge).toEqual({ key: 'dti', weight: 1, kind: 'data' });
    expect(multi.path).toHaveLength(2);
    expect(multi.path?.[0]).toEqual({
      key: 'Prime credit',
      kind: 'control',
      via: 'approve#3 ← adjudicate#2',
    });
    expect(single.edge?.key).toBe('systemPromptInjections');
    expect(single.path).toBeUndefined(); // single hop — the edge chip already says it
  });

  it('upperBound mirrors !hasContentEvidence; bornAt.via follows the suspect kind', () => {
    const r = report({
      suspects: [
        suspect({ kind: 'injection', detail: { injectionId: 'i' }, hasContentEvidence: true }),
        suspect({ kind: 'arg', source: 'seed#0' }),
      ],
    });
    const [content, arg] = toBacktrackTrace(r, { answer: ANSWER }).suspects;
    expect(content.upperBound).toBeUndefined();
    expect(content.bornAt?.via).toBe('injection engine');
    expect(arg.upperBound).toBe(true);
    expect(arg.bornAt?.via).toContain('untracked');
  });

  it('maps confirmed/not-confirmed verdicts with runs; INCONCLUSIVE maps to NO verdict (no stamp)', () => {
    const r = report({
      suspects: [
        suspect({
          kind: 'injection',
          detail: { injectionId: 'a' },
          verdict: { verdict: 'confirmed', claim: 'CAUSAL: flipped 3/3' },
          runs: { samples: 3, flips: 3, similarity: { mean: 0.9, min: 0.9, max: 0.9, stdev: 0 } },
        }),
        suspect({
          kind: 'injection',
          detail: { injectionId: 'b' },
          verdict: { verdict: 'not-confirmed', claim: 'no flip' },
          runs: { samples: 3, flips: 0, similarity: { mean: 1, min: 1, max: 1, stdev: 0 } },
        }),
        suspect({
          kind: 'injection',
          detail: { injectionId: 'c' },
          verdict: { verdict: 'inconclusive', claim: 'mixed' },
        }),
      ],
    });
    const [a, b, c] = toBacktrackTrace(r, { answer: ANSWER }).suspects;
    expect(a.verdict).toEqual({
      kind: 'confirmed',
      flips: 3,
      samples: 3,
      claim: 'CAUSAL: flipped 3/3',
    });
    expect(b.verdict?.kind).toBe('not-confirmed');
    expect(c.verdict).toBeUndefined(); // never invent a causal-tier signal from a mixed result
  });

  it('honesty = report flags verbatim (⚠-prefixed) + the claims-discipline lines, and baseline is phrased', () => {
    const r = report({
      honestyFlags: [{ flag: 'untracked-sources', note: '1 node consumed args/env.' }],
      baseline: { samples: 3, flips: 0, similarity: { mean: 1, min: 1, max: 1, stdev: 0 } },
    });
    const t = toBacktrackTrace(r, { answer: ANSWER });
    expect(t.honesty?.[0]).toBe('⚠ untracked-sources: 1 node consumed args/env.');
    expect(t.honesty?.some((h) => h.includes('only ablation verdicts make causal claims'))).toBe(
      true,
    );
    expect(t.baseline).toBe('0/3 flipped with no ablation');
  });
});

/* ── functional — selection, folding, score note ──────────────────────── */

describe('toBacktrackTrace — functional: selection + folding', () => {
  const seven = () =>
    report({
      suspects: [
        suspect({ kind: 'arg', source: 'seed#0', score: 1 }),
        suspect({ kind: 'stage', source: 'call-llm#18', score: 1 }),
        suspect({ kind: 'stage', source: 'sf-route#21', score: 1 }),
        suspect({ kind: 'stage', source: 'sf-cache#14', score: 0.88 }),
        suspect({
          kind: 'injection',
          detail: { injectionId: 'vip' },
          score: 0.85,
          hasContentEvidence: true,
        }),
        suspect({
          kind: 'injection',
          detail: { injectionId: 'style' },
          score: 0.84,
          hasContentEvidence: true,
        }),
        suspect({
          kind: 'tool',
          detail: { toolName: 'lookup' },
          score: 0.71,
          hasContentEvidence: true,
        }),
      ],
    });

  it('prefers content-evidence cards by default, keeps TRUE ranks, folds the rest with full disclosure', () => {
    const t = toBacktrackTrace(seven(), { answer: ANSWER, maxSuspects: 4 });
    const ranks = t.suspects.map((s) => s.rank);
    expect(ranks).toEqual([1, 5, 6, 7]); // 3 content cards + the best structural, in rank order
    expect(t.folded).toContain('3 more suspects folded');
    expect(t.folded).toContain('#2 call-llm#18');
    expect(t.folded).toContain('trace toolpack');
  });

  it('preferContentEvidence:false takes strictly the top-N', () => {
    const t = toBacktrackTrace(seven(), {
      answer: ANSWER,
      maxSuspects: 3,
      preferContentEvidence: false,
    });
    expect(t.suspects.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(t.folded).toContain('4 more suspects folded');
  });

  it('no folding when everything fits; folded notes path-only when ALL dropped are structural', () => {
    const all = toBacktrackTrace(seven(), { answer: ANSWER, maxSuspects: 10 });
    expect(all.folded).toBeUndefined();
    const t = toBacktrackTrace(seven(), { answer: ANSWER, maxSuspects: 5 });
    expect(t.folded).toContain('path-only upper bounds');
  });

  it('auto score note only on a genuine top-2 tie; consumer override wins', () => {
    const tie = toBacktrackTrace(seven(), { answer: ANSWER });
    expect(tie.scoreNote).toContain('top-2 margin 0.00');
    expect(tie.scoreNote).toContain('ablation test can'); // causal mode
    const spread = report({
      mode: 'correlational',
      suspects: [suspect({ kind: 'stage', score: 0.9 }), suspect({ kind: 'stage', score: 0.5 })],
    });
    expect(toBacktrackTrace(spread, { answer: ANSWER }).scoreNote).toBeUndefined();
    expect(toBacktrackTrace(seven(), { answer: ANSWER, scoreNote: 'mine' }).scoreNote).toBe('mine');
  });

  it('custody callback enriches by suspect with its true rank; trail passes through', () => {
    const trail = { title: 'the trail', custody: [{ step: 'wrote', detail: 'dti = 0.035' }] };
    const t = toBacktrackTrace(seven(), {
      answer: ANSWER,
      trail,
      custody: (s, rank) =>
        s.detail?.injectionId === 'vip'
          ? [{ step: 'read', detail: `rank ${rank} saw it` }]
          : undefined,
    });
    const vip = t.suspects.find((s) => s.name === 'vip');
    expect(vip?.custody?.[0].detail).toBe('rank 5 saw it');
    expect(t.trail).toEqual(trail);
  });
});

/* ── integration — REAL localizer run → trace invariants ──────────────── */

describe('toBacktrackTrace — integration: real planted-fact run', () => {
  it('serializes a real causal report; the confirmed culprit survives with its verdict and true rank', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario, []);
    const embedder = embeddingCache(mockEmbedder());
    const llmIds = llmCallIdsFromEvents(original.events);
    const reportReal = await localizeContextBug({
      artifacts: {
        snapshot: original.snapshot,
        controlDeps: original.controlDeps,
        events: original.events,
      },
      embedder,
      atStep: llmIds[llmIds.length - 1],
      rerun: {
        runner: async (specs) => (await runPlantedScenario(scenario, specs)).content,
        originalOutput: original.content,
        samples: 2,
        outcomeChanged: decisionChanged,
      },
    });

    const t: BacktrackTrace = toBacktrackTrace(reportReal, {
      answer: { text: original.content, label: 'the wrong answer' },
      claim: 'why approved?',
    });

    expect(t.mode).toBe('causal');
    expect(t.decidedAt.id).toBe(llmIds[llmIds.length - 1]);
    const confirmed = t.suspects.filter((s) => s.verdict?.kind === 'confirmed');
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    expect(confirmed[0].name).toBe(scenario.plantedFact.id);
    // true-rank invariant: the card's rank matches its position in the report
    for (const card of t.suspects) {
      expect(reportReal.suspects[card.rank - 1]).toBeDefined();
      const src = reportReal.suspects[card.rank - 1];
      expect(card.score).toBe(src.score);
      expect(card.upperBound === true).toBe(!src.hasContentEvidence);
    }
    // honesty rides along
    expect(t.honesty?.some((h) => h.includes('causal claims'))).toBe(true);
  }, 30_000);
});

/* ── property — random reports never lie ──────────────────────────────── */

describe('toBacktrackTrace — property: rank/bound invariants under fuzz', () => {
  it('for ANY suspect list: ranks are true positions, count caps at maxSuspects, folded discloses the rest', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rnd() * 12);
      const suspects = Array.from({ length: n }, (_, i) =>
        suspect({
          kind: (['injection', 'tool', 'stage', 'arg'] as const)[Math.floor(rnd() * 4)],
          source: `s#${i}`,
          score: Math.round(rnd() * 100) / 100,
          hasContentEvidence: rnd() > 0.5,
        }),
      );
      const max = 1 + Math.floor(rnd() * 8);
      const t = toBacktrackTrace(report({ suspects }), { answer: ANSWER, maxSuspects: max });
      expect(t.suspects.length).toBeLessThanOrEqual(max);
      const ranks = t.suspects.map((s) => s.rank);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks); // cards in rank order
      for (const card of t.suspects) {
        const src = suspects[card.rank - 1];
        expect(card.score).toBe(src.score); // rank really points at its source
        expect(card.upperBound === true).toBe(!src.hasContentEvidence);
      }
      if (n > max) expect(t.folded).toContain(`${n - Math.min(n, max)} more`);
      else expect(t.folded).toBeUndefined();
    }
  });
});

/* ── security — nothing invented, redaction preserved ─────────────────── */

describe('toBacktrackTrace — security: no field invention, redaction preserved', () => {
  it('suspect text passes through EXACTLY as the report carries it (already-redacted stays redacted)', () => {
    const r = report({
      suspects: [
        suspect({
          kind: 'injection',
          detail: { injectionId: 'i', text: 'user [REDACTED] window' },
          hasContentEvidence: true,
        }),
      ],
    });
    expect(toBacktrackTrace(r, { answer: ANSWER }).suspects[0].text).toBe('user [REDACTED] window');
  });

  it('emits no fields beyond the BacktrackTrace contract and never fabricates custody/verdict/trail', () => {
    const t = toBacktrackTrace(report({ suspects: [suspect({ kind: 'stage' })] }), {
      answer: ANSWER,
    });
    expect(t.suspects[0].custody).toBeUndefined();
    expect(t.suspects[0].verdict).toBeUndefined();
    expect(t.trail).toBeUndefined();
    const allowed = new Set([
      'claim',
      'mode',
      'modeLabel',
      'agent',
      'model',
      'answer',
      'decidedAt',
      'suspects',
      'trail',
      'folded',
      'scoreNote',
      'baseline',
      'honesty',
    ]);
    for (const k of Object.keys(t)) expect(allowed.has(k)).toBe(true);
  });
});

/* ── performance / load — pure-mapper budgets ─────────────────────────── */

describe('toBacktrackTrace — performance/load', () => {
  it('serializes a 5k-suspect report well under 200ms and survives 1k repeated calls', () => {
    const big = report({
      suspects: Array.from({ length: 5000 }, (_, i) =>
        suspect({
          kind: 'stage',
          source: `s#${i}`,
          score: 1 - i / 5000,
          hasContentEvidence: i % 3 === 0,
        }),
      ),
    });
    const t0 = performance.now();
    const t = toBacktrackTrace(big, { answer: ANSWER, maxSuspects: 6 });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(t.suspects.length).toBe(6);

    const small = report({ suspects: [suspect({ kind: 'stage' })] });
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) toBacktrackTrace(small, { answer: ANSWER });
    expect(performance.now() - t1).toBeLessThan(500);
  });
});
