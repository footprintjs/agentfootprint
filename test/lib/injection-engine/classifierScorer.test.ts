/**
 * classifierScorer — the scored choice on the entry seam (9.104.0).
 *
 * Pattern: Test-as-specification (Convention 3):
 *   - unit:        the ONE choice question — criteria = { id: description }, state = the message
 *   - integration: `.entryBy(classifierScorer(judge))` through the REAL Agent loop: cursor + snapshot
 *   - property:    ranking = the provider's distribution, key for key; chosen = the provider's pick
 *   - edge:        no candidates; a pick outside the candidates; a candidate the provider did not score
 *   - regression:  a failure → `classifier:unavailable`, empty ranking, no chosen — and the agent's
 *                  cold-start fallback still routes
 *   - security:    a throwing classifier never throws out of the scorer
 *   - documentation: `scorer` names the provider's model string
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import {
  classifierScorer,
  CLASSIFIER_SCORER_QUESTION,
  CLASSIFIER_SCORER_UNAVAILABLE,
} from '../../../src/lib/injection-engine/classifierScorer.js';
import * as door from '../../../src/doors/skill-graph.js';
import {
  ClassifierError,
  mockClassifier,
  type ClassifyResult,
} from '../../../src/classify/index.js';
import { mock } from '../../../src/llm-providers.js';

const billing = defineSkill({
  id: 'billing',
  description: 'refunds and charges for payments',
  body: 'B',
});
const incident = defineSkill({
  id: 'incident',
  description: 'outages errors and crashes',
  body: 'I',
});

const candidates = [
  { id: 'billing', description: 'refunds and charges for payments' },
  { id: 'incident', description: 'outages errors and crashes' },
];

const pick = (
  choice: string,
  probabilities: Record<string, number>,
  model = 'jev-1.13.0',
): ClassifyResult => ({
  model,
  answers: {
    [CLASSIFIER_SCORER_QUESTION]: { type: 'choice', choice, confidence: 0.7, probabilities },
  },
  latencyMs: 2,
});

describe('classifierScorer — the question', () => {
  it('asks one choice question over the candidates, criteria = { id: description }, state = the message', async () => {
    const judge = mockClassifier([pick('billing', { billing: 0.8, incident: 0.2 })]);
    await classifierScorer(judge).score({ userMessage: 'refund please', candidates });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]).toEqual({
      state: { message: 'refund please' },
      questions: {
        entry: {
          type: 'choice',
          instructions: expect.stringContaining('Pick the ONE skill'),
          criteria: {
            billing: 'refunds and charges for payments',
            incident: 'outages errors and crashes',
          },
        },
      },
    });
  });

  it('honours custom instructions and forwards the signal', async () => {
    let seenSignal: AbortSignal | undefined;
    const judge = mockClassifier((_req) => pick('billing', { billing: 1 }));
    const wrapped = {
      name: judge.name,
      classify: (req: Parameters<typeof judge.classify>[0], signal?: AbortSignal) => {
        seenSignal = signal;
        return judge.classify(req, signal);
      },
    };
    const c = new AbortController();
    await classifierScorer(wrapped, { instructions: 'choose' }).score(
      { userMessage: 'm', candidates },
      c.signal,
    );
    expect(seenSignal).toBe(c.signal);
    const q = judge.calls[0]!.questions.entry!;
    expect(q.instructions).toBe('choose');
  });
});

describe('classifierScorer — the scoring', () => {
  it('ranking = the distribution as sent (score and relevance the same number); chosen = the pick; scorer names the model', async () => {
    const judge = mockClassifier([pick('billing', { billing: 0.75, incident: 0.25 })]);
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates });
    expect(out).toEqual({
      scorer: 'classifier:jev-1.13.0',
      chosen: 'billing',
      ranked: [
        { id: 'billing', score: 0.75, relevance: 0.75 },
        { id: 'incident', score: 0.25, relevance: 0.25 },
      ],
    });
  });

  it("never renormalises and never takes its own argmax — the provider's pick stands even against its numbers", async () => {
    // A distribution that does not sum to 1, and a pick that is not the argmax: both recorded as answered.
    const judge = mockClassifier([pick('incident', { billing: 0.6, incident: 0.6 })]);
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates });
    expect(out.chosen).toBe('incident');
    expect(out.ranked.map((r) => r.relevance)).toEqual([0.6, 0.6]);
  });

  it('a candidate the provider did not score is ABSENT from the ranking (never a padded 0); a pick outside the candidates is no chosen', async () => {
    const judge = mockClassifier([pick('refunds', { billing: 1 })]);
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates });
    expect(out.chosen).toBeUndefined();
    // The ranking is the provider's distribution: `incident` was offered and
    // not scored, so it has no row — a 0 here would be a number the library
    // inferred, which the scored-choice law forbids.
    expect(out.ranked).toEqual([{ id: 'billing', score: 1, relevance: 1 }]);
    expect(out.ranked.map((r) => r.id)).not.toContain('incident');
    expect(out.scorer).toBe('classifier:jev-1.13.0');
  });

  it('no candidates → no call, no chosen, empty ranking', async () => {
    const judge = mockClassifier([pick('billing', { billing: 1 })]);
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates: [] });
    expect(out).toEqual({ scorer: 'classifier', chosen: undefined, ranked: [] });
    expect(judge.calls).toHaveLength(0);
  });
});

describe('classifierScorer — unavailable is not a guess', () => {
  it('a throwing classifier → classifier:unavailable, empty ranking, no chosen, and no throw', async () => {
    const judge = mockClassifier(() => {
      throw new ClassifierError('typesafe: HTTP 529', { status: 529, retryable: true });
    });
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates });
    expect(out).toEqual({ scorer: CLASSIFIER_SCORER_UNAVAILABLE, chosen: undefined, ranked: [] });
  });

  it('an answer that is not a choice under the question id is unavailable too', async () => {
    const judge = mockClassifier([
      { model: 'x', answers: { other: { type: 'noul', noul: 1 } }, latencyMs: 1 },
    ]);
    const out = await classifierScorer(judge).score({ userMessage: 'm', candidates });
    expect(out.scorer).toBe(CLASSIFIER_SCORER_UNAVAILABLE);
    expect(out.chosen).toBeUndefined();
  });
});

describe('classifierScorer — through the REAL Agent loop', () => {
  const snapshotOf = (agent: Agent) =>
    agent.getLastSnapshot()?.sharedState as {
      currentSkillId?: string;
      entryScores?: Array<{ id: string; score: number; relevance: number }>;
      entryScorer?: string;
    };

  it(".entryBy(classifierScorer(judge)) starts the cursor at the provider's pick and records the distribution", async () => {
    const judge = mockClassifier([pick('incident', { billing: 0.1, incident: 0.9 })]);
    const graph = skillGraph()
      .entry(billing)
      .entry(incident)
      .entryBy(classifierScorer(judge))
      .build();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .build();
    await agent.run({ message: 'i need a refund for my payment' }); // the words say billing; the judge says incident
    const state = snapshotOf(agent);
    expect(state.entryScorer).toBe('classifier:jev-1.13.0');
    expect(state.entryScores).toEqual([
      { id: 'billing', score: 0.1, relevance: 0.1 },
      { id: 'incident', score: 0.9, relevance: 0.9 },
    ]);
    expect(judge.calls[0]!.state).toEqual({ message: 'i need a refund for my payment' });
    expect(state.currentSkillId).toBe('incident');
  });

  it('unavailable → the cursor falls back to the cold-start entry pick; the record says which scorer was asked', async () => {
    const judge = mockClassifier(() => {
      throw new ClassifierError('down');
    });
    const graph = skillGraph()
      .entry(billing)
      .entry(incident)
      .entryBy(classifierScorer(judge))
      .build();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .build();
    await expect(agent.run({ message: 'refund' })).resolves.toBe('done');
    const state = snapshotOf(agent);
    expect(state.entryScorer).toBe(CLASSIFIER_SCORER_UNAVAILABLE);
    expect(state.entryScores).toEqual([]);
  });
});

describe('classifierScorer — the doors', () => {
  it('is exported beside keywordScorer on agentfootprint/skill-graph, with the Classifier type', () => {
    expect(door.classifierScorer).toBe(classifierScorer);
    expect(typeof door.keywordScorer).toBe('function');
    expect(door.CLASSIFIER_SCORER_QUESTION).toBe('entry');
  });
});
