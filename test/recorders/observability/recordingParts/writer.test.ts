/**
 * THE WRITER — `artifacts: { recordings: { layout: 'parts' } }` files a real
 * agent run in parts, and `openSavedRecording` serves what it filed.
 *
 * Oracle for E1/E2/E3 through the real writer: the exact recording the writer
 * was handed (captured at the call), not anything the writer produced.
 *
 *   W1 · a store that refuses midway: nothing stays, one refusal, answer unchanged
 *   W2 · retention evicting the recording's own part: stopped, undone, sweeps reported
 *   W3 · a paused run files nothing
 *   W4 · a run with no subflows: an index and a base part
 *   W5 · past the bounds: refused, nothing stored
 *   and: the index is written LAST, a ticket that disagrees stops the filing,
 *   a delete that fails is counted, the index never outlives a part, the
 *   option refuses an unknown layout, and `'whole'` stays one artifact.
 */
import { describe, expect, it, vi } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import {
  RECORDING_ARTIFACT_KIND,
  RECORDING_INDEX_ARTIFACT_KIND,
  RECORDING_PART_ARTIFACT_KIND,
} from '../../../../src/artifacts/recordingArtifact.js';
import type { ArtifactScope, ArtifactStore } from '../../../../src/artifacts/types.js';
import { askHuman } from '../../../../src/core/pause.js';
import { Agent, defineTool, inMemoryArtifacts, sqliteArtifacts } from '../../../../src/index.js';
import type { AgentfootprintEvent } from '../../../../src/index.js';
import { toWireJson } from '../../../../src/lib/wireJson.js';
import { openSavedRecording, type SavedRecording } from '../../../../src/observe.js';
import { mock } from '../../../../src/providers.js';
import { enableDevMode, disableDevMode } from 'footprintjs';
import {
  NO_BUDGET_WARNING,
  fileRecordingParts,
} from '../../../../src/recorders/observability/recordingParts/file.js';
import { splitRecording } from '../../../../src/recorders/observability/recordingParts/split.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STORES, sqliteAvailable } from './helpers.js';
import { viewerProjection } from './viewerWalk.js';

const handed = vi.hoisted(() => [] as unknown[]);

vi.mock(
  '../../../../src/recorders/observability/recordingParts/file.js',
  async (importOriginal) => {
    const real = await importOriginal<
      typeof import('../../../../src/recorders/observability/recordingParts/file.js')
    >();
    return {
      ...real,
      fileRecordingParts: (...args: Parameters<typeof real.fileRecordingParts>) => {
        handed.push(args[2]);
        return real.fileRecordingParts(...args);
      },
    };
  },
);

type Rec = Record<string, unknown>;
const SCOPE: ArtifactScope = { conversationId: 'writer' };

function agentOn(
  store: ArtifactStore,
  options: { layout?: unknown; pause?: boolean; packed?: boolean } = {},
) {
  const lookup = defineTool<{ page: number }, unknown>({
    name: 'lookup',
    description: 'Returns one page of rows.',
    inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
    execute: ({ page }) => Array.from({ length: 40 }, (_, i) => ({ id: i, page })),
  });
  const ask = defineTool({
    name: 'ask_it',
    description: 'ask',
    execute: async (): Promise<string> => askHuman('are you sure?'),
  });
  const agent = Agent.create({
    provider: mock({
      replies: options.pause
        ? [{ toolCalls: [{ id: 'q', name: 'ask_it', args: {} }] }]
        : [
            { toolCalls: [{ id: 'a', name: 'lookup', args: { page: 1 } }] },
            { toolCalls: [{ id: 'b', name: 'lookup', args: { page: 2 } }] },
            { content: 'the answer' },
          ],
    }),
    model: 'mock',
    reactMode: 'dynamic-grouped',
    artifacts: {
      store,
      recordings: {
        layout: (options.layout ?? 'parts') as 'parts',
        ...(options.packed && { packed: true }),
      },
    },
  })
    .tool(options.pause ? ask : lookup)
    .build();
  const events: { type: string; payload: Rec }[] = [];
  for (const type of [
    'agentfootprint.artifacts.minted',
    'agentfootprint.artifacts.refused',
    'agentfootprint.artifacts.expired',
  ] as const) {
    agent.on(type, (event: AgentfootprintEvent) =>
      events.push({ type, payload: (event as unknown as { payload: Rec }).payload }),
    );
  }
  return { agent, events };
}

