/**
 * The intent scorers (SG-C): the widened keyword/embedding factories (same
 * names, a second arity — EntryScorer callers byte-unaffected), the
 * constrained-enum llmClassifier, and the framework's result validation.
 *
 * Sections follow Convention 3: Unit · Functional · Security.
 */

import { describe, it, expect } from 'vitest';
import {
  keywordScorer,
  embeddingScorer,
  llmClassifier,
  validateIntentScores,
  type IntentCandidate,
} from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

const candidates: IntentCandidate[] = [
  { id: 'billing', intent: 'customer wants a refund', examples: ['refund my order'] },
  { id: 'shipping', intent: 'customer asks about delivery', examples: ['where is my parcel'] },
];

describe('unit: keywordScorer — both arities of one factory', () => {
  it('entry arity is byte-identical to before (EntryScoring shape, winner by overlap)', () => {
    const scoring = keywordScorer().score({
      userMessage: 'I want a refund',
      candidates: [
        { id: 'billing', description: 'refunds and charges' },
        { id: 'shipping', description: 'parcel delivery' },
      ],
    });
    expect(scoring.scorer).toBe('keyword');
    expect(scoring.chosen).toBe('billing');
  });

  it('intent arity scores intent + example tokens, floor 0, one score per candidate', () => {
    const scorer = keywordScorer();
    expect(scorer.floor).toBe(0);
    const scores = scorer.score({ message: 'refund my order please' }, candidates);
    expect(Array.isArray(scores)).toBe(true);
    const list = scores as readonly { id: string; score: number }[];
    expect(list.map((s) => s.id)).toEqual(['billing', 'shipping']);
    expect(list[0]!.score).toBeGreaterThan(list[1]!.score);
  });

  it('zero token overlap scores 0 — the honest "did not match at all"', () => {
    const scores = keywordScorer().score({ message: 'zzzz qqqq' }, candidates) as readonly {
      id: string;
      score: number;
    }[];
    expect(scores.every((s) => s.score === 0)).toBe(true);
  });
});

describe('unit: embeddingScorer — no floor unless declared', () => {
  /** A deterministic mock embedder with ~8%-separation vectors — the field
   *  case that makes an absolute embedding threshold a lie by default. */
  const nearTieEmbedder = {
    id: 'near-tie-mock',
    embed: async ({ text }: { text: string }) => {
      if (text.includes('refund')) return [1, 0.55]; // the message ≈ both
      if (text.includes('delivery') || text.includes('parcel')) return [1, 0.5];
      return [1, 0.62];
    },
  };

  it('declares NO floor by default; { floor } opts in', () => {
    expect(embeddingScorer(nearTieEmbedder).floor).toBeUndefined();
    expect(embeddingScorer(nearTieEmbedder, { floor: 0.3 }).floor).toBe(0.3);
  });

  it('intent arity embeds message + one text per candidate and cosine-scores them', async () => {
    const scores = await embeddingScorer(nearTieEmbedder).score(
      { message: 'refund my order' },
      candidates,
    );
    expect(scores.map((s) => s.id)).toEqual(['billing', 'shipping']);
    // Clustered cosines — the separations stay single-digit-%: near-tie land.
    const [a, b] = scores;
    expect(Math.abs(a!.score - b!.score)).toBeLessThan(0.1);
  });

  it('entry arity keeps its exact prior shape', async () => {
    const scoring = await embeddingScorer(nearTieEmbedder).score({
      userMessage: 'refund',
      candidates: [{ id: 'x', description: 'refund desk' }],
    });
    expect(scoring.scorer).toBe('embedding');
    expect(scoring.chosen).toBe('x');
  });
});

