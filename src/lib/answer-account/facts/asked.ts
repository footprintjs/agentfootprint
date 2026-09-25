/**
 * Row "You asked" — the question as the record holds it.
 *
 * `turn_start.userPrompt` is the text AFTER the input middleware chain
 * (`stages/seed.ts` · `buildSeedStage` seeds `verdict.content`). It is the
 * person's own words only when no input decision changed it; otherwise it is the
 * app's version (voucher `app`) and the raw words are said to be missing — never
 * reconstructed. A resumed leg has no `turn_start` (seed does not re-run); the
 * run's `userMessage` is then quoted, vouched by the library.
 */

import { v } from '../render.js';
import type { AccountFact, Sentence } from '../types.js';
import { str } from '../view.js';
import { at, stateAt, type ReadContext } from './common.js';

export interface AskedRead {
  readonly question: AccountFact<string>;
  readonly lines: readonly Sentence[];
}

export function readAsked(ctx: ReadContext): AskedRead {
  const start = ctx.view.first('agent.turn_start');
  const prompt = str(start?.payload.userPrompt);
  if (start !== undefined && prompt !== undefined) {
    const rewrites = ctx.view
      .ofType('middleware.decision')
      .filter(
        (e) =>
          (e.payload.moment === 'input' || e.payload.phase === 'input') &&
          e.payload.changed === true,
      );
    const from = at(start, 'userPrompt');
    if (rewrites.length === 0) {
      return {
        question: { value: prompt, source: 'person', status: 'recorded', pointers: [from] },
        lines: [ctx.say('asked', { vars: { question: v(prompt, 'person', from) } })],
      };
    }
    const deciders = rewrites.flatMap((e) => [at(e, 'middleware'), at(e, 'changed')]);
    return {
      question: { value: prompt, source: 'app', status: 'recorded', pointers: [from, ...deciders] },
      lines: [
        ctx.say('asked.rewritten', {
          vars: { question: v(prompt, 'app', from) },
          pointers: deciders,
        }),
        ctx.say('asked.raw.notRecorded', {
          status: 'not-recorded',
          missing: 'no-event',
          pointers: [],
        }),
      ],
    };
  }
  const held = str(ctx.view.state?.userMessage);
  if (ctx.resumedLeg && held !== undefined && held.length > 0) {
    const from = stateAt('userMessage');
    return {
      question: { value: held, source: 'library', status: 'recorded', pointers: [from] },
      lines: [ctx.say('asked.resumed', { vars: { question: v(held, 'library', from) } })],
    };
  }
  return {
    question: {
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing: 'no-event',
    },
    lines: [ctx.say('asked.none', { status: 'not-recorded', missing: 'no-event' })],
  };
}
