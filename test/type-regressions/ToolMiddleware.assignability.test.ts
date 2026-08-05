/**
 * Compile-level regression test — 7.18 made the middleware seam PUBLIC.
 *
 * Four things have to stay true at the TYPE level, and the first two are not
 * observable at runtime at all, so they are pinned by the real compiler here
 * (this file lives under ./tsconfig.json, run via `npm run test:types`, while
 * its name still matches `test/**\/*.test.ts` so `npm test` runs the runtime
 * assertions too):
 *
 *   1. **The union has no `result` arm.** This is LAW 1, and it is enforced by
 *      absence rather than by review: there is no spelling of "here is what
 *      the tool would have returned". The `@ts-expect-error` below fails the
 *      build the day someone adds one.
 *   2. **`ask` exists only where a pause exists.** `ToolOutcome` has it,
 *      `MessageOutcome` does not, because tool dispatch runs inside a pausable
 *      stage and the message boundary does not.
 *   3. A consumer can write both middleware kinds against the exported types
 *      alone. A barrel omission is silent at runtime; this makes it loud.
 *   4. `allow()` with a value REQUIRES a `why`. A transform that does not say
 *      why is the exact thing the ledger exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import type {
  AllowOutcome,
  AskOutcome,
  DenyOutcome,
  MessageMiddleware,
  MessageMiddlewareContext,
  MessageOutcome,
  MiddlewareDecision,
  ToolCallMiddleware,
  ToolMiddleware,
  ToolMiddlewareContext,
  ToolOutcome,
  ToolResultContext,
  ToolResultMiddleware,
  ToolResultOutcome,
} from '../../src/index';
import { allow, ask, deny, MessageDeniedError } from '../../src/index';

// ─── 1 + 2. The shape of the closed union ─────────────────────────

/** A tool middleware written against nothing but the exported types. */
const governed: ToolCallMiddleware = {
  name: 'governed',
  onToolCall: (call: ToolMiddlewareContext): ToolOutcome => {
    if (call.toolName === 'wire_money') return deny('wire transfers are out of scope');
    if (Number(call.args.amount) > 1000) return ask({ question: 'approve this?' });
    if (typeof call.args.note === 'string') {
      return allow({ ...call.args, note: call.args.note.trim() }, 'trimmed the note');
    }
    return allow();
  },
};

/** A message middleware, same vocabulary minus the arm with no home. */
const scrubbed: MessageMiddleware = {
  name: 'scrubbed',
  onMessage: (msg: MessageMiddlewareContext): MessageOutcome => {
    if (msg.content.includes('sk-live-')) return deny('the message carries a live key');
    const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
    return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
  },
};

// LAW 1 — there is no `result` arm to return.
// @ts-expect-error a middleware cannot answer for the tool: `ToolOutcome` has
// no arm carrying a result, and adding one would break this line.
const _fabricated: ToolOutcome = { kind: 'result', value: 'I already did it' };
void _fabricated;

// LAW: `ask` is tool-only — the message boundary has no pause to carry it.
// @ts-expect-error `MessageOutcome` has no `ask` arm.
const _askedAtMessage: MessageOutcome = ask({ question: 'may I?' });
void _askedAtMessage;

// The three arms are each assignable to the union they belong to.
const _a: ToolOutcome = {} as AllowOutcome<Readonly<Record<string, unknown>>>;
const _d: ToolOutcome = {} as DenyOutcome;
const _k: ToolOutcome = {} as AskOutcome;
const _ma: MessageOutcome = {} as AllowOutcome<string>;
const _md: MessageOutcome = {} as DenyOutcome;
void _a;
void _d;
void _k;
void _ma;
void _md;

// LAW 2's type half — a transform must say why. Inside a never-called function
// because the runtime guard would throw at import time; the point here is that
// it does not COMPILE, which is checked whether or not it ever runs.
function _neverCalled(): void {
  // @ts-expect-error allow(value) without a reason does not type-check.
  const silent = allow({ a: 1 });
  void silent;
}
void _neverCalled;

// ─── 7.24 — the after-tool moment ─────────────────────────────────

