import { describe, expect, it } from 'vitest';
import type { Recording } from '../recordRun.js';
import type { AgentfootprintEventMap } from '../../../events/registry.js';
import { contextChange, applyContextChange } from './changes.js';
import { writeContextRecording } from './write.js';
import { readContextRecording } from './read.js';
import { jsonBudget } from './json.js';
import { ContextRecordingError, type ContextValueWriter } from './types.js';

/** $0 adapter double. It tests the port, never claims to implement a digest. */
function table() {
  const entries = new Map<string, unknown>();
  const byValue = new Map<string, string>();
  const writer: ContextValueWriter = {
    async intern(_label, value) {
      const key = JSON.stringify(value);
      let ref = byValue.get(key);
      if (!ref) {
        ref = `test-value-${entries.size}`;
        byValue.set(key, ref);
        entries.set(ref, structuredClone(value));
      }
      return { status: 'stored', reference: { ref } };
    },
    record: (record) => ({ format: 'foottrace.value-record.v1', record, valueTable: {} }),
  };
  const open = async (input: unknown) => ({
    record: (input as { record: unknown }).record,
    values: {
      resolve(reference: unknown) {
        const ref = (reference as { ref: string }).ref;
        if (!entries.has(ref)) throw new Error('dangling test reference');
        return entries.get(ref);
      },
    },
  });
  return { writer, open, entries };
}

function frame(
  iteration: number,
  texts: string[],
  runId = 'native-run',
): AgentfootprintEventMap['agentfootprint.context.recorded'] {
  return {
    type: 'agentfootprint.context.recorded',
    payload: { iteration, pieces: texts.map((rawContent) => ({ source: 'steering', rawContent })) },
    meta: {
      runId,
      compositionPath: ['Agent:test'],
      subflowPath: [],
      wallClockMs: iteration,
      runOffsetMs: iteration,
      runtimeStageId: `call-llm#${iteration}`,
      sourcePosition: {
        engineRunId: runId,
        logRunId: runId,
        drillPath: [],
        committedThroughIdx: iteration,
      },
    },
  };
}

const recording = (events: Recording['events'], snapshot: unknown = {}): Recording => ({
  events,
  snapshot,
  structure: {},
});

