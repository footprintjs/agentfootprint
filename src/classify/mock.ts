/**
 * classify/mock — a scripted `Classifier` for tests and the bench.
 *
 * Pattern: the `mock()` LLM provider's shape — a script, replayed in order,
 *          or a function of the request; every request recorded on `calls`.
 * Role:    the one classifier the suite and `bench/findings-shuffle.mjs`
 *          may run without a key. It produces exactly what its script says
 *          (a scripted distribution is still the SCRIPT's data, never the
 *          library's guess) and throws exactly what the script throws, so a
 *          failure path is testable to the byte.
 */

import {
  ClassifierError,
  type Classifier,
  type ClassifyRequest,
  type ClassifyResult,
} from './types.js';

/** A classifier that answers from a script and records what it was asked. */
export interface MockClassifier extends Classifier {
  /** Every request, in call order — plain references to what the caller passed. */
  readonly calls: readonly ClassifyRequest[];
}

export type MockClassifierScript =
  | readonly ClassifyResult[]
  | ((request: ClassifyRequest, index: number) => ClassifyResult | Promise<ClassifyResult>);

/**
 * `mockClassifier([r1, r2])` answers r1 then r2 and refuses a third call
 * (`ClassifierError`, so the exhaustion is a failure row, never a repeat);
 * `mockClassifier((req, i) => …)` computes each answer, and may throw to
 * script a failure. `name` is `'mock'`; the result's `model` is the
 * script's own.
 */
export function mockClassifier(script: MockClassifierScript): MockClassifier {
  const calls: ClassifyRequest[] = [];
  return {
    name: 'mock',
    calls,
    async classify(request: ClassifyRequest, signal?: AbortSignal): Promise<ClassifyResult> {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const index = calls.length;
      calls.push(request);
      if (typeof script === 'function') return script(request, index);
      const scripted = script[index];
      if (scripted === undefined) {
        throw new ClassifierError(
          `mockClassifier: script exhausted after ${script.length} call(s); call ${
            index + 1
          } has no answer`,
          { retryable: false },
        );
      }
      return scripted;
    },
  };
}
