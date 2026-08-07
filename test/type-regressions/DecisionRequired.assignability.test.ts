/**
 * Compile-level regression test — 8.13.0's consent-gate refusal.
 *
 * Three things have to stay true at the TYPE level (this file lives under
 * ./tsconfig.json, run via `npm run test:types`, while its name still matches
 * `test/**\/*.test.ts` so `npm test` runs the runtime assertions too):
 *
 *   1. **`DecisionRequiredError.received` is a `string`, and there is no field
 *      carrying the VALUE.** A resume payload is caller data — a note a person
 *      typed, a token pasted into the wrong box — and an error message is
 *      copied into logs and crash reporters by default. The refusal names the
 *      SHAPE and nothing else, enforced by ABSENCE: the `@ts-expect-error`
 *      below fails the build the day someone adds `input` "for debugging".
 *   2. **`code` is the literal `'ERR_DECISION_REQUIRED'`**, so an `err.code ===`
 *      comparison narrows and a typo does not compile. Same discipline as every
 *      other refusal in the library.
 *   3. **`ConsentGateKind` is a CLOSED two-arm union.** A third consent gate has
 *      to be added deliberately, in the one place that reads the pause shape —
 *      not discovered because a `switch` fell through.
 */
import { describe, expect, it } from 'vitest';
import {
  DecisionRequiredError,
  pauseDemandsDecision,
  type ConsentGate,
  type ConsentGateKind,
} from '../../src/index.js';

describe('DecisionRequiredError — type regressions', () => {
  it('carries the SHAPE of what arrived, never the value', () => {
    const err = new DecisionRequiredError({ kind: 'checkIn', toolName: 'refund' }, 'hunter2');

    const received: string = err.received;
    expect(received).toBe('a string');
    // @ts-expect-error — there is no field carrying the caller's payload, and
    // adding one would put it into every log line this error touches.
    expect(err.input).toBeUndefined();
    expect(err.message).not.toContain('hunter2');
  });

  it('`code` is a literal, so a comparison narrows', () => {
    const err = new DecisionRequiredError({ kind: 'ask', middleware: 'gate' }, undefined);
    const code: 'ERR_DECISION_REQUIRED' = err.code;
    expect(code).toBe('ERR_DECISION_REQUIRED');
    // @ts-expect-error — a typo in the code is a compile error, not a silent miss.
    const typo: 'ERR_DECISION_REQUIRE' = err.code;
    expect(typo).toBeDefined();
  });

  it('`ConsentGateKind` is closed at two arms', () => {
    const kinds: ConsentGateKind[] = ['checkIn', 'ask'];
    // @ts-expect-error — a third gate is a deliberate edit to `pause.ts`, not an
    // arm a caller can invent.
    const invented: ConsentGateKind = 'credential';
    expect(kinds).toHaveLength(2);
    expect(invented).toBe('credential');
  });

  it('`pauseDemandsDecision` returns the gate or nothing — never a boolean', () => {
    const gate: ConsentGate | undefined = pauseDemandsDecision({
      toolName: 'refund',
      checkIn: { tool: 'refund' },
    });
    expect(gate?.kind).toBe('checkIn');
    expect(pauseDemandsDecision({ question: 'anything?' })).toBeUndefined();
  });
});
