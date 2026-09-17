/**
 * Unit tests — `mockClassifier` and the port's public shape.
 *
 * Pattern: Test-as-specification. The mock is what the suite and the bench
 * run without a key, so what it does with a script is pinned: answers in
 * order, records every request, refuses past the end, and hands a
 * function-script's throw through untouched.
 */

import { describe, expect, it, expectTypeOf } from 'vitest';
import * as door from '../../src/doors/classify.js';
import {
  ClassifierError,
  mockClassifier,
  type ClassifyAnswer,
  type ClassifyRequest,
  type ClassifyResult,
} from '../../src/classify/index.js';

const answer = (choice: string, latencyMs = 1): ClassifyResult => ({
  model: 'mock-1',
  answers: {
    standing: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } },
  },
  latencyMs,
});

const req = (id: string): ClassifyRequest => ({
  state: { id },
  questions: { standing: { type: 'choice', instructions: 'pick', criteria: { a: 'A', b: 'B' } } },
});

describe('mockClassifier — an array script', () => {
  it('answers in order, records every request, and refuses past the end', async () => {
    const judge = mockClassifier([answer('a'), answer('b')]);
    expect(judge.name).toBe('mock');
    expect(await judge.classify(req('1'))).toEqual(answer('a'));
    expect(await judge.classify(req('2'))).toEqual(answer('b'));
    expect(judge.calls.map((c) => (c.state as { id: string }).id)).toEqual(['1', '2']);
    await expect(judge.classify(req('3'))).rejects.toBeInstanceOf(ClassifierError);
    // The refused call is still on the record of what was asked.
    expect(judge.calls).toHaveLength(3);
  });
});

describe('mockClassifier — a function script', () => {
  it('computes from the request and the index, and a throw passes through', async () => {
    const judge = mockClassifier((request, index) => {
      if (index === 1) throw new ClassifierError('scripted outage', { status: 529 });
      return answer(String((request.state as { id: string }).id));
    });
    const first = await judge.classify(req('x'));
    expect((first.answers.standing as ClassifyAnswer & { choice: string }).choice).toBe('x');
    await expect(judge.classify(req('y'))).rejects.toMatchObject({ status: 529 });
  });

  it('an already-aborted signal is refused before the script runs', async () => {
    let ran = 0;
    const judge = mockClassifier(() => {
      ran += 1;
      return answer('a');
    });
    const c = new AbortController();
    c.abort(new Error('gone'));
    await expect(judge.classify(req('1'), c.signal)).rejects.toThrow('gone');
    expect(ran).toBe(0);
    expect(judge.calls).toHaveLength(0);
  });
});

describe('the port and the door', () => {
  it('`agentfootprint/classify` carries the port, the error and both adapters', () => {
    expect(typeof door.typesafe).toBe('function');
    expect(typeof door.mockClassifier).toBe('function');
    expect(door.ClassifierError).toBe(ClassifierError);
    expectTypeOf<door.Classifier['classify']>().parameters.toEqualTypeOf<
      [ClassifyRequest, AbortSignal?]
    >();
  });

  it('ClassifierError carries status and retryable, defaults retryable to false', () => {
    const plain = new ClassifierError('x');
    expect(plain.name).toBe('ClassifierError');
    expect(plain.status).toBeUndefined();
    expect(plain.retryable).toBe(false);
    expect(new ClassifierError('y', { status: 429, retryable: true })).toMatchObject({
      status: 429,
      retryable: true,
    });
  });
});
