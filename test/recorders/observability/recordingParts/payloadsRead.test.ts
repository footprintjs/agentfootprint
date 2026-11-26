/**
 * S1 · READING BOTH INDEX FORMATS — a recording filed by 18.3.0 (format 1)
 * opens and reads as it did; a format-2 recording charges what `readWhole`
 * restores; the step graph tells "with the invocation" from "none recorded";
 * a part or base that disagrees with its index is refused, never served.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import type { ArtifactMeta } from '../../../../src/artifacts/types.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import { utf8Length } from '../../../../src/lib/utf8.js';
import { toWireJson } from '../../../../src/lib/wireJson.js';
import {
  accountForAnswer,
  buildStepGraphFromEvents,
  openSavedRecording,
  type DomainEvent,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import { unpackPart } from '../../../../src/recorders/observability/recordingParts/packing.js';
import { restorePayloads } from '../../../../src/recorders/observability/recordingParts/payloads.js';
import { boundaryEvents, engineRecording } from './engineRuns.js';
import {
  SCOPE,
  counted,
  fileParts,
  fileWhole,
  forgePart,
  realRecording,
  type FiledParts,
} from './helpers.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function ready<T extends { status: string }>(value: T): Extract<T, { status: 'ready' }> {
  if (value.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(value)}`);
  return value as Extract<T, { status: 'ready' }>;
}

const row = (recording: Recording): Json =>
  (recording.snapshot as { recorders: Json[] }).recorders.find((r) => r.name === 'BoundaryEvents')!;

describe('a recording filed by 18.3.0 (index format 1) still opens', () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('./fixtures/v1-recording-18.3.0.json', import.meta.url)),
      'utf8',
    ),
  ) as { index: string; recording: Recording; artifacts: { meta: ArtifactMeta; text: string }[] };
  const byRef = new Map(fixture.artifacts.map((a) => [a.meta.ref, a]));
  const artifacts = {
    head: async (ref: string) => byRef.get(ref)?.meta ?? null,
    get: async (ref: string) => {
      const found = byRef.get(ref);
      return found === undefined ? null : { meta: found.meta, data: found.text };
    },
  };

  it('every read answers today’s shapes: payloads in the row, no `payloads` beside a result', async () => {
    expect(JSON.parse(fixture.artifacts[0]!.text).format).toBe('agentfootprint.recording.index.v1');
    const saved = ready(await openSavedRecording(artifacts, fixture.index));
    expect(saved.sizes.restoredBytes).toBe(saved.sizes.storedBytes);
    const root = ready(await saved.readRoot());
    expect(row(root.recording)).toEqual(row(fixture.recording));
    expect(boundaryEvents(root.recording).some((e) => 'payloadWith' in e)).toBe(false);
    for (const invocation of saved.invocations) {
      const read = ready(await saved.readInvocation(invocation.key));
      expect('payloads' in read).toBe(false);
      expect(read.result).toEqual(
        (fixture.recording.snapshot as { subflowResults: Json }).subflowResults[invocation.key],
      );
    }
    expect(ready(await saved.readWhole()).recording).toEqual(fixture.recording);
  });

  it('the same run filed now is format 2, and reads back to the same whole', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, fixture.recording);
    expect(JSON.parse(filed.indexText).format).toBe('agentfootprint.recording.index.v2');
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    expect(ready(await saved.readWhole()).recording).toEqual(fixture.recording);
  });
});

describe('a whole recording reads exactly as before: its in-memory cut keeps the payloads in the row', () => {
  it('readRoot has the payloads and no mark; readInvocation has no `payloads`; restoredBytes = storedBytes', async () => {
    const recording = await engineRecording('nested');
    const store = inMemoryArtifacts();
    const ref = await fileWhole(store, recording);
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), ref));
    expect(saved.layout).toBe('whole');
    expect(saved.sizes.restoredBytes).toBe(saved.sizes.storedBytes);
    const root = ready(await saved.readRoot());
    expect(row(root.recording)).toEqual(row(recording));
    for (const invocation of saved.invocations) {
      expect('payloads' in ready(await saved.readInvocation(invocation.key))).toBe(false);
    }
  });
});

describe('readWhole charges the payloads it restores from results', () => {
  async function filedOf(
    packed: boolean,
    recording?: Recording,
  ): Promise<{
    filed: FiledParts;
    saved: SavedRecording;
    store: ReturnType<typeof inMemoryArtifacts>;
  }> {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, recording ?? (await engineRecording('loop')), {
      packed,
      targetBytes: packed ? 16 * 1024 : 1024,
    });
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    return { filed, saved, store };
  }
  const restored = (filed: FiledParts): number =>
    (JSON.parse(filed.indexText) as Json).subflowPayloads.restoredBytes as number;

  it('sizes.restoredBytes is the stored bytes plus the restored payloads', async () => {
    const { filed, saved } = await filedOf(false);
    expect(restored(filed)).toBeGreaterThan(0);
    expect(saved.sizes.restoredBytes).toBe(saved.sizes.storedBytes + restored(filed));
  });

  it('plain parts: exactly maxBytes is read; one byte less is refused from the index, with no part read', async () => {
    const { filed, store } = await filedOf(false);
    const exact =
      filed.split.base.bytes + filed.split.parts.reduce((s, p) => s + p.bytes, 0) + restored(filed);
    const view = counted(store);
    const saved = ready(await openSavedRecording(view.artifacts, filed.index));
    expect(await saved.readWhole({ maxBytes: exact - 1 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    expect(view.calls.get).toEqual([filed.index]);
    expect(ready(await saved.readWhole({ maxBytes: exact })).recording).toBeDefined();
  });

  it('packed parts: the plain total plus the restored payloads is read; one byte less is refused while reading', async () => {
    const { filed, saved } = await filedOf(true, await realRecording());
    const plain = (text: string): number =>
      utf8Length(toWireJson(unpackPart(JSON.parse(text), Number.POSITIVE_INFINITY)));
    const texts = [filed.split.base, ...filed.split.parts];
    const exact = texts.reduce((s, p) => s + plain(p.text), 0) + restored(filed);
    // Far over the stored total, so the refusal below is the in-read charge, not the index's.
    expect(exact - 1).toBeGreaterThan(texts.reduce((s, p) => s + p.bytes, 0) + restored(filed));
    expect(await saved.readWhole({ maxBytes: exact - 1 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    expect(ready(await saved.readWhole({ maxBytes: exact })).recording).toBeDefined();
  });
});

describe('the step graph tells "with the invocation" from "none recorded"', () => {
  it('a format-2 base row gives marks, no values; filled from the invocations it equals the whole’s graph', async () => {
    const recording = await realRecording();
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, recording);
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    const root = ready(await saved.readRoot());
    const graph = buildStepGraphFromEvents(row(root.recording).data as DomainEvent[]);
    const fromWhole = buildStepGraphFromEvents(row(recording).data as DomainEvent[]);

    const slots = graph.nodes.flatMap((node) => Object.values(node.slotBoundaries ?? {}));
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.entryPayloadWith).toBe('invocation');
      expect(slot.exitPayloadWith).toBe('invocation');
      expect('entryPayload' in slot || 'exitPayload' in slot).toBe(false);
    }
    // The viewer's way: ask each marked step's invocation, by its runtimeStageId.
    const fill = async (target: Json): Promise<void> => {
      const read = ready(await saved.readInvocation(target.runtimeStageId as string));
      if (target.entryPayloadWith === 'invocation') {
        target.entryPayload = (read.payloads!.entry as { value: unknown }).value;
        delete target.entryPayloadWith;
      }
      if (target.exitPayloadWith === 'invocation') {
        target.exitPayload = (read.payloads!.exit as { value: unknown }).value;
        delete target.exitPayloadWith;
      }
    };
    for (const node of graph.nodes as Json[]) {
      if (node.entryPayloadWith !== undefined || node.exitPayloadWith !== undefined)
        await fill(node);
      for (const slot of Object.values((node.slotBoundaries ?? {}) as Json))
        await fill(slot as Json);
    }
    expect(JSON.parse(JSON.stringify(graph))).toEqual(JSON.parse(JSON.stringify(fromWhole)));
  });

  it('a sub-flow step: marks on the subflow node; a payload in the row stays a value; neither = none', () => {
    const base = {
      runtimeStageId: 'sf-a#1',
      subflowPath: ['__root__', 'sf-a'],
      depth: 1,
      commitIdxBefore: 0,
      commitIdxAfter: 0,
      subflowId: 'sf-a',
      localSubflowId: 'sf-a',
      subflowName: 'A',
      isAgentInternal: false,
    };
    const graph = buildStepGraphFromEvents([
      {
        type: 'run.entry',
        runtimeStageId: '__root__#0',
        subflowPath: ['__root__'],
        depth: 0,
        ts: 0,
        commitIdxBefore: 0,
        commitIdxAfter: 0,
        isRoot: true,
      },
      { ...base, type: 'subflow.entry', ts: 1, payloadWith: 'invocation' },
      { ...base, type: 'subflow.exit', ts: 2, payload: { kept: true } },
      { ...base, runtimeStageId: 'sf-b#2', type: 'subflow.entry', ts: 3 },
    ] as DomainEvent[]);
    const [a, b] = graph.nodes.filter((n) => n.kind === 'subflow' && n.id !== '__root__#0');
    expect(a).toMatchObject({ entryPayloadWith: 'invocation', exitPayload: { kept: true } });
    expect('entryPayload' in a! || 'exitPayloadWith' in a!).toBe(false);
    expect(
      ['entryPayload', 'entryPayloadWith', 'exitPayload', 'exitPayloadWith'].some((k) => k in b!),
    ).toBe(false);
  });
});

describe('a part or base that disagrees with the index is refused, not served', () => {
  async function filedWithStored(): Promise<{
    store: ReturnType<typeof inMemoryArtifacts>;
    filed: FiledParts;
  }> {
    const store = inMemoryArtifacts();
    const filed = await fileParts(
      store,
      await engineRecording('plain', { policy: { keys: ['password'] } }),
    );
    expect((JSON.parse(filed.indexText) as Json).subflowPayloads.stored).toBe(2);
    return { store, filed };
  }

  it('a part whose stored payloads lack one the index places there is part-changed', async () => {
    const { store, filed } = await filedWithStored();
    const part = JSON.parse(filed.split.parts[0]!.text) as Json;
    delete part.payloads['sf-a#1'].exit;
    const ref = await forgePart(store, filed, 0, JSON.stringify(part));
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), ref));
    expect(await saved.readInvocation('sf-a#1')).toEqual({
      status: 'unavailable',
      reason: 'part-changed',
    });
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
  });

  it('a part without its payloads member, or one with a member the index does not name, is part-changed', async () => {
    const { store, filed } = await filedWithStored();
    for (const forge of [
      (p: Json) => delete p.payloads,
      (p: Json) => (p.payloads['sf-z#9'] = { entry: 1 }),
      (p: Json) => (p.payloads['sf-a#1'].other = 1),
      (p: Json) => (p.format = 'agentfootprint.recording.part.v1'),
    ]) {
      const part = JSON.parse(filed.split.parts[0]!.text) as Json;
      forge(part);
      const ref = await forgePart(store, filed, 0, JSON.stringify(part));
      const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), ref));
      expect(await saved.readInvocation('sf-a#1')).toEqual({
        status: 'unavailable',
        reason: 'part-changed',
      });
    }
  });

  it('a base whose marks do not match the index fails readWhole as part-changed; readRoot serves it as stored', async () => {
    const { store, filed } = await filedWithStored();
    const forgeries: ((events: Json[], meta: Json) => void)[] = [
      (events) => delete events.find((e) => 'payloadWith' in e)!.payloadWith, // one mark fewer
      (events) => (events.find((e) => e.type === 'run.entry')!.payloadWith = 'invocation'), // a mark on a run event
      (events) => events.push({ ...events.find((e) => 'payloadWith' in e)! }), // the same mark twice
      (_events, meta) => delete meta.subflowPayloads, // marks with no row fact
      (events) => (events.find((e) => 'payloadWith' in e)!.payloadWith = 'elsewhere'),
      // The row fact not in the last place: restoring it would not give back the row's text.
      (_events, meta) => {
        const { mode, ...rest } = meta;
        delete meta.mode;
        delete meta.subflowPayloads;
        Object.assign(meta, rest, { mode });
      },
    ];
    for (const forge of forgeries) {
      const base = JSON.parse(filed.split.base.text) as { recording: Recording } & Json;
      const boundary = row(base.recording);
      forge(boundary.data as Json[], boundary.meta as Json);
      const ref = await forgePart(store, filed, 'base', JSON.stringify(base));
      const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), ref));
      expect((await saved.readRoot()).status).toBe('ready');
      expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
    }
  });
});

describe('restorePayloads refuses a mark it cannot have written, whatever the resolver says', () => {
  it('a mark on an event that is not a sub-flow boundary event', () => {
    const recording = {
      snapshot: {
        recorders: [
          {
            name: 'BoundaryEvents',
            data: [{ type: 'run.entry', runtimeStageId: 'sf-a#1', payloadWith: 'invocation' }],
            meta: { mode: 'full', subflowPayloads: 'with-invocation' },
          },
        ],
      },
    };
    expect(restorePayloads(recording, () => ({ value: 1 }), 1)).toBe(false);
  });

  const marked = (events: Record<string, unknown>[]) => ({
    snapshot: {
      recorders: [
        {
          name: 'BoundaryEvents',
          data: events,
          meta: { mode: 'full', subflowPayloads: 'with-invocation' },
        },
      ],
    },
  });
  const entry = { type: 'subflow.entry', runtimeStageId: 'sf-a#1', payloadWith: 'invocation' };

  it('fewer marks than the index moved', () => {
    expect(restorePayloads(marked([{ ...entry }]), () => ({ value: 1 }), 2)).toBe(false);
    expect(restorePayloads(marked([{ ...entry }]), () => ({ value: 1 }), 1)).toBe(true);
  });

  it('the same mark twice, whatever the index counts', () => {
    expect(restorePayloads(marked([{ ...entry }, { ...entry }]), () => ({ value: 1 }), 1)).toBe(
      false,
    );
    expect(restorePayloads(marked([{ ...entry }, { ...entry }]), () => ({ value: 1 }), 2)).toBe(
      false,
    );
  });
});

describe('the answer account is the same from the same run, before and after', () => {
  it('accountForAnswer over readWhole equals the one over the whole recording', async () => {
    const recording = await realRecording();
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, recording);
    const saved = ready(await openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
    const whole = ready(await saved.readWhole());
    expect(accountForAnswer(whole.recording)).toEqual(accountForAnswer(recording));
  });
});
