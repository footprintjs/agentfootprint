/**
 * Unit — the question the classifier is asked, and the pick it answers with
 * (9.105.0, `toolChoice/pick.ts`).
 *
 * Pinned: the question's shape (one `choice` question under
 * `TOOL_CHOICE_QUESTION`, criteria `{ name: description }` in offered order,
 * the state the message plus the skill id when one is set); the ranking IS
 * the provider's distribution — highest first, an unscored name ABSENT, never
 * padded, never renormalised; `chosen` is the provider's own pick and absent
 * when it named nothing offered; a failure of any kind is `ok: false` with the
 * provider's status and the latency spent, never a throw.
 */

import { describe, expect, it } from 'vitest';
import {
  ClassifierError,
  mockClassifier,
  type ClassifyResult,
} from '../../../../src/classify/index.js';
import { pickTools, toolChoiceQuestion } from '../../../../src/core/agent/toolChoice/pick.js';
import { TOOL_CHOICE_QUESTION } from '../../../../src/core/agent/toolChoice/types.js';

const CANDIDATES = [
  { name: 'lookup', description: 'looks an order up' },
  { name: 'charge', description: 'refunds a charge' },
  { name: 'ship', description: 'ships an order' },
];

const answer = (
  choice: string,
  probabilities: Record<string, number>,
  extra: Partial<ClassifyResult> = {},
): ClassifyResult => ({
  model: 'jev-1.13.0',
  answers: { [TOOL_CHOICE_QUESTION]: { type: 'choice', choice, confidence: 0.7, probabilities } },
  usage: { inputTokens: 120, outputTokens: 9 },
  latencyMs: 42,
  ...extra,
});

describe('toolChoiceQuestion', () => {
  it('asks ONE choice question over the candidates by name, criteria = their own descriptions', () => {
    const request = toolChoiceQuestion('refund order 42', undefined, CANDIDATES);
    expect(request.state).toEqual({ message: 'refund order 42' });
    expect(Object.keys(request.questions)).toEqual([TOOL_CHOICE_QUESTION]);
    const q = request.questions[TOOL_CHOICE_QUESTION]!;
    expect(q.type).toBe('choice');
    expect(q.instructions).toMatch(/ONE tool/);
    expect(q.instructions).toMatch(/description/);
    expect(q.type === 'choice' && q.criteria).toEqual({
      lookup: 'looks an order up',
      charge: 'refunds a charge',
      ship: 'ships an order',
    });
  });

  it('carries the active skill id in the state when one is set — and nothing the library wrote', () => {
    const request = toolChoiceQuestion('go', 'billing', CANDIDATES);
    expect(request.state).toEqual({ message: 'go', skill: 'billing' });
  });
});

describe('pickTools', () => {
  it('the ranking is the distribution, highest first; chosen is the provider’s pick', async () => {
    const classifier = mockClassifier([answer('charge', { lookup: 0.2, charge: 0.7, ship: 0.1 })]);
    const pick = await pickTools(classifier, { userMessage: 'refund', candidates: CANDIDATES });
    expect(pick).toEqual({
      ok: true,
      classifier: { name: 'mock', model: 'jev-1.13.0' },
      ranked: [
        { name: 'charge', score: 0.7 },
        { name: 'lookup', score: 0.2 },
        { name: 'ship', score: 0.1 },
      ],
      chosen: 'charge',
      confidence: 0.7,
      usage: { inputTokens: 120, outputTokens: 9 },
      latencyMs: 42,
    });
    // The request the provider saw is the question builder's, verbatim.
    expect(classifier.calls[0]).toEqual(toolChoiceQuestion('refund', undefined, CANDIDATES));
  });

  it('an unscored candidate is ABSENT from the ranking, never 0; ties keep offered order', async () => {
    const classifier = mockClassifier([answer('lookup', { ship: 0.5, lookup: 0.5 })]);
    const pick = await pickTools(classifier, { userMessage: 'x', candidates: CANDIDATES });
    expect(pick.ok && pick.ranked).toEqual([
      { name: 'lookup', score: 0.5 },
      { name: 'ship', score: 0.5 },
    ]);
  });

  it('a distribution that does not sum to 1 is kept as sent', async () => {
    const classifier = mockClassifier([answer('charge', { lookup: 0.9, charge: 0.9, ship: 0.9 })]);
    const pick = await pickTools(classifier, { userMessage: 'x', candidates: CANDIDATES });
    expect(pick.ok && pick.ranked.map((r) => r.score)).toEqual([0.9, 0.9, 0.9]);
  });

  it('a pick outside the offer is nobody’s choice: chosen absent, the ranking kept', async () => {
    const classifier = mockClassifier([answer('teleport', { lookup: 0.6, charge: 0.4 })]);
    const pick = await pickTools(classifier, { userMessage: 'x', candidates: CANDIDATES });
    expect(pick.ok).toBe(true);
    expect(pick.ok && 'chosen' in pick).toBe(false);
    expect(pick.ok && pick.ranked.length).toBe(2);
  });

  it('a provider failure is ok: false with the status and the latency spent — never a throw', async () => {
    const classifier = mockClassifier(() => {
      throw new ClassifierError('rate limited', { status: 429, retryable: true });
    });
    const pick = await pickTools(classifier, { userMessage: 'x', candidates: CANDIDATES });
    expect(pick).toMatchObject({
      ok: false,
      classifier: { name: 'mock' },
      status: 429,
      message: 'rate limited',
    });
    expect(pick.ok === false && pick.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('a reply with no choice answer under the question id is a failure, not a guess', async () => {
    const classifier = mockClassifier([
      { model: 'm', answers: { other: { type: 'noul', noul: 0.5 } }, latencyMs: 1 },
    ]);
    const pick = await pickTools(classifier, { userMessage: 'x', candidates: CANDIDATES });
    expect(pick.ok).toBe(false);
    expect(pick.ok === false && pick.message).toMatch(/no 'choice' answer under 'tool'/);
    expect(pick.ok === false && 'status' in pick).toBe(false);
  });

  it('an aborted signal is a failure row with the caller’s reason', async () => {
    const classifier = mockClassifier([answer('lookup', { lookup: 1 })]);
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const pick = await pickTools(
      classifier,
      { userMessage: 'x', candidates: CANDIDATES },
      controller.signal,
    );
    expect(pick.ok === false && pick.message).toBe('stop');
    expect(classifier.calls).toHaveLength(0);
  });
});
