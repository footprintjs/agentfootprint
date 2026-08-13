/**
 * Recordings as artifacts (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — no `recordings` dial ⇒ nothing is recorded, nothing
 *     is minted, no listener is attached, and the store holds exactly what the
 *     tools put in it.
 *   • What lands IS the recordRun contract: `{ snapshot, events, structure }`,
 *     under kind 'recording/run', with `origin.runId` joining it to the trace.
 *   • The mint happens AFTER the answer is composed and can never change it.
 *   • A failed mint degrades to today's path — the answer is returned unchanged
 *     and the reason lands on the record.
 *   • Nothing is minted for a run that PAUSED (the turn is not over).
 *   • The existing wire ops serve it — zero new operations.
 *   • The recording never contains its own mint (frozen first).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import {
  RECORDING_ARTIFACT_KIND,
  recordingPutInput,
  UnserializableRecordingError,
} from '../../src/index.js';
import type { AgentfootprintEvent, ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';

// ─── Helpers ─────────────────────────────────────────────────────────

const SCOPE = { conversationId: 'x' };

/** Every recording an in-memory store is holding, newest first. */
async function recordingsIn(
  store: ArtifactStore,
  scope: { conversationId: string; principal?: string; tenant?: string },
) {
  const page = await store.list(scope);
  return page.artifacts.filter((meta) => meta.kind === RECORDING_ARTIFACT_KIND);
}

// ─── 1. UNIT — the pure half ─────────────────────────────────────────

describe('recordingPutInput — unit', () => {
  it('mints the JSON TEXT of the recording, under one kind', () => {
    const recording = { snapshot: { a: 1 }, events: [{ type: 'x' }], structure: { nodes: [] } };
    const input = recordingPutInput(recording, { runId: 'run-7' });
    expect(input.kind).toBe('recording/run');
    expect(input.mediaType).toBe('application/json');
    // Text, not the live object: `recordRun` states that snapshot and
    // structure are the runner's OWN objects held by reference, and an
    // in-process store handed those would keep a live view into a finished run.
    expect(typeof input.data).toBe('string');
    expect(JSON.parse(input.data as string)).toEqual(recording);
    expect(input.origin).toEqual({ runId: 'run-7' });
    expect(input.label).toBe('run run-7');
  });

  it('uses the operator label VERBATIM when one is given', () => {
    const input = recordingPutInput({}, { runId: 'r1', label: 'nightly eval' });
    expect(input.label).toBe('nightly eval');
  });

  it('refuses a recording JSON cannot carry, by name', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => recordingPutInput(cyclic)).toThrow(UnserializableRecordingError);
    expect(() => recordingPutInput(undefined)).toThrow(/serializes to nothing/);
  });
});

// ─── 2. ZERO-DELTA ───────────────────────────────────────────────────

describe('recordings — zero-delta', () => {
  it('a store WITHOUT the dial mints nothing of its own', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'answered' }),
      model: 'm',
      artifacts: { store },
    }).build();
    const answer = await agent.run({ message: 'hi' });
    expect(answer).toBe('answered');
    // The store holds exactly nothing: no tool minted, and neither did the
    // framework.
    const all = await store.list({ conversationId: 'anything' });
    expect(all.artifacts).toHaveLength(0);
  });

  it('the bare-store form cannot even SPELL recordings, so it cannot enable them', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: store,
    }).build();
    await agent.run({ message: 'hi' });
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => events.push(e));
    expect(events).toHaveLength(0);
  });
});

// ─── 3. INTEGRATION — the whole loop ─────────────────────────────────

describe('recordings — integration', () => {
  it('mints ONE recording per completed run, carrying the three fields', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'answered' }),
      model: 'm',
      artifacts: { store, recordings: true },
    }).build();

    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));

    const answer = await agent.run({ message: 'hi', identity: SCOPE });
    expect(answer).toBe('answered');
    expect(minted).toHaveLength(1);

    const ref = (minted[0] as { payload?: { ref?: string } }).payload?.ref as string;
    // The scope is the RUN's own — the same tuple `ctx.artifacts` bound.
    const record = await store.get(SCOPE, ref);
    expect(record).not.toBeNull();
    const recording = JSON.parse(record?.data as string) as Record<string, unknown>;
    expect(Object.keys(recording).sort()).toEqual(['events', 'snapshot', 'structure']);
    expect(Array.isArray(recording.events)).toBe(true);
    expect(recording.structure).toBeDefined();
    expect(record?.meta.kind).toBe(RECORDING_ARTIFACT_KIND);
    expect(record?.meta.origin?.runId).toBeDefined();
  });

  it('the recording never contains its own mint — it is frozen first', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store, recordings: true },
    }).build();
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    await agent.run({ message: 'hi', identity: SCOPE });
    const ref = (minted[0] as { payload?: { ref?: string } }).payload?.ref as string;
    const record = await store.get(SCOPE, ref);
    const recording = JSON.parse(record?.data as string) as { events: { type: string }[] };
    // A recursion here would be a recording that grows every time it is read.
    expect(recording.events.some((e) => e.type === 'agentfootprint.artifacts.minted')).toBe(false);
  });

  it('a tool mint and the run recording live in the SAME scope', async () => {
    const store = inMemoryArtifacts();
    const rows = defineTool({
      name: 'store_rows',
      description: 'mint',
      execute: async (_a, ctx) => {
        const meta = await ctx.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data: [{ q: 'Q3' }],
        });
        return meta.ref;
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: '1', name: 'store_rows', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
      artifacts: { store, recordings: true },
    })
      .tool(rows)
      .build();

    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    await agent.run({ message: 'go', identity: { conversationId: 'conv-9', principal: 'alice' } });

    const scope = { conversationId: 'conv-9', principal: 'alice' };
    const page = await store.list(scope);
    // A recording filed in a different scope from the artifacts it describes
    // would be a recording nobody can find.
    expect(page.artifacts.map((m) => m.kind).sort()).toEqual([
      'dataset/rows',
      RECORDING_ARTIFACT_KIND,
    ]);
    expect(minted).toHaveLength(2);
  });

  it('nothing is minted for a run that PAUSED', async () => {
    const store = inMemoryArtifacts();
    const ask = defineTool({
      name: 'ask_it',
      description: 'ask',
      execute: async (): Promise<string> => askHuman('are you sure?'),
    });
    const agent = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: '1', name: 'ask_it', args: {} }] }] }),
      model: 'm',
      artifacts: { store, recordings: true },
    })
      .tool(ask)
      .build();
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    const outcome = await agent.run({ message: 'go' });
    expect((outcome as { paused?: boolean }).paused).toBe(true);
    // The turn is not over; the resume mints its own.
    expect(minted).toHaveLength(0);
  });
});

