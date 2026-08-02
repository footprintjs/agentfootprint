/**
 * Compile-level regression test — `workflow()`'s whole promise is that a
 * broken hand-off is a COMPILE error, so the proof has to be a compile
 * error, not an assertion about one.
 *
 * Every `@ts-expect-error` below IS an assertion: if the chain rule ever
 * loosens, TypeScript reports the directive as unused and `npm run
 * test:types` fails. The positive assignments assert the other direction —
 * the chains consumers actually write must keep compiling, including the
 * house `string → { message }` convention every LLM runner speaks.
 *
 * The runners are `declare`d (types with no runtime value), so all of it
 * lives inside functions that are never CALLED. Type-checking is the test;
 * vitest only confirms the file loaded.
 *
 * Lives under its own tsconfig (`npm run test:types`) so the REAL compiler
 * checks it; its `.test.ts` name also lets vitest exercise the (trivial)
 * runtime assertions alongside the rest of the suite.
 */
import { describe, expect, it } from 'vitest';
import { workflow, type Workflow } from '../../src/core-flow/Workflow.js';
import type { Runner } from '../../src/core/runner.js';
import type { RunnerPauseOutcome } from '../../src/core/pause.js';

// ─── The cast of runners ──────────────────────────────────────────────

interface Ticket {
  readonly orderId: string;
  readonly angry: boolean;
}
interface Refund {
  readonly refundUsd: number;
}

/** The shape every LLM runner here has: `{ message }` in, `string` out. */
declare const talk: Runner<{ message: string }, string>;
declare const alsoTalk: Runner<{ message: string }, string>;

declare const parse: Runner<{ message: string }, Ticket>;
declare const price: Runner<Ticket, Refund>;
declare const reply: Runner<Refund, string>;

declare const s1: Runner<{ message: string }, { a: 1 }>;
declare const s2: Runner<{ a: 1 }, { b: 2 }>;
declare const s3: Runner<{ b: 2 }, { c: 3 }>;
declare const s4: Runner<{ c: 3 }, { d: 4 }>;
declare const s5: Runner<{ d: 4 }, { e: 5 }>;
declare const s6: Runner<{ e: 5 }, { f: 6 }>;
declare const s7: Runner<{ f: 6 }, { g: 7 }>;
declare const s8: Runner<{ g: 7 }, string>;

// ─── Positive: the chains people write must compile ───────────────────

function chainsThatMustCompile(): void {
  // Two LLM runners: `string` output feeds the next step's `{ message }`.
  const talking: Workflow<{ message: string }, string> = workflow(talk, alsoTalk);

  // A structured pipeline: each object output is the next step's input.
  const intake: Workflow<{ message: string }, string> = workflow(parse, price, reply);

  // Mixed: structured in the middle, text at both ends.
  const mixed: Workflow<{ message: string }, string> = workflow(talk, parse, price, reply);

  // A one-step workflow keeps its step's exact output type.
  const parsed: Workflow<{ message: string }, Ticket> = workflow(parse);

  // The chain's OUTPUT type is the last step's output — no `unknown` leak.
  const ticketRun: Promise<Ticket | RunnerPauseOutcome> = workflow(parse).run({
    message: 'where is my order',
  });

  // Eight steps is the documented ceiling and must still infer end-to-end.
  const eight: Workflow<{ message: string }, string> = workflow(s1, s2, s3, s4, s5, s6, s7, s8);

  void talking;
  void intake;
  void mixed;
  void parsed;
  void ticketRun;
  void eight;
}

// ─── Negative: a broken chain must NOT compile ────────────────────────

function chainsThatMustNotCompile(): void {
  // @ts-expect-error — step 1 hands over a Ticket; step 2 wants { message }.
  const objectIntoText = workflow(parse, alsoTalk);

  // @ts-expect-error — step 1 hands over text; step 2 wants a Ticket.
  const textIntoObject = workflow(talk, price);

  // @ts-expect-error — Refund is not a Ticket: the middle of the chain is wrong.
  const wrongObject = workflow(parse, reply);

  // @ts-expect-error — fine up to step 3, still caught at step 4.
  const breaksLate = workflow(talk, parse, price, alsoTalk);

  // @ts-expect-error — a workflow needs at least one step.
  const empty = workflow();

  void objectIntoText;
  void textIntoObject;
  void wrongObject;
  void breaksLate;
  void empty;
}

describe('workflow — the typed chain (compile-level)', () => {
  it('accepts the chains consumers write', () => {
    // The assignments inside are the assertions; `npm run test:types`
    // fails if any of them stops compiling.
    expect(typeof chainsThatMustCompile).toBe('function');
  });

  it('rejects a chain whose hand-off types do not line up', () => {
    // Each `@ts-expect-error` fails `npm run test:types` if the mismatch
    // ever starts compiling — an unused directive is an error.
    expect(typeof chainsThatMustNotCompile).toBe('function');
  });
});
