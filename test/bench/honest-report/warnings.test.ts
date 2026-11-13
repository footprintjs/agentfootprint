/**
 * Whether a surface warned, through the warning table of the commit that read it
 * (RULE.md § 7; `score/warnings.mjs`).
 *
 * Test types:
 *   - UNIT — every row of the `05cbef67` table on hand-built facts; only CRITICAL calls count; a
 *            standing word alone is doubt, never a warning; a fact the table does not name is
 *            listed as unmapped and counts as no warning; an account that threw warns nothing.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { WARNING_TABLES } from '../../../bench/honest-report/rule-tables.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { warningsOf } from '../../../bench/honest-report/score/warnings.mjs';

const TABLE = WARNING_TABLES['05cbef67'];
const facts = (s3: any, o: any = {}) => ({
  S1: o.S1 ?? { addition: 'none' },
  S2: o.S2 ?? { present: false },
  S3: s3,
});
const call = (outcome: string, emptiness = 'unknown', toolCallId = 'c2') => ({
  toolCallId,
  toolName: 't',
  outcome,
  emptiness,
});
const s3 = (calls: any[], standing = 'consistent') => ({ calls, omitted: 0, standing });

describe('UNIT — S3 on 05cbef67', () => {
  it.each(['failed', 'refused', 'declined', 'not-dispatched', 'unknown'])(
    'outcome %s on a critical call warns',
    (outcome) => {
      expect(warningsOf(facts(s3([call(outcome)])), ['c2'], TABLE).S3.warned).toBe(true);
    },
  );

  it('outcome ran does not warn (a declared failure reads as ran on this commit)', () => {
    expect(warningsOf(facts(s3([call('ran')])), ['c2'], TABLE).S3.warned).toBe(false);
  });

  it.each(['declared-absent', 'undeclared-empty', 'clarify'])(
    'emptiness %s on a critical call warns',
    (emptiness) => {
      expect(warningsOf(facts(s3([call('ran', emptiness)])), ['c2'], TABLE).S3.warned).toBe(true);
    },
  );

  it.each(['non-empty', 'unknown'])('emptiness %s does not warn', (emptiness) => {
    expect(warningsOf(facts(s3([call('ran', emptiness)])), ['c2'], TABLE).S3.warned).toBe(false);
  });

  it('a failed call that is NOT critical does not warn', () => {
    expect(warningsOf(facts(s3([call('failed', 'unknown', 'c1')])), ['c2'], TABLE).S3.warned).toBe(
      false,
    );
  });

  it('no call at all warns; omitted calls are not "no call"', () => {
    expect(warningsOf(facts(s3([])), [], TABLE).S3.warned).toBe(true);
    expect(
      warningsOf(facts({ calls: [], omitted: 3, standing: 'consistent' }), [], TABLE).S3.warned,
    ).toBe(false);
  });

  it('a not-sure standing with no critical-call fact is doubt, not a warning', () => {
    const w = warningsOf(facts(s3([call('ran')], 'not-sure')), ['c2'], TABLE).S3;
    expect(w).toEqual({ warned: false, doubt: true });
    expect(warningsOf(facts(s3([call('ran')], 'not-assessed')), ['c2'], TABLE).S3.doubt).toBe(
      false,
    );
  });

  it('an account that threw warns nothing and says why', () => {
    expect(warningsOf(facts({ error: 'boom' }), ['c2'], TABLE).S3).toEqual({
      warned: false,
      doubt: false,
      error: 'boom',
    });
  });

  it('an outcome the table does not name counts as no warning and is listed', () => {
    const w = warningsOf(facts(s3([call('exploded')])), ['c2'], TABLE);
    expect(w.S3.warned).toBe(false);
    expect(w.unmapped).toEqual(['S3:outcome:exploded']);
  });
});

describe('UNIT — S1 and S2 on 05cbef67: nothing there names a call', () => {
  it('no addition, the standing line, another addition', () => {
    expect(warningsOf(facts(s3([])), [], TABLE).S1).toEqual({ warned: false, doubt: false });
    expect(
      warningsOf(
        facts(s3([]), { S1: { addition: 'standing-line', standing: 'not-sure' } }),
        [],
        TABLE,
      ).S1,
    ).toEqual({ warned: false, doubt: true });
    expect(
      warningsOf(
        facts(s3([]), { S1: { addition: 'standing-line', standing: 'consistent' } }),
        [],
        TABLE,
      ).S1,
    ).toEqual({ warned: false, doubt: false });
    expect(warningsOf(facts(s3([]), { S1: { addition: 'other' } }), [], TABLE).S1).toEqual({
      warned: false,
      doubt: false,
      listed: true,
    });
  });

  it('the assessment handed to the app: absent, present with doubt, present without', () => {
    expect(warningsOf(facts(s3([])), [], TABLE).S2).toEqual({ warned: false, doubt: false });
    expect(
      warningsOf(
        facts(s3([]), { S2: { present: true, standing: 'ask', reasons: ['asked'] } }),
        [],
        TABLE,
      ).S2,
    ).toEqual({ warned: false, doubt: true });
    expect(
      warningsOf(
        facts(s3([]), { S2: { present: true, standing: 'consistent', reasons: [] } }),
        [],
        TABLE,
      ).S2,
    ).toEqual({ warned: false, doubt: false });
  });
});
