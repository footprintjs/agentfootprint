/**
 * THE PACKED BOUNDS — a packed part is expanded only within the plain size the
 * reader allows, measured BEFORE anything is built:
 *
 *   • one amplified packed part, behind an index consistent on its digest, is
 *     `too-large` with zero nodes expanded (the codec's own work counter);
 *   • a value table that refers to itself is `part-changed`;
 *   • `readWhole`'s `maxBytes` bounds the EXPANDED total: packed parts that are
 *     small stored and large plain are refused once the plain total passes it.
 *
 * The codec's `unpackRecording` is wrapped to run `unpackCounted` with a work
 * counter, so each expansion the reader asks for is counted.
 */
import { describe, expect, it, vi } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import {
  openSavedRecording,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import { RECORDING_PART_FORMAT } from '../../../../src/recorders/observability/recordingParts/format.js';
import { RUN_ID, SCOPE, fileParts, forgePart, realRecording } from './helpers.js';

const works = vi.hoisted(() => [] as { measured: number; decoded: number }[]);

vi.mock('../../../../src/recorders/observability/recordingPack.js', async (importOriginal) => {
  const codec = await importOriginal<
    typeof import('../../../../src/recorders/observability/recordingPack.js')
  >();
  return {
    ...codec,
    unpackRecording: (input: unknown, options?: { maxBytes?: number }) => {
      const work = { measured: 0, decoded: 0 };
      works.push(work);
      return codec.unpackCounted(input, options ?? {}, work);
    },
  };
});

const serialised = vi.hoisted(() => ({ on: false, calls: 0 }));

vi.mock('../../../../src/lib/wireJson.js', async (importOriginal) => {
  const wire = await importOriginal<typeof import('../../../../src/lib/wireJson.js')>();
  return {
    ...wire,
    toWireJson: (...args: Parameters<typeof wire.toWireJson>) => {
      if (serialised.on) serialised.calls++;
      return wire.toWireJson(...args);
    },
  };
});

const PACKED = 'agentfootprint.recording.packed.v1';

async function ready(promise: Promise<unknown>): Promise<SavedRecording> {
  const result = (await promise) as SavedRecording | { status: 'unavailable'; reason: string };
  if (result.status !== 'ready') throw new Error(`not opened: ${result.reason}`);
  return result;
}

describe('a packed part expands only within its bound', () => {
  it('an amplified packed part is too-large, and nothing is expanded', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, await realRecording(), {
      packed: true,
      targetBytes: 16384,
    });
    const key = (
      JSON.parse(filed.indexText) as { invocations: { key: string; part: number }[] }
    ).invocations.find((row) => row.part === 0)!.key;
    // One 4 KiB value referred to 50,000 times: ~0.7 MB packed, ~200 MB plain.
    const amplified = JSON.stringify({
      format: PACKED,
      values: ['x'.repeat(4096)],
      recording: {
        format: RECORDING_PART_FORMAT,
        runId: RUN_ID,
        part: 0,
        results: { [key]: Array.from({ length: 50_000 }, () => ({ '$af:ref': 0 })) },
        aliases: {},
      },
    });
    const index = await forgePart(store, filed, 0, amplified);
    const saved = await ready(openSavedRecording(bindArtifacts(store, SCOPE), index));
    works.length = 0;
    expect(await saved.readInvocation(key)).toEqual({ status: 'unavailable', reason: 'too-large' });
    expect(works).toHaveLength(1);
    expect(works[0]!.measured).toBeGreaterThan(0);
    expect(works[0]!.decoded).toBe(0);
  });

  it('a value table that refers to itself is part-changed', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, await realRecording(), {
      packed: true,
      targetBytes: 16384,
    });
    const key = (
      JSON.parse(filed.indexText) as { invocations: { key: string; part: number }[] }
    ).invocations.find((row) => row.part === 0)!.key;
    const looping = JSON.stringify({
      format: PACKED,
      values: [{ '$af:ref': 0 }],
      recording: {
        format: RECORDING_PART_FORMAT,
        runId: RUN_ID,
        part: 0,
        results: { [key]: { '$af:ref': 0 } },
        aliases: {},
      },
    });
    const index = await forgePart(store, filed, 0, looping);
    const saved = await ready(openSavedRecording(bindArtifacts(store, SCOPE), index));
    expect(await saved.readInvocation(key)).toEqual({
      status: 'unavailable',
      reason: 'part-changed',
    });
  });
});

