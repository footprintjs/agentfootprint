/**
 * milestoneStops — the ONE assumption it makes about footprintjs.
 *
 * `milestoneStops` composes `commitStops` rather than re-deriving the
 * per-stage axis, which is the right trade — and it buys that reuse with a
 * shape assumption the `Stop[]` return type does not pin: for a non-empty log
 * the result is `[start, …stages, end]`. Every index in this file's arithmetic
 * rests on it: `'start'` is the only stop allowed to open at `-1`, and `'end'`
 * is the only one that folds the whole log.
 *
 * So the assumption is CHECKED, not assumed, and this file is the check on the
 * check. `commitStops` is mocked to return shapes a future footprintjs could
 * plausibly return, and the claim is that each one is REFUSED loudly rather
 * than silently producing an axis that looks right and reads wrong.
 *
 * Test types (Convention 3): regression (the shape guard) / unit (the guard in
 * isolation, with the substrate mocked).
 */

import { describe, expect, it, vi } from 'vitest';
import type { CommitBundle } from 'footprintjs/advanced';
import type { Stop } from 'footprintjs/trace';

/** The stop shapes the mocked `commitStops` will hand back, one test at a time. */
const scripted: { stops: Stop[] } = { stops: [] };

vi.mock('footprintjs/trace', async () => {
  const actual = await vi.importActual<typeof import('footprintjs/trace')>('footprintjs/trace');
  return { ...actual, commitStops: () => scripted.stops };
});

const { milestoneStops } = await import('../../../src/lib/time-travel/milestoneStops.js');

const stop = (over: Partial<Stop>): Stop => ({
  step: 0,
  runtimeStageId: 'call-llm#1',
  commitIdx: 0,
  lastCommitIdx: 0,
  stageId: 'call-llm',
  label: 'call-llm',
  kind: 'commit',
  ...over,
});

const log = [{ runtimeStageId: 'call-llm#1' }, { runtimeStageId: 'seed#0' }] as CommitBundle[];

describe('the [start, …stages, end] assumption is checked, not assumed', () => {
  it('refuses a result whose FIRST stop is not the start bookend', () => {
    scripted.stops = [stop({ kind: 'commit' }), stop({ step: 1, kind: 'end' })];
    // Without the kind check this would silently take a real STAGE stop for
    // the bookend: it would keep its raw stage label and inherit the -1
    // arithmetic, and no caller could tell.
    expect(() => milestoneStops(log)).toThrow(/unexpected shape/);
  });

  it('refuses a result whose LAST stop is not the end bookend', () => {
    scripted.stops = [stop({ kind: 'start' }), stop({ step: 1, kind: 'commit' })];
    // Here the last MILESTONE would be eaten as a bookend and lose its
    // milestone label — the axis would be short by one stop, quietly.
    expect(() => milestoneStops(log)).toThrow(/unexpected shape/);
  });

  it('names what it got, so the message is actionable rather than mysterious', () => {
    scripted.stops = [stop({ kind: 'mount' }), stop({ step: 1, kind: 'end' })];
    expect(() => milestoneStops(log)).toThrow(/\[mount, end\]/);
  });

  it('an EMPTY result is still the empty axis, not a throw — an empty log is a fact, not a breakage', () => {
    scripted.stops = [];
    expect(milestoneStops(log)).toEqual([]);
  });

  it('accepts the real shape', () => {
    scripted.stops = [
      stop({
        kind: 'start',
        runtimeStageId: '',
        commitIdx: -1,
        lastCommitIdx: -1,
        label: 'Run start',
      }),
      stop({ step: 1, kind: 'commit', commitIdx: 0, lastCommitIdx: 0 }),
      stop({
        step: 2,
        kind: 'end',
        runtimeStageId: '',
        commitIdx: 1,
        lastCommitIdx: 1,
        label: 'Run end',
      }),
    ];
    const out = milestoneStops(log);
    expect(out.map((s) => s.kind)).toEqual(['start', 'commit', 'end']);
    expect(out[1]!.label).toBe('LLM turn'); // relabelled by the classifier
  });
});
