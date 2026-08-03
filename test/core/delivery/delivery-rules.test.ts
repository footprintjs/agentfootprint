/**
 * delivery/rules — where a delivered injection may go, and whether it is
 * already there.
 *
 * The counterpart to `window-turns.test.ts`: that file pins what may LEAVE
 * the window, this one pins what may ENTER it. Pure functions, no scope, no
 * provider — so the rule can be argued with directly instead of through a run.
 *
 * The rule most worth pinning is the conservative one: `tool` folds to `user`
 * for sequencing. It is stricter than OpenAI needs and exactly what Anthropic
 * needs, and the reason it is uniform is that a per-provider answer would make
 * the same declaration deliver on one wire and defer on another with nothing
 * in the recording to tell them apart.
 *
 * Test types (Convention 3): unit / property-ish (identity + stability of the
 * key) / regression (the pair law).
 */

import { describe, it, expect } from 'vitest';
import type { LLMMessage } from '../../../src/adapters/types.js';
import {
  deliveryKey,
  effectiveWireRole,
  keysInWindow,
  refusalForPlacement,
  tailWireRole,
} from '../../../src/core/agent/delivery/rules.js';

describe('effectiveWireRole — tool folds to user', () => {
  it('maps every role to the role it occupies on the strictest wire', () => {
    expect(effectiveWireRole('user')).toBe('user');
    expect(effectiveWireRole('assistant')).toBe('assistant');
    expect(effectiveWireRole('system')).toBe('system');
    // Anthropic coalesces tool_results into a user turn. OpenAI would accept a
    // user message after a tool message; we refuse it anyway, uniformly.
    expect(effectiveWireRole('tool')).toBe('user');
  });
});

describe('deliveryKey — identity of one deliverable message', () => {
  it('is stable for the same injection and content', () => {
    expect(deliveryKey('a', 'user', 'hello')).toBe(deliveryKey('a', 'user', 'hello'));
  });

  it('changes when the injection, the role, or the content changes', () => {
    const base = deliveryKey('a', 'user', 'hello');
    expect(deliveryKey('b', 'user', 'hello')).not.toBe(base);
    expect(deliveryKey('a', 'assistant', 'hello')).not.toBe(base);
    expect(deliveryKey('a', 'user', 'hello!')).not.toBe(base);
  });

  it('is recoverable from a message already in the window', () => {
    // This is what makes replay safe: a restored history yields the same keys
    // a fresh ledger would have held.
    const history: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'a note',
        injectedBy: { injectionId: 'note', flavor: 'fact', iteration: 1 },
      },
    ];
    expect(keysInWindow(history).has(deliveryKey('note', 'assistant', 'a note'))).toBe(true);
    // A plain conversation message contributes no key — it was nobody's delivery.
    expect(keysInWindow(history).size).toBe(1);
  });
});

describe('refusalForPlacement — may this land at the end of the window?', () => {
  const user: LLMMessage = { role: 'user', content: 'hi' };
  const assistant: LLMMessage = { role: 'assistant', content: 'hello' };

  it('accepts anything into an empty window', () => {
    expect(refusalForPlacement([], 'user')).toBeUndefined();
    expect(refusalForPlacement([], 'assistant')).toBeUndefined();
    expect(refusalForPlacement([], 'system')).toBeUndefined();
  });

  it('refuses a role that repeats the turn already at the end', () => {
    expect(refusalForPlacement([user], 'user')).toBe('role-collision');
    expect(refusalForPlacement([user, assistant], 'assistant')).toBe('role-collision');
  });

  it('accepts a role that alternates with it', () => {
    expect(refusalForPlacement([user], 'assistant')).toBeUndefined();
    expect(refusalForPlacement([user, assistant], 'user')).toBeUndefined();
  });

  it("treats 'system' as colliding only with another system turn", () => {
    expect(refusalForPlacement([user], 'system')).toBeUndefined();
    expect(refusalForPlacement([{ role: 'system', content: 'x' }], 'system')).toBe(
      'role-collision',
    );
  });

  it('refuses a user role after tool results — the conservative fold, in effect', () => {
    const afterTools: LLMMessage[] = [
      user,
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', args: {} }] },
      { role: 'tool', content: 'result', toolCallId: 'c1' },
    ];
    expect(refusalForPlacement(afterTools, 'user')).toBe('role-collision');
    // …while assistant still has a seat, which is the placement that works
    // inside a tool-using loop.
    expect(refusalForPlacement(afterTools, 'assistant')).toBeUndefined();
  });

  it('never splits a tool_use / tool_result pair', () => {
    // The call is out and unanswered — a paused tool, or mid-dispatch. Nothing
    // may sit between the request and its result.
    const unanswered: LLMMessage[] = [
      user,
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', args: {} }] },
    ];
    expect(refusalForPlacement(unanswered, 'assistant')).toBe('unanswered-tool-call');
    expect(refusalForPlacement(unanswered, 'user')).toBe('unanswered-tool-call');
    expect(refusalForPlacement(unanswered, 'system')).toBe('unanswered-tool-call');
  });

  it('reports the tail role the deferral note quotes', () => {
    expect(tailWireRole([])).toBeUndefined();
    expect(tailWireRole([user])).toBe('user');
    expect(tailWireRole([{ role: 'tool', content: 'r', toolCallId: 'c' }])).toBe('user');
  });
});
