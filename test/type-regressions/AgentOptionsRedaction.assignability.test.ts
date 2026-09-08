/**
 * Compile-level regression — 9.88.0. `AgentOptions` has no redaction door, and
 * an option nobody declared must not compile.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * The 9.88.0 conformance suite shipped with a case titled "a redacted run"
 * that passed `redact: [/sk-[a-z0-9]+/g]` to `Agent.create`. There is no such
 * option. `tsconfig.json` excludes `test/`, so the unknown key was never
 * typechecked and TypeScript's excess-property check never ran; the option was
 * silently dropped, the run was NOT redacted, and the assertion described a run
 * that does not exist. Two READMEs then documented the behaviour it pretended
 * to prove, and a reader was told a recording was safe to pass on.
 *
 * Typechecking the WHOLE of `test/` would close that hole, and it was tried:
 * 1,054 pre-existing errors across the suite and the examples it pulls in —
 * a repair of its own, not a line item in this one. So the hole is closed where
 * it actually bit, in the one place that already compiles: this directory runs
 * under `npm run test:types`, and its files also run under `npm test` for their
 * runtime half.
 *
 * What is pinned:
 *   1. `redact` is not an `AgentOptions` key — so a future `redact:` in a test
 *      is a compile error here rather than a silent no-op there.
 *   2. Excess properties on an `AgentOptions` literal are rejected at all —
 *      the check that never ran.
 *   3. `recordReceipt` IS a key, and is optional, so the off switch cannot be
 *      quietly renamed out from under `Agent.create`.
 *
 * Where redaction really lives is asserted at RUNTIME in
 * `test/lib/time-travel/receipt-conformance.test.ts` — `flowchartAsTool({
 * redact })` scrubs an inner run's commit log, and an agent's own log is not
 * scrubbed at all.
 */
import { describe, expect, it } from 'vitest';
import type { AgentOptions } from '../../src/index';

// ─── 1. There is no redaction door on AgentOptions ────────────────

/** `true` only when `K` is NOT a key of `AgentOptions`. */
type NotAnOption<K extends string> = K extends keyof AgentOptions ? never : true;

const _noRedact: NotAnOption<'redact'> = true;
const _noRedaction: NotAnOption<'redaction'> = true;
const _noRedactionPolicy: NotAnOption<'redactionPolicy'> = true;
void _noRedact;
void _noRedaction;
void _noRedactionPolicy;

// ─── 2. An unknown key on the literal is refused ──────────────────

/** The two options every agent must supply, so the literals below fail for the
 *  excess property and for nothing else. */
const REQUIRED = { provider: null as never, model: 'mock' };

/** The excess-property check, exercised so it cannot be assumed. */
// @ts-expect-error `redact` is not an AgentOptions key — this is the line the
// conformance suite got away with, because `test/` was never typechecked.
const _rejected: AgentOptions = { ...REQUIRED, redact: [/sk-[a-z0-9]+/g] };
void _rejected;

// ─── 3. The receipt's off switch is a real, optional key ──────────

/** `true` only when `K` may be omitted — an agent that says nothing about the
 *  receipt still compiles. */
type IsOptional<K extends keyof AgentOptions> = Omit<AgentOptions, K> extends Omit<
  AgentOptions,
  never
>
  ? true
  : never;

const _receiptSwitchExists: IsOptional<'recordReceipt'> = true;
void _receiptSwitchExists;

const _offSwitch: AgentOptions = { ...REQUIRED, recordReceipt: false };
const _onByDefault: AgentOptions = { ...REQUIRED };
void _offSwitch;
void _onByDefault;

describe('AgentOptions has no redaction door', () => {
  it('is pinned by the compiler, not by anyone remembering', () => {
    // The claims above are compile-time. This runtime half exists so the file
    // also fails loudly under `npm test` if it stops compiling at all.
    expect(_noRedact).toBe(true);
    expect(_receiptSwitchExists).toBe(true);
  });
});
