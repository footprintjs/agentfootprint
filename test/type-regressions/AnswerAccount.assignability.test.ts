/**
 * Compile-level regression test — the answer account's public surface.
 *
 * What the real compiler (`npm run test:types`) pins:
 *
 *   1. **The signature law** — `accountForAnswer(recording, declarations?,
 *      options?)`: a `Recording`, the app's declarations, `{ runId }`. Nothing
 *      that could reach a model, a clock or a network rides the call.
 *   2. **One exported name carries the family** — a sentence, a pointer, a row
 *      are reached by indexed access on `AnswerAccount` (the site's export
 *      budget), and they compile.
 *   3. **`AnswerAccountShownLeaf` is a closed union** — a value, a derived row
 *      count, or a named withholding; nothing else.
 *
 * The `.test.ts` name lets `npm test` run the runtime assertions too.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  accountForAnswer,
  type AnswerAccount,
  type AnswerAccountDeclarations,
  type AnswerAccountShownLeaf,
} from '../../src/observe';
import type { Recording } from '../../src/recorders/observability/recordRun';

type Sentence = AnswerAccount['rows'][number]['lines'][number];
type Pointer = Sentence['pointers'][number];
type Part = Sentence['parts'][number];

describe('answer account — the types', () => {
  it('the signature law', () => {
    expectTypeOf(accountForAnswer).parameters.toEqualTypeOf<
      [Recording, AnswerAccountDeclarations?, { readonly runId?: string }?]
    >();
    expectTypeOf(accountForAnswer).returns.toEqualTypeOf<AnswerAccount>();
    expect(typeof accountForAnswer).toBe('function');
  });

  it('the family is reachable by indexed access', () => {
    const p: Pointer = {
      kind: 'event',
      index: 5,
      type: 'agentfootprint.agent.turn_start',
      path: '/userPrompt',
    };
    const part: Part = { label: 'array estate report', source: 'app' };
    // @ts-expect-error — a part is typed text, never HTML
    const html: Part = { html: '<b>x</b>' };
    expect([p.kind, 'label' in part, html]).toBeDefined();
  });

  it('a shown leaf is a value, a derived count, or a named withholding', () => {
    const leaves: AnswerAccountShownLeaf[] = [
      { value: 'x' },
      { rows: 0, at: '/content/volumes' },
      { withheld: 'not-shown-here' },
    ];
    // @ts-expect-error — no other withholding reason exists
    const other: AnswerAccountShownLeaf = { withheld: 'secret' };
    expect([leaves.length, other]).toBeDefined();
  });
});
