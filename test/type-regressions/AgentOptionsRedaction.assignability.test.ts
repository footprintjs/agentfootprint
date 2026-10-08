/**
 * Compile-level regression — the agent's redaction door is ONE key, `redact`,
 * and it takes a footprintjs `RedactionPolicy`.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * The 9.88.0 conformance suite shipped with a case titled "a redacted run"
 * that passed `redact: [/sk-[a-z0-9]+/g]` to `Agent.create`. There was no such
 * option then. `tsconfig.json` excludes `test/`, so the unknown key was never
 * typechecked and TypeScript's excess-property check never ran; the option was
 * silently dropped, the run was NOT redacted, and the assertion described a run
 * that did not exist.
 *
 * The door exists now (`AgentOptions.redact`), and the same hole would bite a
 * different way: a misspelt door (`redaction:`, `redactionPolicy:`) or the old
 * array shape would compile into a run that is not redacted. This directory
 * runs under `npm run test:types`, so each of those is a compile error here.
 *
 * What is pinned:
 *   1. `redact` IS an optional `AgentOptions` key, typed footprintjs's
 *      `RedactionPolicy` — and `AgentRunOptions.redact` is the same type.
 *   2. The misspellings are NOT keys, and an excess property is refused.
 *   3. The old array shape is refused by the TYPE — a policy is an object.
 *   4. `recordReceipt` is still a key, and optional.
 *
 * The runtime half — every record served, the live run untouched — is
 * `test/redaction/`.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';
import type { AgentOptions } from '../../src/index';
import type { AgentRunOptions } from '../../src/core/Agent';

// ─── 1. `redact` is the door ──────────────────────────────────────

/** `true` only when `K` is NOT a key of `AgentOptions`. */
type NotAnOption<K extends string> = K extends keyof AgentOptions ? never : true;

/** `true` only when `AgentOptions[K]` is exactly `RedactionPolicy | undefined`. */
type IsPolicy<T> = [T] extends [RedactionPolicy | undefined]
  ? [RedactionPolicy | undefined] extends [T]
    ? true
    : never
  : never;

const _redactIsThePolicy: IsPolicy<AgentOptions['redact']> = true;
const _perRunIsThePolicy: IsPolicy<AgentRunOptions['redact']> = true;
void _redactIsThePolicy;
void _perRunIsThePolicy;

/** The two options every agent must supply, so the literals below fail for one reason only. */
const REQUIRED = { provider: null as never, model: 'mock' };

const _withPolicy: AgentOptions = {
  ...REQUIRED,
  redact: { keys: ['history'], patterns: [/ssn/i] },
};
const _withoutPolicy: AgentOptions = { ...REQUIRED };
void _withPolicy;
void _withoutPolicy;

// ─── 2. The misspellings are not doors ────────────────────────────

const _noRedaction: NotAnOption<'redaction'> = true;
const _noRedactionPolicy: NotAnOption<'redactionPolicy'> = true;
void _noRedaction;
void _noRedactionPolicy;

// @ts-expect-error `redaction` is not an AgentOptions key — a misspelt door would
// otherwise build a run that is not redacted.
const _misspelt: AgentOptions = { ...REQUIRED, redaction: { keys: ['ssn'] } };
void _misspelt;

// ─── 3. The old array shape is refused by the type ────────────────

// @ts-expect-error a RedactionPolicy is an object of selectors, not a list of
// patterns — this is the 9.88.0 line, and it must not compile.
const _array: AgentOptions = { ...REQUIRED, redact: [/sk-[a-z0-9]+/g] };
void _array;

// ─── 4. The receipt's off switch is a real, optional key ──────────

/** `true` only when `K` may be omitted. */
type IsOptional<K extends keyof AgentOptions> = Omit<AgentOptions, K> extends Omit<
  AgentOptions,
  never
>
  ? true
  : never;

const _receiptSwitchExists: IsOptional<'recordReceipt'> = true;
const _redactIsOptional: IsOptional<'redact'> = true;
void _receiptSwitchExists;
void _redactIsOptional;

describe('AgentOptions has exactly one redaction door', () => {
  it('is pinned by the compiler, not by anyone remembering', () => {
    // The claims above are compile-time. This runtime half exists so the file
    // also fails loudly under `npm test` if it stops compiling at all.
    expect(_redactIsThePolicy).toBe(true);
    expect(_noRedaction).toBe(true);
    expect(_receiptSwitchExists).toBe(true);
  });
});