describe('functional: llmClassifier — constrained enum, never free text', () => {
  it('forced-tool path: a picked id maps to one-hot scores', async () => {
    const provider = mock({
      respond: (req) => {
        // The synthetic tool is on the wire with the enum + 'none'.
        const tool = req?.tools?.find((t) => t.name === 'pick_intent');
        expect(tool).toBeDefined();
        const enumIds = (tool?.inputSchema as { properties?: { intent?: { enum?: string[] } } })
          .properties?.intent?.enum;
        expect(enumIds).toEqual(['billing', 'shipping', 'none']);
        expect(req?.toolChoice).toEqual({ type: 'tool', name: 'pick_intent' });
        return {
          content: '',
          toolCalls: [{ id: 't1', name: 'pick_intent', args: { intent: 'billing' } }],
          stopReason: 'tool_use' as const,
        };
      },
    });
    const scorer = llmClassifier(provider, { model: 'mock-model' });
    expect(scorer.categorical).toBe(true);
    expect(scorer.floor).toBe(0);
    const scores = await scorer.score({ message: 'refund my order' }, candidates);
    expect(scores).toEqual([
      { id: 'billing', score: 1 },
      { id: 'shipping', score: 0 },
    ]);
  });

  it("forced-tool path: 'none' (and an off-enum answer) map to all-zero scores", async () => {
    const none = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 't1', name: 'pick_intent', args: { intent: 'none' } }],
        stopReason: 'tool_use' as const,
      }),
    });
    expect(await llmClassifier(none).score({ message: 'x' }, candidates)).toEqual([
      { id: 'billing', score: 0 },
      { id: 'shipping', score: 0 },
    ]);
    const offEnum = mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 't1', name: 'pick_intent', args: { intent: 'fabricated-id' } }],
        stopReason: 'tool_use' as const,
      }),
    });
    // An off-enum answer is a parse failure, not a route — never a foreign id.
    expect(await llmClassifier(offEnum).score({ message: 'x' }, candidates)).toEqual([
      { id: 'billing', score: 0 },
      { id: 'shipping', score: 0 },
    ]);
  });

  it('parse path (no carriesForcedToolChoice): strict line, ONE structured re-ask, then none', async () => {
    const asked: LLMRequest[] = [];
    const chatty: LLMProvider = {
      name: 'plain',
      complete: async (req): Promise<LLMResponse> => {
        asked.push(req);
        return {
          content: asked.length === 1 ? 'I think it is billing, probably!' : 'billing',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        };
      },
    };
    const scores = await llmClassifier(chatty).score({ message: 'refund' }, candidates);
    expect(asked).toHaveLength(2); // one re-ask, no more
    expect(asked[1]!.messages.at(-1)?.content).toMatch(/exactly one of/i);
    expect(scores.find((s) => s.id === 'billing')?.score).toBe(1);

    const neverParses: LLMProvider = {
      name: 'plain',
      complete: async () => ({
        content: 'no idea',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      }),
    };
    expect(await llmClassifier(neverParses).score({ message: 'x' }, candidates)).toEqual([
      { id: 'billing', score: 0 },
      { id: 'shipping', score: 0 },
    ]);
  });

  it('window plumbing: recentTurns land in the request messages, newest last', async () => {
    let seen: LLMRequest | undefined;
    const provider = mock({
      respond: (req) => {
        seen = req;
        return {
          content: '',
          toolCalls: [{ id: 't', name: 'pick_intent', args: { intent: 'none' } }],
          stopReason: 'tool_use' as const,
        };
      },
    });
    const scorer = llmClassifier(provider, { window: 2 });
    expect(scorer.window).toBe(2);
    await scorer.score(
      {
        message: 'now this',
        recentTurns: [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: 'reply' },
        ],
      },
      candidates,
    );
    expect(seen?.messages.map((m) => m.content)).toEqual(['earlier', 'reply', 'now this']);
  });
});

describe('security: validateIntentScores — the framework refuses misbehavior', () => {
  it('a missing candidate and a foreign id are both named in the teaching error', () => {
    expect(() =>
      validateIntentScores('custom', candidates, [
        { id: 'billing', score: 1 },
        { id: 'made-up', score: 9 },
      ]),
    ).toThrow(/omitted "shipping" and named "made-up"/);
  });

  it('a complete result is returned in CANDIDATE order, whatever order the scorer used', () => {
    const out = validateIntentScores('custom', candidates, [
      { id: 'shipping', score: 2 },
      { id: 'billing', score: 1 },
    ]);
    expect(out.map((s) => s.id)).toEqual(['billing', 'shipping']);
  });
});
