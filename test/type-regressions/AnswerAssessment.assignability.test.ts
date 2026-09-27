/**
 * Compile-level regression test — the answer's standing, the public surface.
 *
 * What the real compiler (`npm run test:types`) pins:
 *
 *   1. **The record goes in whole** — a `Recording` (`recordRun`), a snapshot,
 *      or a paused run's checkpoint is accepted as it comes; the answer
 *      account's declarations object is accepted as it is (the fold reads only
 *      `tools[name].rowsAt`).
 *   2. **One exported name carries the family** — a reason, a witness, a check
 *      that ran are reached by indexed access on `AnswerAssessment`.
 *   3. **Closed vocabularies** — the value, the owner's word and the reasons are
 *      closed unions; the owner's word has no "verified".
 *
 * The `.test.ts` name lets `npm test` run the runtime assertions too.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Agent } from '../../src/index';
import {
  assessAnswer,
  type AnswerAccountDeclarations,
  type AnswerAssessment,
  type Recording,
} from '../../src/observe';

type Reason = AnswerAssessment['reasons'][number]['reason'];
type Witness = AnswerAssessment['reasons'][number]['witness'][number];
type Check = AnswerAssessment['checked'][number]['check'];

describe('answer standing — the types', () => {
  it('a recording, a snapshot or a checkpoint goes in; the account’s declarations too', () => {
    const recording = { snapshot: {}, events: [], structure: null } as unknown as Recording;
    const declarations: AnswerAccountDeclarations = { tools: { t: { rowsAt: 'rows' } } };
    const a: AnswerAssessment = assessAnswer(recording, declarations);
    assessAnswer({ checkpoint: {} });
    assessAnswer({});
    expectTypeOf<ReturnType<Agent['assessment']>>().toEqualTypeOf<
      Promise<AnswerAssessment | undefined>
    >();
    expect(a.standing).toBe('not-assessed');
  });

  it('the family is reachable by indexed access, and every vocabulary is closed', () => {
    const r: Reason = 'empty-undeclared';
    // @ts-expect-error — a reason no row can witness is not in the union
    const invented: Reason = 'model-unsure';
    const w: Witness = { kind: 'state', key: 'coverageDeclared', path: '/0/kind' };
    const c: Check = 'tool-coverage';
    expectTypeOf<AnswerAssessment['assessment']>().toEqualTypeOf<
      'known' | 'unrefuted' | 'unknown' | 'not-applicable'
    >();
    expectTypeOf<AnswerAssessment['standing']>().toEqualTypeOf<
      'known' | 'consistent' | 'not-sure' | 'ask' | 'not-assessed'
    >();
    // @ts-expect-error — the library never says "verified"
    const verified: AnswerAssessment['standing'] = 'verified';
    expect([r, invented, w.kind, c, verified]).toBeDefined();
  });
});