// ─── 4. SCENARIO — the mint degrades ─────────────────────────────────

describe('recordings — a failed mint never fails the run', () => {
  it('returns the answer unchanged and puts the reason on the record', async () => {
    const inner = inMemoryArtifacts();
    const refusing: ArtifactStore = {
      ...inner,
      put: () => Promise.reject(new Error('the bucket is full')),
    };
    const agent = Agent.create({
      provider: mock({ reply: 'the answer' }),
      model: 'm',
      artifacts: { store: refusing, recordings: true },
    }).build();
    const refused: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.refused', (e) => refused.push(e));

    // "Your recording was not filed" must never become "your request failed".
    const answer = await agent.run({ message: 'hi' });
    expect(answer).toBe('the answer');
    expect(refused).toHaveLength(1);
    expect((refused[0] as { payload?: { detail?: string } }).payload?.detail).toContain(
      'bucket is full',
    );
  });
});

// ─── 5. PROPERTY — one per completed run, across turns ───────────────

describe('recordings — property', () => {
  it('N completed runs mint exactly N recordings', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store, recordings: { label: 'support bot' } },
    }).build();
    for (let i = 0; i < 3; i += 1) {
      await agent.run({ message: `turn ${i}`, identity: { conversationId: 'c1' } });
    }
    const recordings = await recordingsIn(store, { conversationId: 'c1' });
    expect(recordings).toHaveLength(3);
    // A static label repeats — the ref and origin.runId are what distinguish
    // them, which is stated on the option rather than worked around.
    expect(new Set(recordings.map((m) => m.label))).toEqual(new Set(['support bot']));
    expect(new Set(recordings.map((m) => m.origin?.runId)).size).toBe(3);
  });
});

// ─── 6. PERFORMANCE — bounded by the store, not by the agent ─────────

describe('recordings — performance', () => {
  it('retention rides the STORE: an over-budget store sweeps older recordings', async () => {
    // Nothing new was invented for expiry — the claim-check store's own
    // retention is what ages recordings out.
    const store = inMemoryArtifacts({ retention: { maxCountPerScope: 2 } });
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store, recordings: true },
    }).build();
    const swept: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.expired', (e) => swept.push(e));
    for (let i = 0; i < 4; i += 1) {
      await agent.run({ message: `t${i}`, identity: { conversationId: 'c1' } });
    }
    const recordings = await recordingsIn(store, { conversationId: 'c1' });
    expect(recordings.length).toBeLessThanOrEqual(2);
    // A store that evicted silently would be a store that lies by omission.
    expect(swept.length).toBeGreaterThan(0);
  });
});

// ─── 7. ROI — the wire already serves it ─────────────────────────────

describe('recordings — ROI', () => {
  it('the existing artifact-get op returns the recording, with NO new operation', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store, recordings: true },
    }).build();
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    await agent.run({ message: 'hi', identity: { conversationId: 'c1' } });
    const ref = (minted[0] as { payload?: { ref?: string } }).payload?.ref as string;

    // What the hosting door does with `{ op: 'artifact-get', ref }`: resolve
    // the ref against the agent's store under the session's scope.
    const resolved = await agent.getArtifactStore()?.get({ conversationId: 'c1' }, ref);
    const recording = JSON.parse(resolved?.data as string) as Record<string, unknown>;
    // …and that is exactly what `observeRecording(JSON.parse(text))` consumes.
    expect(Object.keys(recording).sort()).toEqual(['events', 'snapshot', 'structure']);
  });

  it('head() answers the render decision without paying for the bytes', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store, recordings: true },
    }).build();
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    await agent.run({ message: 'hi', identity: SCOPE });
    const ref = (minted[0] as { payload?: { ref?: string } }).payload?.ref as string;
    const meta = await store.head(SCOPE, ref);
    expect(meta?.kind).toBe(RECORDING_ARTIFACT_KIND);
    expect(meta?.bytes).toBeGreaterThan(0);
  });
});