async function kindsIn(store: ArtifactStore): Promise<string[]> {
  return (await store.list(SCOPE, { limit: 500 })).artifacts.map((meta) => meta.kind);
}

describe.each(STORES)('the writer through a real agent run — $name', (storeCase) => {
  for (const packed of [false, true]) {
    it(`files the run in parts and every read equals what it was handed${
      packed ? ' (packed)' : ''
    }`, async () => {
      const { store, close } = storeCase.create();
      try {
        handed.length = 0;
        const { agent, events } = agentOn(store, { packed });
        expect(await agent.run({ message: 'Read two pages.', identity: SCOPE })).toBe('the answer');
        expect(handed).toHaveLength(1);
        const recording = JSON.parse(toWireJson(handed[0])) as Rec;

        const minted = events.filter((event) => event.type.endsWith('minted'));
        expect(minted.at(-1)!.payload.kind).toBe(RECORDING_INDEX_ARTIFACT_KIND);
        expect(
          minted.slice(0, -1).every((e) => e.payload.kind === RECORDING_PART_ARTIFACT_KIND),
        ).toBe(true);
        expect(events.some((event) => event.type.endsWith('refused'))).toBe(false);
        expect(await kindsIn(store)).not.toContain(RECORDING_ARTIFACT_KIND);

        const opened = await openSavedRecording(
          bindArtifacts(store, SCOPE),
          minted.at(-1)!.payload.ref as string,
        );
        if (opened.status !== 'ready') throw new Error(opened.reason);
        expect(opened.layout).toBe('parts');
        expect(opened.sizes.artifacts).toBe(minted.length);
        // E1 · the whole read back equals the recording the writer was handed.
        expect(await opened.readWhole()).toEqual({ status: 'ready', recording });
        // E2 · every execution key reads its own result.
        const results = (recording.snapshot as Rec).subflowResults as Rec;
        for (const key of Object.keys(results).filter((k) => k.includes('#'))) {
          const read = await opened.readInvocation(key);
          expect(read.status === 'ready' && read.result, key).toEqual(results[key]);
        }
        // E3 · the addresses are the viewer's.
        expect(opened.invocations.map((row) => row.path)).toEqual(
          viewerProjection(recording).root.invocations.map((row) => row.invocationPath),
        );
      } finally {
        close();
      }
    });
  }

  it('W1 · a store that refuses midway keeps nothing; one refusal; the answer is unchanged', async () => {
    const { store, close } = storeCase.create();
    try {
      let puts = 0;
      const refusing: ArtifactStore = {
        ...store,
        put: (scope, input) =>
          ++puts === 2 ? Promise.reject(new Error('quota')) : store.put(scope, input),
        head: store.head.bind(store),
        get: store.get.bind(store),
        delete: store.delete.bind(store),
        list: store.list.bind(store),
      };
      const { agent, events } = agentOn(refusing);
      expect(await agent.run({ message: 'Read two pages.', identity: SCOPE })).toBe('the answer');
      expect(await kindsIn(store)).toEqual([]);
      const refused = events.filter((event) => event.type.endsWith('refused'));
      expect(refused).toHaveLength(1);
      expect(refused[0]!.payload).toEqual({
        op: 'put',
        reason: 'invalid-input',
        detail:
          'The run recording was not filed in parts (store-refused): the store refused a part. 1 written part(s) removed.',
      });
      expect(events.some((event) => event.type.endsWith('minted'))).toBe(false);
    } finally {
      close();
    }
  });

  it("W2 · a store that states no budget: retention evicting the recording's own part stops the filing", async () => {
    const budgeted = inMemoryArtifacts({ retention: { maxCountPerScope: 2 } });
    const store = withoutBudget(budgeted);
    const { agent, events } = agentOn(store);
    expect(await agent.run({ message: 'Read two pages.', identity: SCOPE })).toBe('the answer');
    expect(await kindsIn(budgeted)).toEqual([]);
    const expired = events.filter((event) => event.type.endsWith('expired'));
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((event) => event.payload.kind === RECORDING_PART_ARTIFACT_KIND)).toBe(
      true,
    );
    const refused = events.filter((event) => event.type.endsWith('refused'));
    expect(refused).toHaveLength(1);
    expect(refused[0]!.payload.detail).toMatch(
      /^The run recording was not filed in parts \(evicted-own-part\): the store's retention evicted one of its own parts/,
    );
    expect(events.some((event) => event.type.endsWith('minted'))).toBe(false);
  });

  it('a store that states its budget: a recording that cannot fit is refused before any put', async () => {
    const store = inMemoryArtifacts({ retention: { maxCountPerScope: 2 } });
    const { agent, events } = agentOn(store);
    expect(await agent.run({ message: 'Read two pages.', identity: SCOPE })).toBe('the answer');
    expect(await kindsIn(store)).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['agentfootprint.artifacts.refused']);
    expect(events[0]!.payload.detail).toBe(
      "The run recording was not filed in parts (would-not-fit): its parts and index together are more than the store's budget for the scope. 0 written part(s) removed.",
    );
  });

  it('W3 · a paused run files nothing', async () => {
    const { store, close } = storeCase.create();
    try {
      handed.length = 0;
      const { agent, events } = agentOn(store, { pause: true });
      const outcome = await agent.run({ message: 'go', identity: SCOPE });
      expect((outcome as { paused?: boolean }).paused).toBe(true);
      expect(handed).toEqual([]);
      expect(await kindsIn(store)).toEqual([]);
      expect(events).toEqual([]);
    } finally {
      close();
    }
  });

  it("the layout option: an unknown one is refused when the agent is built; 'whole' stays one recording", async () => {
    const { store, close } = storeCase.create();
    try {
      expect(() => agentOn(store, { layout: 'pieces' })).toThrow(
        "Agent artifacts.recordings.layout is 'whole' or 'parts'.",
      );
      const { agent } = agentOn(store, { layout: 'whole' });
      await agent.run({ message: 'Read two pages.', identity: SCOPE });
      expect(await kindsIn(store)).toEqual([RECORDING_ARTIFACT_KIND]);
    } finally {
      close();
    }
  });
});

