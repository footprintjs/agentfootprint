/**
 * An answer must be about the thing that was asked.
 *
 * A typed ask can pin the data the answer is chosen FROM — `propsRef`, the
 * picker's options living in the artifact store rather than in the checkpoint.
 * A `DecisionValue` can say which artifact the choice was made AGAINST. When
 * both are present and disagree, the answer is about different bytes than the
 * question, and the ordinary cause is time: a refresh landed, a filter moved,
 * rows re-sorted, and "the third row" now names something else.
 *
 * Accepting it resumes the run with a value the person never chose, and nothing
 * downstream can notice — the id is well-formed, the type checks, the loop
 * continues. So it refuses, and both directions are tested: a matching pair must
 * pass, or the guard is just an outage.
 */
import { describe, expect, it } from 'vitest';

import { assertDecisionIsNotStale } from '../../../src/core/pause.js';
import { StaleDecisionError, checkInApproved } from '../../../src/index.js';

const ASKED = 'art_0000000000000000000001';
const MOVED = 'art_0000000000000000000002';

/** A pause payload shaped as `readAskComponent` reads one. */
const askedAgainst = (propsRef?: string) => ({
  kind: 'check-in',
  ...(propsRef !== undefined && { component: { componentId: 'row-picker', propsRef } }),
});

const chosenFrom = (from?: string) =>
  checkInApproved({
    by: 'alice@ops',
    value: { kind: 'row-choice', value: { rowId: 'r1' }, ...(from !== undefined && { from }) },
  } as never);

describe('a decision chosen against different bytes than the ask', () => {
  it('refuses when the artifact moved between asking and answering', () => {
    expect(() => assertDecisionIsNotStale(askedAgainst(ASKED), chosenFrom(MOVED))).toThrow(
      StaleDecisionError,
    );
  });

  it('names BOTH artifacts, so the reader can tell which way it drifted', () => {
    try {
      assertDecisionIsNotStale(askedAgainst(ASKED), chosenFrom(MOVED));
      expect.unreachable('a stale decision was accepted');
    } catch (err) {
      expect(err).toBeInstanceOf(StaleDecisionError);
      expect((err as StaleDecisionError).asked).toBe(ASKED);
      expect((err as StaleDecisionError).answered).toBe(MOVED);
      expect((err as StaleDecisionError).code).toBe('ERR_STALE_DECISION');
    }
  });

  it('ACCEPTS the matching pair — without this the guard is just an outage', () => {
    expect(() => assertDecisionIsNotStale(askedAgainst(ASKED), chosenFrom(ASKED))).not.toThrow();
  });

  it('says nothing when the answer names no artifact', () => {
    // Nobody claimed the two were about one artifact; inventing that claim here
    // would refuse answers that are perfectly good.
    expect(() =>
      assertDecisionIsNotStale(askedAgainst(ASKED), chosenFrom(undefined)),
    ).not.toThrow();
  });

  it('says nothing when the ask pinned no artifact', () => {
    expect(() =>
      assertDecisionIsNotStale(askedAgainst(undefined), chosenFrom(MOVED)),
    ).not.toThrow();
  });

  it('says nothing for a plain approve/decline, which is what it always was', () => {
    expect(() =>
      assertDecisionIsNotStale(askedAgainst(ASKED), checkInApproved({ by: 'a' })),
    ).not.toThrow();
    expect(() =>
      assertDecisionIsNotStale(askedAgainst(ASKED), 'a plain askHuman answer'),
    ).not.toThrow();
    expect(() => assertDecisionIsNotStale(undefined, undefined)).not.toThrow();
  });
});
