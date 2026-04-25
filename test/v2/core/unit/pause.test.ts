/**
 * Unit tests — pause/resume helpers + type guards.
 *
 * Scope: pauseHere/isPauseRequest/isPaused in isolation. Runner-level pause
 * round-trips live in scenario/.
 */

import { describe, it, expect } from 'vitest';
import {
  isPauseRequest,
  isPaused,
  pauseHere,
  PauseRequest,
} from '../../../src/core/pause.js';

describe('pauseHere()', () => {
  it('throws a PauseRequest carrying the provided data', () => {
    try {
      pauseHere({ question: 'Approve?', risk: 'high' });
      expect.fail('pauseHere should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PauseRequest);
      expect((err as PauseRequest).data).toEqual({
        question: 'Approve?',
        risk: 'high',
      });
    }
  });

  it('accepts any serializable shape as data', () => {
    expect(() => pauseHere('simple-string')).toThrow(PauseRequest);
    expect(() => pauseHere(42)).toThrow(PauseRequest);
    expect(() => pauseHere({ nested: { a: 1 } })).toThrow(PauseRequest);
    expect(() => pauseHere(null)).toThrow(PauseRequest);
  });

  it('never returns — TypeScript "never" type', () => {
    // Compile-time check: TS would error if pauseHere returned.
    // Runtime check: it always throws.
    const shouldThrow = () => pauseHere('x');
    expect(shouldThrow).toThrow();
  });
});

describe('isPauseRequest()', () => {
  it('returns true for PauseRequest instances', () => {
    expect(isPauseRequest(new PauseRequest({}))).toBe(true);
  });

  it('returns false for generic Errors', () => {
    expect(isPauseRequest(new Error('boom'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isPauseRequest('string')).toBe(false);
    expect(isPauseRequest(42)).toBe(false);
    expect(isPauseRequest(null)).toBe(false);
    expect(isPauseRequest(undefined)).toBe(false);
    expect(isPauseRequest({})).toBe(false);
  });

  it('returns true for cross-realm PauseRequest-like objects (brand fallback)', () => {
    // Simulate an instance from a different realm where `instanceof` fails
    // but the error's name + data props match our brand.
    const fake = new Error('PauseRequest');
    fake.name = 'PauseRequest';
    (fake as unknown as { data: unknown }).data = { foo: 'bar' };
    expect(isPauseRequest(fake)).toBe(true);
  });
});

describe('isPaused()', () => {
  it('returns true for a RunnerPauseOutcome', () => {
    const outcome = {
      paused: true as const,
      checkpoint: {} as never,
      pauseData: { reason: 'test' },
    };
    expect(isPaused(outcome)).toBe(true);
  });

  it('returns false for a plain string result', () => {
    expect(isPaused('final answer')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isPaused(null as unknown as string)).toBe(false);
    expect(isPaused(undefined as unknown as string)).toBe(false);
  });

  it('returns false for objects without paused:true flag', () => {
    expect(isPaused({ paused: false } as unknown as string)).toBe(false);
    expect(isPaused({ other: 'field' } as unknown as string)).toBe(false);
  });
});

describe('PauseRequest', () => {
  it('has name="PauseRequest"', () => {
    const err = new PauseRequest({ x: 1 });
    expect(err.name).toBe('PauseRequest');
  });

  it('is an instance of Error (for catch blocks)', () => {
    const err = new PauseRequest({});
    expect(err).toBeInstanceOf(Error);
  });

  it('clears the stack trace (control flow, not a real error)', () => {
    const err = new PauseRequest({});
    expect(err.stack).toBe('');
  });
});