/** A rule about the RESULT only. It takes no part in dispatch. */
const resultOnly: ToolResultMiddleware = {
  name: 'result-only',
  onToolResult: (call: ToolResultContext): ToolResultOutcome => {
    if (call.error === true) return allow();
    if (typeof call.result === 'string' && call.result.includes('sk-live-'))
      return deny('the tool answered with a live key; the model does not read it');
    return allow({ wrapped: call.result }, 'wrapped the result');
  },
};
void resultOnly;

/** Both hooks on one object — the ordinary "wrap a call" shape. */
const wraps: ToolMiddleware = {
  name: 'wraps',
  onToolCall: () => allow(),
  onToolResult: () => allow(),
};
void wraps;

// LAW — there is no `ask` at the after-tool moment: the tool has already run, so
// there is nothing left for a person to prevent.
// @ts-expect-error `ToolResultOutcome` has no `ask` arm.
const _askedAfter: ToolResultOutcome = ask({ question: 'was that ok?' });
void _askedAfter;

// LAW — a middleware with a name and no hook is a rule that can never run.
// @ts-expect-error neither `onToolCall` nor `onToolResult`.
const _hookless: ToolMiddleware = { name: 'hookless' };
void _hookless;

// The two arms are each assignable to the union.
const _before: ToolMiddleware = {} as ToolCallMiddleware;
const _after: ToolMiddleware = {} as ToolResultMiddleware;
void _before;
void _after;

// The after context is the before context plus what came back.
function _readsBoth(call: ToolResultContext): void {
  const _name: string = call.toolName;
  const _args: Readonly<Record<string, unknown>> = call.args;
  const _result: unknown = call.result;
  const _source: string | undefined = call.toolSource;
  void _name;
  void _args;
  void _result;
  void _source;
}
void _readsBoth;

// A ledger row is plain data — it must survive structuredClone into a record.
const _row: MiddlewareDecision = {
  middleware: 'scrubbed',
  moment: 'input',
  at: 'message',
  phase: 'input',
  iteration: 0,
  outcome: 'allow',
  changed: true,
  why: 'masked a US SSN',
  before: 'ssn 123-45-6789',
  after: 'ssn [ssn]',
};
void _row;

// ─── Runtime half — the same objects still behave ─────────────────

describe('middleware seam — type regression', () => {
  it('a middleware written against the exported types alone runs', async () => {
    const denied = await governed.onToolCall({
      toolName: 'wire_money',
      toolCallId: 'c1',
      iteration: 1,
      args: {},
      history: [],
    });
    expect(denied).toEqual({ kind: 'deny', reason: 'wire transfers are out of scope' });

    const asked = await governed.onToolCall({
      toolName: 'refund',
      toolCallId: 'c2',
      iteration: 1,
      args: { amount: 5000 },
      history: [],
    });
    expect(asked.kind).toBe('ask');
  });

  it('a result-only middleware written against the exported types alone runs', async () => {
    const withheld = await resultOnly.onToolResult({
      toolName: 'read_vault',
      toolCallId: 'c1',
      iteration: 1,
      args: {},
      result: 'token sk-live-42',
      history: [],
    });
    expect(withheld.kind).toBe('deny');

    const wrapped = await resultOnly.onToolResult({
      toolName: 'read_vault',
      toolCallId: 'c2',
      iteration: 1,
      args: {},
      result: 'fine',
      history: [],
    });
    expect(wrapped).toEqual({
      kind: 'allow',
      value: { wrapped: 'fine' },
      why: 'wrapped the result',
    });
  });

  it('a message middleware narrows on phase and never returns an ask', async () => {
    const out = await scrubbed.onMessage({
      phase: 'input',
      content: 'ssn 123-45-6789',
      history: [],
    });
    expect(out).toEqual({ kind: 'allow', value: 'ssn [ssn]', why: 'masked a US SSN' });
  });

  it('MessageDeniedError carries the facts and not the content', () => {
    const err = new MessageDeniedError({
      reason: 'the message carries a live key',
      phase: 'input',
      middleware: 'scrubbed',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('ERR_MESSAGE_DENIED');
    expect(err.phase).toBe('input');
    expect(err.middleware).toBe('scrubbed');
  });
});
