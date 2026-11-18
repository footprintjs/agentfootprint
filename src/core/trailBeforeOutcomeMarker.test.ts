/**
 * The fallback reader for unmarked tool messages matches the opening words the
 * check-in trail used before `LLMMessage.outcome` existed, and nothing else —
 * so an unmarked message of a history stored by an earlier version reads as
 * it did then.
 */

import { describe, expect, it } from 'vitest';

import { readsRefusedBeforeOutcomeMarker } from './trailBeforeOutcomeMarker.js';

describe('readsRefusedBeforeOutcomeMarker', () => {
  it('matches the four refusal forms of the earlier reader, in any case', () => {
    expect(readsRefusedBeforeOutcomeMarker('[permission denied: needs a supervisor]')).toBe(true);
    expect(readsRefusedBeforeOutcomeMarker('Declined by human: no')).toBe(true);
    expect(readsRefusedBeforeOutcomeMarker("credential error: 'bank'")).toBe(true);
    expect(readsRefusedBeforeOutcomeMarker('authorization required: bank')).toBe(true);
  });

  it('does not match a plain result, an empty one, or a refusal form in mid-text', () => {
    expect(readsRefusedBeforeOutcomeMarker('sunny, 21°C')).toBe(false);
    expect(readsRefusedBeforeOutcomeMarker('')).toBe(false);
    expect(readsRefusedBeforeOutcomeMarker(undefined)).toBe(false);
    expect(readsRefusedBeforeOutcomeMarker('note: declined by human')).toBe(false);
  });

  it('reads the bracketed credential refusal as the earlier reader did: not matched', () => {
    expect(readsRefusedBeforeOutcomeMarker("[authorization required: 'bank']")).toBe(false);
  });
});