describe("readWhole's maxBytes bounds what it expands", () => {
  /** Three mounts, each result holding 1,000 copies of one 4 KiB string: small packed, ~12 MB plain. */
  function heavy(): Recording {
    const unit = (id: string) => ({
      subflowId: id,
      subflowName: id,
      parentStageId: 'seed',
      treeContext: {
        globalContext: { rows: Array.from({ length: 1000 }, () => `${id}:${'y'.repeat(4096)}`) },
        stageContexts: {},
        history: [],
      },
    });
    const mount = (key: string, id: string, next?: object) => ({
      id,
      name: id,
      subflowId: id,
      runtimeStageId: key,
      ...(next && { next }),
    });
    return {
      snapshot: {
        runId: 'snapshot-run',
        executionTree: mount('a#1', 'a', mount('b#2', 'b', mount('c#3', 'c'))),
        subflowResults: { 'a#1': unit('a'), 'b#2': unit('b'), 'c#3': unit('c') },
      },
      events: [],
      structure: { id: 'seed', name: 'seed' },
    };
  }

  it('refuses once the plain total passes maxBytes, though the stored total is far below it', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, heavy(), { packed: true });
    const saved = await ready(openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    expect(saved.sizes.storedBytes).toBeLessThan(256 * 1024);
    works.length = 0;
    expect(await saved.readWhole({ maxBytes: 1024 * 1024 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    // The part that would pass the budget was measured and refused, never expanded.
    expect(works.at(-1)!.decoded).toBe(0);
    // Within a budget that holds it, the same recording reads back whole.
    const whole = await saved.readWhole({ maxBytes: 32 * 1024 * 1024 });
    expect(whole.status).toBe('ready');
    if (whole.status === 'ready')
      expect(whole.recording).toEqual(JSON.parse(JSON.stringify(heavy())));
  });
});

describe('a budget is paid for only where one is in force', () => {
  /** No subflows: everything is in the base part, ~6 MB plain and small packed. */
  function baseOnly(): Recording {
    return {
      snapshot: {
        runId: 'snapshot-run',
        executionTree: { id: 'seed', name: 'seed' },
        sharedState: { rows: Array.from({ length: 1500 }, () => `z${'w'.repeat(4096)}`) },
      },
      events: [],
      structure: { id: 'seed', name: 'seed' },
    };
  }

  it("the BASE part stays within readWhole's budget, refused before it expands", async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, baseOnly(), { packed: true });
    const saved = await ready(openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    expect(saved.sizes.parts).toEqual([]);
    expect(saved.sizes.storedBytes).toBeLessThan(64 * 1024);
    works.length = 0;
    expect(await saved.readWhole({ maxBytes: 1024 * 1024 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    expect(works).toHaveLength(1);
    expect(works[0]!.decoded).toBe(0);
    expect((await saved.readWhole({ maxBytes: 16 * 1024 * 1024 })).status).toBe('ready');
  });

  it('a single read does not serialise a packed part again; a budgeted read measures it once', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, await realRecording(), {
      packed: true,
      targetBytes: 16384,
    });
    const saved = await ready(openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    const key = saved.invocations.find((row) => row.recorded)!.key;

    serialised.calls = 0;
    serialised.on = true;
    try {
      expect((await saved.readInvocation(key)).status).toBe('ready');
      expect((await saved.readRoot()).status).toBe('ready');
      expect(serialised.calls).toBe(0);
      // The bounded path still measures — one serialisation per part it reads — and still refuses.
      expect((await saved.readWhole()).status).toBe('ready');
      expect(serialised.calls).toBe(saved.sizes.parts.length + 1);
      expect(await saved.readWhole({ maxBytes: 4096 })).toEqual({
        status: 'unavailable',
        reason: 'too-large',
      });
    } finally {
      serialised.on = false;
    }
  });
});