function unit(id: string): Rec {
  return {
    subflowId: id,
    subflowName: id,
    parentStageId: 'seed',
    treeContext: { globalContext: { pad: 'p'.repeat(3000) }, stageContexts: {}, history: [] },
  };
}

function chain(count: number): { tree: Rec | undefined; results: Rec } {
  let tree: Rec | undefined;
  const results: Rec = {};
  for (let i = count; i >= 1; i--) {
    tree = {
      id: `s${i}`,
      name: `s${i}`,
      subflowId: `s${i}`,
      runtimeStageId: `s${i}#${i}`,
      ...(tree && { next: tree }),
    };
    results[`s${i}#${i}`] = unit(`s${i}`);
  }
  return { tree, results };
}

function recordingOf(count: number): Rec {
  const { tree, results } = chain(count);
  return {
    snapshot: {
      runId: 'snap',
      executionTree: tree ?? null,
      ...(count > 0 && { subflowResults: results }),
    },
    events: [],
    structure: { id: 'seed', name: 'seed' },
  };
}

/** A store view that records every put's kind, and can lie about or refuse calls. */
function watched(
  store: ArtifactStore,
  options: { mismatchAt?: number; digestMismatchAt?: number; failDelete?: boolean } = {},
): { store: ArtifactStore; kinds: string[]; deletes: string[] } {
  const kinds: string[] = [];
  const deletes: string[] = [];
  return {
    kinds,
    deletes,
    store: {
      ...store,
      head: store.head.bind(store),
      get: store.get.bind(store),
      list: store.list.bind(store),
      async put(scope, input) {
        kinds.push(input.kind);
        const result = await store.put(scope, input);
        if (kinds.length === options.digestMismatchAt) {
          return { ...result, meta: { ...result.meta, digest: `sha-256:${'0'.repeat(64)}` } };
        }
        return kinds.length === options.mismatchAt
          ? { ...result, meta: { ...result.meta, bytes: result.meta.bytes + 1 } }
          : result;
      },
      async delete(scope, ref) {
        deletes.push(ref);
        if (options.failDelete) throw new Error('read-only');
        return store.delete(scope, ref);
      },
    },
  };
}

