/**
 * Compile-level regression test — 7.21.0 re-widened `slot: 'messages'` and
 * made `role` its inseparable partner.
 *
 * ── What the compiler has to enforce, and why ────────────────────────
 * The runtime throws (see `messagesSlotRefusal.test.ts`) catch JavaScript
 * callers and casts. This file pins the half only the compiler can, and it is
 * the half consumers actually meet — at the keystroke, before anything runs:
 *
 *   • `slot: 'messages'` WITHOUT a role does not compile. There is no default
 *     because who appears to speak is a meaning the app owns; before 7.19.1
 *     the default was `'system'`, which reached the model on OpenAI-family
 *     providers and silently vanished on Anthropic-family ones.
 *   • `role: 'tool'` does not compile. A tool message answers a specific call
 *     and an injection has no call to answer, so no provider capability could
 *     ever make it valid.
 *   • `role` WITHOUT `slot: 'messages'` does not compile. There is no role in
 *     a system prompt to choose, and accepting the field there would imply
 *     one exists.
 *
 * Lives under ./tsconfig.json (`npm run test:types`) while its name still
 * matches `test/**\/*.test.ts`, so `npm test` runs the assertions too.
 */
import { describe, expect, it } from 'vitest';
import { defineFact, defineInstruction } from '../../src/injection-engine';
import type { DefineFactOptions, DefineInstructionOptions } from '../../src/injection-engine';

describe('slot and role are one decision (7.21.0)', () => {
  // The `@ts-expect-error` is the assertion each of these makes: it fails to
  // compile if the shape ever type-checks again. The `toThrow` keeps them
  // honest under `npm test`, where this file also runs as a normal suite.
  it('defineFact rejects the messages slot without a role', () => {
    expect(() =>
      // @ts-expect-error — `slot: 'messages'` requires a `role`; no default.
      defineFact({
        id: 'turn-time',
        data: 'noon',
        slot: 'messages',
      }),
    ).toThrow(/requires a `role`/);
  });

  it('defineInstruction rejects the messages slot without a role', () => {
    expect(() =>
      // @ts-expect-error — `slot: 'messages'` requires a `role`; no default.
      defineInstruction({
        id: 'be-brief',
        prompt: 'Be brief.',
        slot: 'messages',
      }),
    ).toThrow(/requires a `role`/);
  });

  it("rejects role: 'tool' — no wire can carry it", () => {
    expect(() =>
      defineFact({
        id: 'turn-time',
        data: 'noon',
        slot: 'messages',
        // @ts-expect-error — a tool message answers a call; an injection has none.
        role: 'tool',
      }),
    ).toThrow(/`role: 'tool'` cannot be injected/);
  });

  it('rejects a role on the system-prompt slot', () => {
    expect(() =>
      defineInstruction({
        id: 'be-brief',
        prompt: 'Be brief.',
        slot: 'system-prompt',
        // @ts-expect-error — there is no role in a system prompt to choose.
        role: 'user',
      }),
    ).not.toThrow();
  });

  it('accepts the three shapes that are real', () => {
    // Default — unchanged since forever.
    const a: DefineFactOptions = { id: 'a', data: 'x' };
    // Explicit system prompt.
    const b: DefineInstructionOptions = { id: 'b', prompt: 'x', slot: 'system-prompt' };
    // Delivered, with the role stated.
    const c: DefineFactOptions = { id: 'c', data: 'x', slot: 'messages', role: 'assistant' };
    const d: DefineInstructionOptions = {
      id: 'd',
      prompt: 'x',
      slot: 'messages',
      role: 'system',
    };
    expect([a, b, c, d].map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(defineFact(c).inject.messages).toEqual([{ role: 'assistant', content: 'x' }]);
    expect(defineInstruction(d).inject.messages).toEqual([{ role: 'system', content: 'x' }]);
  });
});
