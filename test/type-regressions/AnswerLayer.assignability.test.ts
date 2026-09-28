/**
 * The answer layer's public contract, pinned by the compiler (the root
 * tsconfig excludes `test/`, so these assertions live here, under
 * `npm run test:types`).
 *
 *   1. `.answerLayer()` takes nothing, or `{ standingLine?: boolean }` — no
 *      other option exists;
 *   2. the standing as data carries the value, the words, the reason kinds and
 *      the checks — NO field that could hold a value or a quote;
 *   3. a typed answer's limits (`AnswerCoverage`) are still a `Coverage`, so
 *      every reader written against 9.121.0 keeps compiling; `assumed` is
 *      optional;
 *   4. the two witness rows are members of `FindingsRow`, told apart by `kind`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  Agent,
  type AnswerCoverage,
  type Coverage,
  type FindingsRow,
  type GroundedRow,
  type StepsUnfinishedRow,
} from '../../src/index.js';
import type { AgentTurnEndPayload, AnswerAssessedPayload } from '../../src/events/payloads.js';
import { mock } from '../../src/llm-providers.js';

describe('the answer layer — public contract', () => {
  it('the builder door: nothing, or the line’s own arm', () => {
    const b = () => Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' });
    b().answerLayer();
    b().answerLayer({ standingLine: true });
    b().answerLayer({ standingLine: false });
    // The two below are refused at run time too — the compiler catches them first.
    // @ts-expect-error — the one option is `standingLine`.
    expect(() => b().answerLayer({ line: true })).toThrow(/unknown option/);
    // @ts-expect-error — a boolean, not a string.
    expect(() => b().answerLayer({ standingLine: 'yes' })).toThrow(/must be a boolean/);
  });

  it('the standing as data: names, enums and counts — nothing that could carry a value', () => {
    type Data = NonNullable<AgentTurnEndPayload['answerAssessment']>;
    expectTypeOf<keyof Data>().toEqualTypeOf<'assessment' | 'standing' | 'reasons' | 'checked'>();
    expectTypeOf<keyof AnswerAssessedPayload>().toEqualTypeOf<
      'assessment' | 'standing' | 'reasons' | 'checked' | 'turn' | 'iteration'
    >();
    expectTypeOf<Data['standing']>().toEqualTypeOf<
      'known' | 'consistent' | 'not-sure' | 'ask' | 'not-assessed'
    >();
    expectTypeOf<keyof Data['checked'][number]>().toEqualTypeOf<'layer' | 'check' | 'ran' | 'of'>();
  });

  it('a typed answer’s limits are still a Coverage; `assumed` is optional', () => {
    expectTypeOf<AnswerCoverage>().toMatchTypeOf<Coverage>();
    const limits: AnswerCoverage = { checked: [], notChecked: [], cannotCover: [] };
    const asCoverage: Coverage = limits;
    expect(asCoverage.checked).toEqual([]);
    expectTypeOf<ReturnType<Agent['answerCoverage']>>().toEqualTypeOf<AnswerCoverage | undefined>();
  });

  it('the witness rows are ledger rows, told apart by kind', () => {
    expectTypeOf<GroundedRow>().toMatchTypeOf<FindingsRow>();
    expectTypeOf<StepsUnfinishedRow>().toMatchTypeOf<FindingsRow>();
    expectTypeOf<GroundedRow['kind']>().toEqualTypeOf<'grounded'>();
    expectTypeOf<StepsUnfinishedRow['action']>().toEqualTypeOf<'accepted' | 'cut-short'>();
    expectTypeOf<StepsUnfinishedRow['turn']>().toEqualTypeOf<number>();
  });
});