describe('the writer, store by store', () => {
  it('writes every part before the index, and the index last', async () => {
    const view = watched(inMemoryArtifacts());
    const filed = await fileRecordingParts(view.store, SCOPE, recordingOf(6), {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(filed.status).toBe('filed');
    expect(view.kinds.length).toBeGreaterThan(3);
    expect(view.kinds.at(-1)).toBe(RECORDING_INDEX_ARTIFACT_KIND);
    expect(view.kinds.slice(0, -1).every((kind) => kind === RECORDING_PART_ARTIFACT_KIND)).toBe(
      true,
    );
  });

  it('a ticket that disagrees with what was written stops the filing and undoes it', async () => {
    const inner = inMemoryArtifacts();
    const view = watched(inner, { mismatchAt: 2 });
    const filed = await fileRecordingParts(view.store, SCOPE, recordingOf(6), {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(filed).toMatchObject({
      status: 'refused',
      reason: 'store-mismatch',
      removed: 2,
      left: 0,
    });
    expect(view.kinds).toHaveLength(2);
    expect(await kindsIn(inner)).toEqual([]);
  });

  it('a delete that fails is counted as left to retention, never hidden', async () => {
    const inner = inMemoryArtifacts();
    const view = watched(inner, { mismatchAt: 3, failDelete: true });
    const filed = await fileRecordingParts(view.store, SCOPE, recordingOf(6), {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(filed).toMatchObject({ status: 'refused', removed: 0, left: 3 });
    if (filed.status === 'refused') {
      expect(filed.detail).toBe(
        "The run recording was not filed in parts (store-mismatch): the store kept different bytes than it was given. 0 written part(s) removed, 3 left to the store's retention.",
      );
    }
    expect(view.deletes).toHaveLength(3);
  });

  it('W2 · without a stated budget, a byte budget that cannot hold the recording stops at the first self-eviction', async () => {
    const inner = inMemoryArtifacts({ retention: { maxBytesPerScope: 12_000 } });
    const filed = await fileRecordingParts(withoutBudget(inner), SCOPE, recordingOf(6), {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(filed).toMatchObject({ status: 'refused', reason: 'evicted-own-part' });
    expect(filed.swept.length).toBeGreaterThan(0);
    expect(await kindsIn(inner)).toEqual([]);
  });

  it('a store without the budget member still files, as before', async () => {
    const inner = inMemoryArtifacts();
    const filed = await fileRecordingParts(withoutBudget(inner), SCOPE, recordingOf(3), {
      runId: 'r',
    });
    expect(filed.status).toBe('filed');
  });

  it('a store that keeps no digest still files; the reader verifies each part by its own hash', async () => {
    const inner = inMemoryArtifacts();
    const noDigest: ArtifactStore = {
      ...withoutBudget(inner),
      put: (scope, input) => {
        const { digest: _dropped, ...kept } = input;
        void _dropped;
        return inner.put(scope, kept);
      },
    };
    const filed = await fileRecordingParts(noDigest, SCOPE, recordingOf(4), {
      runId: 'r',
      targetBytes: 4096,
    });
    if (filed.status !== 'filed') throw new Error(filed.detail);
    expect(filed.parts.every((meta) => meta.digest === undefined)).toBe(true);
    const opened = (await openSavedRecording(
      bindArtifacts(inner, SCOPE),
      filed.index.ref,
    )) as SavedRecording;
    expect(await opened.readWhole()).toEqual({ status: 'ready', recording: recordingOf(4) });
    // A part whose bytes then change is still refused, by the reader's own hash.
    const part = filed.parts[1]!;
    const held = (await inner.get(SCOPE, part.ref))!.data as string;
    const changed = held.replace('"pad":"p', '"pad":"q');
    const view = {
      head: (ref: string) => inner.head(SCOPE, ref),
      get: async (ref: string) => {
        const record = await inner.get(SCOPE, ref);
        return record && ref === part.ref ? { ...record, data: changed } : record;
      },
    };
    const tampered = (await openSavedRecording(view, filed.index.ref)) as SavedRecording;
    expect((await tampered.readWhole()).status).toBe('unavailable');
  });

  it('the index never outlives a part: its expiry is the earliest part expiry', async () => {
    let now = 1_000_000;
    const inner = inMemoryArtifacts({ retention: { ttlMs: 60_000 }, _now: () => (now += 10) });
    const filed = await fileRecordingParts(inner, SCOPE, recordingOf(4), {
      runId: 'r',
      targetBytes: 4096,
    });
    if (filed.status !== 'filed') throw new Error(filed.detail);
    const earliest = Math.min(...filed.parts.map((meta) => meta.expiresAt!));
    expect(filed.index.expiresAt).toBe(earliest);
    expect(filed.index.expiresAt).toBeLessThan(now + 60_000);
  });

  it('W4 · a run with no subflows is an index and a base part, and opens', async () => {
    const inner = inMemoryArtifacts();
    const filed = await fileRecordingParts(inner, SCOPE, recordingOf(0), { runId: 'r' });
    if (filed.status !== 'filed') throw new Error(filed.detail);
    expect(filed.parts).toHaveLength(1);
    const opened = (await openSavedRecording(
      bindArtifacts(inner, SCOPE),
      filed.index.ref,
    )) as SavedRecording;
    expect(opened.invocations).toEqual([]);
    expect(opened.sizes.artifacts).toBe(2);
    expect((await opened.readRoot()).status).toBe('ready');
  });

  it('W5 · a recording past the bounds is refused and nothing is stored', async () => {
    const inner = inMemoryArtifacts();
    const view = watched(inner);
    const filed = await fileRecordingParts(view.store, SCOPE, recordingOf(4097), { runId: 'r' });
    expect(filed).toMatchObject({ status: 'refused', reason: 'not-split', removed: 0, left: 0 });
    expect(view.kinds).toEqual([]);
  });
});

/** The same store, without the optional `scopeBudget` member: a store that states no budget. */
function withoutBudget(store: ArtifactStore): ArtifactStore {
  return {
    put: store.put.bind(store),
    head: store.head.bind(store),
    get: store.get.bind(store),
    delete: store.delete.bind(store),
    list: store.list.bind(store),
  };
}

/** `count` mounts whose results each serialize to about `pad` bytes. */
function weighted(count: number, pad: number): Rec {
  const recording = recordingOf(count);
  const results = (recording.snapshot as Rec).subflowResults as Record<string, Rec>;
  for (const result of Object.values(results)) {
    ((result.treeContext as Rec).globalContext as Rec).pad = 'p'.repeat(pad);
  }
  return recording;
}

describe.each(['inMemoryArtifacts', ...(sqliteAvailable ? ['sqliteArtifacts'] : [])])(
  'a filing that cannot fit the stated budget leaves the scope as it was — %s',
  (name) => {
    function budgeted(retention: { maxBytesPerScope?: number; maxCountPerScope?: number }): {
      store: ArtifactStore;
      close(): void;
    } {
      if (name === 'inMemoryArtifacts')
        return { store: inMemoryArtifacts({ retention }), close: () => {} };
      const dir = mkdtempSync(join(tmpdir(), 'af-parts-budget-'));
      const store = sqliteArtifacts({ file: join(dir, 'a.sqlite'), retention });
      return {
        store,
        close: () => {
          store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    }

    const dataset = {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: 'd'.repeat(60_000),
    };

    it('bytes: six parts of under 20 KB, about 122 KB in all, against a 100 KB scope holding a 60 KB dataset', async () => {
      const { store, close } = budgeted({ maxBytesPerScope: 100_000 });
      try {
        await store.put(SCOPE, dataset);
        const view = watched(store);
        const recording = weighted(6, 19_000);
        const cut = await splitRecording(recording, { runId: 'r', targetBytes: 20_000 });
        // Every part fits the scope alone; together they do not.
        expect(cut.parts).toHaveLength(6);
        expect(cut.parts.every((part) => part.bytes < 20_000)).toBe(true);
        expect(cut.parts.reduce((sum, part) => sum + part.bytes, cut.base.bytes)).toBeGreaterThan(
          100_000,
        );
        const filed = await fileRecordingParts(view.store, SCOPE, recording, {
          runId: 'r',
          targetBytes: 20_000,
        });
        expect(filed).toEqual({
          status: 'refused',
          reason: 'would-not-fit',
          detail:
            "The run recording was not filed in parts (would-not-fit): its parts and index together are more than the store's budget for the scope. 0 written part(s) removed.",
          swept: [],
          removed: 0,
          left: 0,
        });
        expect(view.kinds).toEqual([]);
        expect(view.deletes).toEqual([]);
        expect(await kindsIn(store)).toEqual(['dataset/rows']);
        // The same recording, whole, is refused up front by the store too, and keeps the dataset.
        await expect(
          store.put(SCOPE, {
            kind: 'recording/run',
            mediaType: 'application/json',
            data: toWireJson(recording),
          }),
        ).rejects.toThrow();
        expect(await kindsIn(store)).toEqual(['dataset/rows']);
      } finally {
        close();
      }
    });

    it('count: a recording of more artifacts than the scope may hold is refused before any put', async () => {
      const { store, close } = budgeted({ maxCountPerScope: 3 });
      try {
        await store.put(SCOPE, dataset);
        const view = watched(store);
        const filed = await fileRecordingParts(view.store, SCOPE, weighted(2, 6000), {
          runId: 'r',
          targetBytes: 4096,
        });
        expect(filed).toMatchObject({ status: 'refused', reason: 'would-not-fit', swept: [] });
        expect(view.kinds).toEqual([]);
        expect(await kindsIn(store)).toEqual(['dataset/rows']);
      } finally {
        close();
      }
    });
  },
);

describe('the budget check at its boundary', () => {
  /** What a clean filing of `recording` really stores: bytes over every artifact, and their count. */
  async function measured(recording: Rec): Promise<{ bytes: number; count: number }> {
    const filed = await fileRecordingParts(inMemoryArtifacts(), SCOPE, recording, {
      runId: 'r',
      targetBytes: 4096,
    });
    if (filed.status !== 'filed') throw new Error(filed.detail);
    const all = [...filed.parts, filed.index];
    return { bytes: all.reduce((sum, meta) => sum + meta.bytes, 0), count: all.length };
  }

  it('an exact fit files with nothing swept; one byte less is refused before any put', async () => {
    const recording = recordingOf(6);
    const { bytes } = await measured(recording);
    const exact = await fileRecordingParts(
      inMemoryArtifacts({ retention: { maxBytesPerScope: bytes } }),
      SCOPE,
      recording,
      { runId: 'r', targetBytes: 4096 },
    );
    expect(exact).toMatchObject({ status: 'filed', swept: [] });
    const view = watched(inMemoryArtifacts({ retention: { maxBytesPerScope: bytes - 1 } }));
    const short = await fileRecordingParts(view.store, SCOPE, recording, {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(short).toMatchObject({ status: 'refused', reason: 'would-not-fit', swept: [] });
    expect(view.kinds).toEqual([]);
  });

  it('an exact count files; one artifact fewer is refused before any put', async () => {
    const recording = recordingOf(6);
    const { count } = await measured(recording);
    const exact = await fileRecordingParts(
      inMemoryArtifacts({ retention: { maxCountPerScope: count } }),
      SCOPE,
      recording,
      { runId: 'r', targetBytes: 4096 },
    );
    expect(exact).toMatchObject({ status: 'filed', swept: [] });
    const view = watched(inMemoryArtifacts({ retention: { maxCountPerScope: count - 1 } }));
    expect(
      await fileRecordingParts(view.store, SCOPE, recording, { runId: 'r', targetBytes: 4096 }),
    ).toMatchObject({ status: 'refused', reason: 'would-not-fit' });
    expect(view.kinds).toEqual([]);
  });

  it('a ticket with the right byte count but another digest stops the filing as store-mismatch', async () => {
    const inner = inMemoryArtifacts();
    const view = watched(inner, { digestMismatchAt: 2 });
    const filed = await fileRecordingParts(view.store, SCOPE, recordingOf(6), {
      runId: 'r',
      targetBytes: 4096,
    });
    expect(filed).toMatchObject({ status: 'refused', reason: 'store-mismatch', removed: 2 });
    expect(await kindsIn(inner)).toEqual([]);
  });
});

describe('a store that states no budget is named once, in dev mode', () => {
  it('warns once per store instance, and never for a store that states its budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    enableDevMode();
    try {
      const plain = withoutBudget(inMemoryArtifacts());
      await fileRecordingParts(plain, SCOPE, recordingOf(2), { runId: 'r' });
      await fileRecordingParts(plain, SCOPE, recordingOf(2), { runId: 'r' });
      expect(warn.mock.calls.filter((call) => call[0] === NO_BUDGET_WARNING)).toHaveLength(1);
      await fileRecordingParts(withoutBudget(inMemoryArtifacts()), SCOPE, recordingOf(2), {
        runId: 'r',
      });
      expect(warn.mock.calls.filter((call) => call[0] === NO_BUDGET_WARNING)).toHaveLength(2);
      await fileRecordingParts(inMemoryArtifacts(), SCOPE, recordingOf(2), { runId: 'r' });
      expect(warn.mock.calls.filter((call) => call[0] === NO_BUDGET_WARNING)).toHaveLength(2);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});
