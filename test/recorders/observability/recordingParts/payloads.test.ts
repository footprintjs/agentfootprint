/**
 * S1 · A SUB-FLOW INVOCATION'S ENTRY AND EXIT PAYLOADS LIVE WITH THE INVOCATION.
 *
 * The cut moves `payload` off a `subflow.entry` / `subflow.exit` boundary
 * event only on proof, keeps it as `'same'` (equal JSON text to the result's
 * own value: nothing stored) or `'stored'` (beside the result), marks the base
 * row, and every reader gets it back: `readInvocation` beside the result,
 * `readWhole` in place, byte for byte in the row.
 *
 * Oracles: the parsed whole recording (its row's JSON text, its payloads), the
 * review's measured table of which payloads are `'same'` (P2-1), and counts
 * that add up to the payloads the row held.
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import { toWireJson } from '../../../../src/lib/wireJson.js';
import {
  openSavedRecording,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import { splitRecording } from '../../../../src/recorders/observability/recordingParts/split.js';
import {
  boundaryEvents,
  engineRecording,
  payloadEvents,
  resumedRecording,
  sharedRecorderRecording,
  type EngineRunOptions,
  type ShapeName,
} from './engineRuns.js';
import { SCOPE, fileParts } from './helpers.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function opened(recording: Recording, targetBytes?: number): Promise<SavedRecording> {
  const store = inMemoryArtifacts();
  const filed = await fileParts(store, recording, targetBytes ? { targetBytes } : {});
  const saved = await openSavedRecording(bindArtifacts(store, SCOPE), filed.index);
  if (saved.status !== 'ready') throw new Error(saved.reason);
  return saved;
}

/** `kind:id → place` for every payload the index says moved. */
function places(draft: { invocations: readonly Json[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const invocation of draft.invocations) {
    for (const kind of ['entry', 'exit'] as const) {
      const at = invocation.payloads?.[kind];
      if (at !== undefined) out[`${kind}:${invocation.key as string}`] = at as string;
    }
  }
  return out;
}

const row = (recording: Recording): Json =>
  (recording.snapshot as { recorders: Json[] }).recorders.find((r) => r.name === 'BoundaryEvents')!;

interface Case {
  readonly name: string;
  readonly make: () => Promise<Recording>;
  /** `kind:id → place` the review measured (P2-1), and what stays in the base row. */
  readonly expected: Record<string, 'same' | 'stored'>;
  readonly kept?: Partial<{ ambiguous: number; notLast: number; noPart: number }>;
}

const shape =
  (name: ShapeName, options: EngineRunOptions = {}) =>
  (): Promise<Recording> =>
    engineRecording(name, options);

const CASES: readonly Case[] = [
  {
    name: 'plain',
    make: shape('plain'),
    expected: { 'entry:sf-a#1': 'same', 'exit:sf-a#1': 'same' },
  },
  {
    name: 'embeddings kept',
    make: shape('plain', { keepEmbeddings: true }),
    expected: { 'entry:sf-a#1': 'same', 'exit:sf-a#1': 'same' },
  },
  {
    name: 'a policy that selects a seeded key (two placeholder spellings)',
    make: shape('plain', { policy: { keys: ['apiKey'] } }),
    expected: { 'entry:sf-a#1': 'stored', 'exit:sf-a#1': 'same' },
  },
  {
    name: 'a nested name rule',
    make: shape('plain', { policy: { keys: ['password'] } }),
    expected: { 'entry:sf-a#1': 'stored', 'exit:sf-a#1': 'stored' },
  },
  {
    name: 'an empty seed (no inputMapper)',
    make: shape('emptySeed'),
    expected: { 'entry:sf-a#1': 'stored', 'exit:sf-a#1': 'same' },
  },
  {
    name: 'a nested invocation',
    make: shape('nested'),
    expected: {
      'entry:sf-outer#1': 'same',
      'exit:sf-outer#1': 'same',
      'entry:sf-outer/sf-inner#3': 'same',
      'exit:sf-outer/sf-inner#3': 'same',
    },
  },
  {
    name: 'a loop that re-mounts one sub-flow (path aliases)',
    make: shape('loop'),
    expected: {
      'entry:sf-a#1': 'same',
      'exit:sf-a#1': 'same',
      'entry:sf-a#5': 'same',
      'exit:sf-a#5': 'same',
      'entry:sf-a#9': 'same',
      'exit:sf-a#9': 'same',
    },
  },
  {
    name: 'two parallel mounts',
    make: shape('parallel'),
    expected: {
      'entry:sf-p1#1': 'same',
      'exit:sf-p1#1': 'same',
      'entry:sf-p2#3': 'same',
      'exit:sf-p2#3': 'same',
    },
  },
  {
    name: 'a parallelForEach fan-out',
    make: shape('forEach'),
    expected: {
      'entry:each~0#2': 'same',
      'exit:each~0#2': 'same',
      'entry:each~1#4': 'same',
      'exit:each~1#4': 'same',
    },
  },
  {
    name: 'a paused mount (no part: part null)',
    make: shape('paused'),
    expected: {},
    kept: { noPart: 1 },
  },
  {
    // Decided by text like every other: the resumed seed (the pause's capture)
    // is the same JSON text as the mapper's payload here, so it is `same`; a
    // resumed seed that differs is stored.
    name: 'a resumed mount (same executor)',
    make: resumedRecording,
    expected: { 'entry:sf-pause#3': 'same', 'exit:sf-pause#3': 'same' },
    kept: { noPart: 1 },
  },
  {
    name: 'a recorder shared by a second executor',
    make: sharedRecorderRecording,
    expected: { 'entry:sf-host#3': 'same', 'exit:sf-host#3': 'same' },
    kept: { ambiguous: 4 },
  },
];

describe('S1 · which payloads move, and how they are kept', () => {
  it.each(CASES)('$name', async ({ make, expected, kept }) => {
    const recording = await make();
    const split = await splitRecording(recording, { runId: 'r' });
    const counts = split.draft.subflowPayloads!;
    expect(places(split.draft as never)).toEqual(expected);
    expect(counts.kept).toEqual({ ambiguous: 0, notLast: 0, noPart: 0, ...kept });
    // Every payload the row held is counted exactly once.
    const moved = Object.keys(expected).length;
    const keptCount = counts.kept.ambiguous + counts.kept.notLast + counts.kept.noPart;
    expect(counts.same + counts.stored).toBe(moved);
    expect(moved + keptCount).toBe(payloadEvents(recording).length);
    // The base row holds no moved payload, and says so iff one moved.
    const base = JSON.parse(split.base.text) as { recording: Recording };
    expect(row(base.recording).meta).toEqual(
      moved > 0 ? { mode: 'full', subflowPayloads: 'with-invocation' } : { mode: 'full' },
    );
    const marked = boundaryEvents(base.recording).filter((e) => 'payloadWith' in e);
    expect(
      marked.map((e) => `${String(e.type).slice(8)}:${String(e.runtimeStageId)}`).sort(),
    ).toEqual(Object.keys(expected).sort());
    for (const event of marked) {
      expect('payload' in event).toBe(false);
      expect(Object.keys(event).at(-1)).toBe('payloadWith');
      expect(event.payloadWith).toBe('invocation');
    }
    // `same` stores nothing; `stored` is in a part, beside the result.
    const restored = Object.entries(expected)
      .filter(([, at]) => at === 'same')
      .reduce((sum, [slot]) => {
        const [kind, id] = slot.split(/:(.*)/s) as [string, string];
        const event = payloadEvents(recording).find(
          (e) => e.type === `subflow.${kind}` && e.runtimeStageId === id,
        )!;
        return sum + Buffer.byteLength(toWireJson(event.payload));
      }, 0);
    expect(counts.restoredBytes).toBe(restored);
    expect(split.draft.parts.reduce((sum, part) => sum + (part.payloads ?? 0), 0)).toBe(
      counts.stored,
    );
  });
});

describe('S1 · every reader gets the payloads back', () => {
  it.each(CASES)(
    '$name: readWhole deep-equals the whole, and the row is the same JSON text',
    async ({ make }) => {
      const recording = await make();
      const saved = await opened(recording, 2048);
      const whole = await saved.readWhole();
      expect(whole.status).toBe('ready');
      if (whole.status !== 'ready') return;
      expect(whole.recording).toEqual(recording);
      expect(toWireJson(row(whole.recording))).toBe(toWireJson(row(recording)));
    },
  );

  it.each(CASES)(
    '$name: readInvocation serves each moved payload beside its result',
    async ({ make, expected }) => {
      const recording = await make();
      const saved = await opened(recording, 2048);
      const events = payloadEvents(recording);
      for (const [slot, at] of Object.entries(expected)) {
        const [kind, id] = slot.split(/:(.*)/s) as ['entry' | 'exit', string];
        const read = await saved.readInvocation(id);
        if (read.status !== 'ready') throw new Error(read.reason);
        const original = events.find(
          (e) => e.type === `subflow.${kind}` && e.runtimeStageId === id,
        )!;
        expect(read.payloads?.[kind]).toEqual({ status: 'ready', value: original.payload });
        if (at === 'same') {
          // A restored `same` payload IS the result's own object, as a proven alias is.
          const context = (read.result as Json).treeContext as Json;
          const own = kind === 'exit' ? context.globalContext : context.history[0].overwrite;
          expect((read.payloads![kind] as { value: unknown }).value).toBe(own);
        }
      }
      // An invocation none of whose payloads moved answers no `payloads` key.
      for (const invocation of saved.invocations) {
        const moved = Object.keys(expected).some((slot) => slot.endsWith(`:${invocation.key}`));
        if (moved || !invocation.recorded) continue;
        const read = await saved.readInvocation(invocation.key);
        expect(read.status === 'ready' && 'payloads' in read).toBe(false);
      }
    },
  );
});

describe('S1 · a payload moves only on proof', () => {
  async function cut(recording: Recording) {
    const split = await splitRecording(recording, { runId: 'r' });
    return { places: places(split.draft as never), counts: split.draft.subflowPayloads!, split };
  }

  it('a payload whose text differs by one character from the result is stored, never `same`', async () => {
    const recording = await engineRecording('plain');
    const entry = boundaryEvents(recording).find((e) => e.type === 'subflow.entry')!;
    (entry.payload as Json).input = 'hj'; // the result's seed says 'hi'
    const { places: at } = await cut(recording);
    expect(at).toEqual({ 'entry:sf-a#1': 'stored', 'exit:sf-a#1': 'same' });
    const saved = await opened(recording);
    const read = await saved.readInvocation('sf-a#1');
    expect(read.status === 'ready' && read.payloads?.entry).toEqual({
      status: 'ready',
      value: entry.payload,
    });
    const whole = await saved.readWhole();
    expect(whole.status === 'ready' && toWireJson(row(whole.recording))).toBe(
      toWireJson(row(recording)),
    );
  });

  it('an event whose `payload` is not its last key stays whole in the base and is counted', async () => {
    const recording = await engineRecording('plain');
    const data = boundaryEvents(recording);
    const at = data.findIndex((e) => e.type === 'subflow.exit');
    const { payload, ...rest } = data[at]!;
    data[at] = { payload, ...rest };
    const { places: moved, counts, split } = await cut(recording);
    expect(moved).toEqual({ 'entry:sf-a#1': 'same' });
    expect(counts.kept).toEqual({ ambiguous: 0, notLast: 1, noPart: 0 });
    const base = JSON.parse(split.base.text) as { recording: Recording };
    expect(toWireJson(boundaryEvents(base.recording)[at])).toBe(toWireJson(data[at]));
    const whole = await (await opened(recording)).readWhole();
    expect(whole.status === 'ready' && toWireJson(row(whole.recording))).toBe(
      toWireJson(row(recording)),
    );
  });

  it('an id whose events disagree on the subflowId stays whole, both events', async () => {
    const recording = await engineRecording('plain');
    const exit = boundaryEvents(recording).find((e) => e.type === 'subflow.exit')!;
    exit.subflowId = 'sf-other';
    const { places: moved, counts } = await cut(recording);
    expect(moved).toEqual({});
    expect(counts.kept.ambiguous).toBe(2);
  });

  it('an exit with no entry, a second exit, or a second entry stays whole', async () => {
    const noEntry = await engineRecording('plain');
    const rows = (noEntry.snapshot as { recorders: Json[] }).recorders;
    const boundary = rows.find((r) => r.name === 'BoundaryEvents')!;
    boundary.data = (boundary.data as Json[]).filter((e) => e.type !== 'subflow.entry');
    expect((await cut(noEntry)).counts.kept.ambiguous).toBe(1);

    const twoExits = await engineRecording('plain');
    const data = boundaryEvents(twoExits);
    data.push({ ...data.find((e) => e.type === 'subflow.exit')! });
    expect((await cut(twoExits)).places).toEqual({});

    const twoEntries = await engineRecording('plain');
    const events = boundaryEvents(twoEntries);
    events.push({ ...events.find((e) => e.type === 'subflow.entry')! });
    const second = await cut(twoEntries);
    expect(second.places).toEqual({});
    expect(second.counts.kept.ambiguous).toBe(3);
  });

  it('a second BoundaryEvents row holding the same ids makes every id ambiguous', async () => {
    const recording = await engineRecording('plain');
    const rows = (recording.snapshot as { recorders: Json[] }).recorders;
    rows.push({ ...rows.find((r) => r.name === 'BoundaryEvents')!, id: 'boundary-copy' });
    const { places: moved, counts } = await cut(recording);
    expect(moved).toEqual({});
    expect(counts.kept.ambiguous).toBe(4);
  });

  it('a row not in full mode, or one already using the mark key, carries no mark', async () => {
    const lean = await engineRecording('plain');
    delete row(lean).meta;
    expect((await cut(lean)).counts.kept).toEqual({ ambiguous: 0, notLast: 2, noPart: 0 });

    const used = await engineRecording('plain');
    const data = boundaryEvents(used);
    data[0] = { ...data[0], payloadWith: 'invocation' };
    const { places: moved, counts } = await cut(used);
    expect(moved).toEqual({});
    expect(counts.kept.notLast).toBe(2);
    const whole = await (await opened(used)).readWhole();
    expect(whole.status === 'ready' && whole.recording).toEqual(used);
  });

  it('the live recorder stream never carries a mark: only a stored base part does', async () => {
    const recording = await engineRecording('nested');
    expect(boundaryEvents(recording).some((e) => 'payloadWith' in e)).toBe(false);
    expect('subflowPayloads' in row(recording).meta).toBe(false);
  });
});

describe('S1 · a missing or changed part takes only its own invocations', () => {
  it('the root and every other invocation (with its payloads) still read', async () => {
    const recording = await engineRecording('loop');
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, recording, { targetBytes: 512 });
    expect(filed.parts.length).toBeGreaterThan(1);
    const index = JSON.parse(filed.indexText) as Json;
    const lost = (index.invocations as Json[]).find((i) => i.key === 'sf-a#5')!;
    await store.delete(SCOPE, filed.parts[lost.part as number]!);
    const saved = await openSavedRecording(bindArtifacts(store, SCOPE), filed.index);
    if (saved.status !== 'ready') throw new Error(saved.reason);
    expect(await saved.readInvocation('sf-a#5')).toEqual({
      status: 'unavailable',
      reason: 'part-missing',
    });
    expect((await saved.readRoot()).status).toBe('ready');
    for (const other of (index.invocations as Json[]).filter((i) => i.part !== lost.part)) {
      const read = await saved.readInvocation(other.key as string);
      expect(read.status).toBe('ready');
      expect(read.status === 'ready' && read.payloads?.entry?.status).toBe('ready');
    }
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-missing' });
  });
});