describe('context record value port and change lists', () => {
  it('records first/all, unchanged, added and removed; expands every old value exactly', async () => {
    const a = 'first unchanged rule '.repeat(100);
    const b = 'second rule '.repeat(100);
    const c = 'replacement rule '.repeat(100);
    const events = [frame(1, [a, b]), frame(2, [a, b]), frame(3, [a, c])];
    const snapshot = {
      copies: [a, b, a, b, a, c],
      literal: { ref: 'a literal, never a value reference' },
    };
    const source = recording(events, snapshot);
    const port = table();
    const saved = await writeContextRecording(source, port.writer, 0, 0);
    expect(port.entries.size).toBe(3);
    expect(
      saved.record.calls.map(({ added, removed, unchanged }) => [
        added.length,
        removed.length,
        unchanged,
      ]),
    ).toEqual([
      [2, 0, 0],
      [0, 0, 2],
      [1, 1, 1],
    ]);
    const read = await readContextRecording(JSON.parse(JSON.stringify(saved)), port.open);
    expect(read.recording).toEqual(recording([], snapshot));
    expect((read.recording as Recording).snapshot).toEqual(source.snapshot);
    const ids1 = applyContextChange([], read.calls[0]);
    const ids2 = applyContextChange(ids1, read.calls[1]);
    const ids3 = applyContextChange(ids2, read.calls[2]);
    expect(ids3.map((ref) => read.values!.resolve({ ref }))).toEqual([a, c]);
    expect(JSON.stringify(saved)).not.toContain(a);
  });

  it('preserves duplicates and reordering without listing every id each call', () => {
    const prior = ['a', 'b', 'a'];
    const next = ['a', 'c', 'a', 'b'];
    const delta = contextChange(prior, next);
    expect(delta).toEqual({ added: ['c'], removed: [], unchanged: 3, order: [0, 3, 2, 1] });
    expect(applyContextChange(prior, delta)).toEqual(next);
    expect(contextChange(next, next)).toEqual({ added: [], removed: [], unchanged: 4 });
    const duplicateRemoval = contextChange(['x', 'a', 'x'], ['x', 'a']);
    expect(applyContextChange(['x', 'a', 'x'], duplicateRemoval)).toEqual(['x', 'a']);
    expect(() =>
      applyContextChange(prior, { added: [], removed: ['missing'], unchanged: 2 }),
    ).toThrow(ContextRecordingError);
    expect(() =>
      applyContextChange(prior, { added: [], removed: [], unchanged: 3, order: [0, 0, 1] }),
    ).toThrow(ContextRecordingError);
  });

  it('never diffs one native run against another, even when events interleave', async () => {
    const port = table();
    const saved = await writeContextRecording(
      recording([
        frame(1, ['a'], 'one'),
        frame(1, ['b'], 'two'),
        frame(2, ['a'], 'one'),
        frame(2, ['b'], 'two'),
      ]),
      port.writer,
      4,
      4,
    );
    expect(saved.record.calls.map((c) => [c.call, c.added.length, c.unchanged])).toEqual([
      [1, 1, 0],
      [1, 1, 0],
      [2, 0, 1],
      [2, 0, 1],
    ]);
    expect(saved.record.droppedEvents).toBe(4);
  });

  it('passes old records through by identity without interpreting literal references', async () => {
    const old = recording([], { ref: 'literal' });
    const read = await readContextRecording(old, async (input) => ({ record: input }));
    expect(read.recording).toBe(old);
  });

  it('refuses an omitted table value instead of leaking it through an inline fallback', async () => {
    const port = table();
    port.writer.intern = async () => ({ status: 'omitted', reason: 'redaction-failed' });
    await expect(
      writeContextRecording(recording([frame(1, ['private'])]), port.writer, 0, 0),
    ).rejects.toMatchObject({ reason: 'value-omitted' });
  });

  it('refuses dangling, duplicate and overlapping reference paths and unknown versions', async () => {
    const port = table();
    const saved = await writeContextRecording(
      recording([frame(1, ['a'])], { text: 'a' }),
      port.writer,
      0,
      0,
    );
    const bad = structuredClone(saved);
    (bad.record.recording as { snapshot: { text: unknown } }).snapshot.text = { ref: 'missing' };
    await expect(readContextRecording(bad, port.open)).rejects.toMatchObject({
      reason: 'invalid-record',
    });
    const twice = {
      ...saved,
      record: {
        ...saved.record,
        referencePaths: [...saved.record.referencePaths, ...saved.record.referencePaths],
      },
    };
    await expect(readContextRecording(twice, port.open)).rejects.toThrow(ContextRecordingError);
    const future = {
      ...saved,
      record: { ...saved.record, format: 'agentfootprint.context-recording.v999' },
    };
    await expect(readContextRecording(future, port.open)).rejects.toThrow(ContextRecordingError);
  });

  it('does not invoke getters or pollute prototypes at a declared reference path', async () => {
    let calls = 0;
    const bad = {
      format: 'agentfootprint.context-recording.v1',
      get recording() {
        calls++;
        return {};
      },
    };
    await expect(
      readContextRecording(bad, async (record) => ({ record, values: { resolve: () => null } })),
    ).rejects.toThrow(ContextRecordingError);
    expect(calls).toBe(0);
    const port = table();
    const saved = await writeContextRecording(
      recording([frame(1, ['a'])], JSON.parse('{"__proto__":"a"}')),
      port.writer,
      0,
      0,
    );
    const read = await readContextRecording(saved, port.open);
    expect(Object.hasOwn((read.recording as Recording).snapshot as object, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('owns new-format data before the adapter yields, but never reads an old format getter', async () => {
    const port = table();
    const saved = structuredClone(
      await writeContextRecording(recording([frame(1, ['a'])], { text: 'a' }), port.writer, 0, 0),
    );
    const pending = readContextRecording(saved, async (input) => {
      await Promise.resolve();
      return port.open(input);
    });
    (saved.record.recording as { snapshot: { text: unknown } }).snapshot.text =
      'changed after read';
    expect((await pending).recording).toEqual(recording([], { text: 'a' }));
    let reads = 0;
    const old = {
      get format() {
        reads++;
        throw new Error('getter');
      },
      ref: 'literal',
    };
    expect((await readContextRecording(old, async (record) => ({ record }))).recording).toBe(old);
    expect(reads).toBe(0);
  });

  it('bounds expansion and replaces even a forged refusal with fixed words', async () => {
    expect(() => jsonBudget(12, 100).copy('too much text')).toThrow(ContextRecordingError);
    expect(() => jsonBudget(100, 2).copy([1, 2, 3])).toThrow(ContextRecordingError);
    const forged = new ContextRecordingError('limit');
    forged.message = 'SECRET';
    await expect(
      readContextRecording({}, async () => {
        throw forged;
      }),
    ).rejects.toMatchObject({ message: 'Context recording refused: limit' });
  });
});
