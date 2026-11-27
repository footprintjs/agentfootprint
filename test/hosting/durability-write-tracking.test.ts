/**
 * Durability does not depend on the agent's `writeTracking` dial.
 *
 * `hosting/durability.ts` learns "this stage wrote `history`" from `onWrite`,
 * which fires in every mode, and acts at that stage's `onCommit`. The commit
 * event's `mutations` is the snapshot's write view, governed by the dial
 * (markers under `'summary'`, empty under `'off'`), so it cannot be the
 * trigger. Pinned: the same crash leaves the same conversation in the store
 * under every `writeTracking` × `durability`, the writes are the same writes,
 * and `'sync'` still gates the next tool under `'off'`.
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import type { WriteTrackingMode } from '../../src/index.js';
import { durableWriter } from '../../src/hosting/durability.js';
import { memorySessions, readEnvelope, standingAgent } from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  DurabilityMode,
  SessionLifecycle,
} from '../../src/hosting/index.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';
import { inProcessHost } from './testHost.js';

const MODES: readonly WriteTrackingMode[] = ['full', 'summary', 'off'];

function sessionsSeen(): SessionLifecycle & {
  writes: () => readonly CheckpointEnvelope[];
  stallAfter: (n: number) => void;
  release: () => void;
} {
  const inner = memorySessions();
  const seen: CheckpointEnvelope[] = [];
  const waiters: (() => void)[] = [];
  let passFirst = Number.POSITIVE_INFINITY;
  return {
    hydrate: (id) => inner.hydrate(id),
    async persist(id, envelope) {
      seen.push(structuredClone(envelope) as CheckpointEnvelope);
      if (seen.length > passFirst) await new Promise<void>((resolve) => waiters.push(resolve));
      await inner.persist(id, envelope);
    },
    writes: () => seen,
    stallAfter: (n) => void (passFirst = n),
    release: () => {
      passFirst = Number.POSITIVE_INFINITY;
      for (const w of waiters.splice(0)) w();
    },
  };
}

/** Two tool turns, then the vendor dies: the crash `durability.test.ts` uses. */
function diesOnThirdCall(): LLMProvider {
  let calls = 0;
  return {
    name: 'dies',
    complete(): Promise<LLMResponse> {
      calls++;
      if (calls >= 3) return Promise.reject(new Error('vendor went away'));
      return Promise.resolve({
        content: '',
        toolCalls: [{ id: `t${calls}`, name: 'act', args: { step: `step-${calls}` } }],
        usage: { input: 1, output: 1 },
      });
    },
  };
}

/** Two tool turns, then an answer. */
function twoToolTurns(): LLMProvider {
  let calls = 0;
  return {
    name: 'two',
    complete(): Promise<LLMResponse> {
      calls++;
      if (calls <= 2) {
        const step = calls === 1 ? 'one' : 'two';
        return Promise.resolve({
          content: '',
          toolCalls: [{ id: `t${calls}`, name: 'act', args: { step } }],
          usage: { input: 1, output: 1 },
        });
      }
      return Promise.resolve({
        content: 'both done',
        toolCalls: [],
        usage: { input: 1, output: 1 },
      });
    },
  };
}

function agentOf(provider: LLMProvider, ran: string[], writeTracking: WriteTrackingMode): Agent {
  const act = defineTool<{ step: string }, string>({
    name: 'act',
    description: 'do a thing with a side effect',
    inputSchema: { type: 'object', properties: { step: { type: 'string' } }, required: ['step'] },
    execute: ({ step }) => {
      ran.push(step);
      return Promise.resolve(`did ${step}`);
    },
  });
  return Agent.create({ provider, model: 'm', maxIterations: 5, writeTracking })
    .system('t')
    .tool(act)
    .build();
}

async function crash(writeTracking: WriteTrackingMode, durability: DurabilityMode) {
  const sessions = sessionsSeen();
  const host = inProcessHost();
  const handle = await standingAgent({
    agent: agentOf(diesOnThirdCall(), [], writeTracking),
    sessions,
    host,
    ...(durability !== 'exit' && { durability }),
  });
  try {
    const reply = await host.deliver({ input: 'long task', sessionId: 'c' });
    expect(reply.error).toContain('vendor went away');
  } finally {
    await handle.close(); // the "crash": everything but the store goes away
  }
  const stored = await sessions.hydrate('c');
  return {
    tools:
      stored === undefined
        ? undefined
        : readEnvelope(stored)
            .history.filter((m) => m.role === 'tool')
            .map((m) => m.content),
    // Each write's conversation, without what each run mints for itself (the
    // time it was taken, the per-run `callOccurrenceKey` hash).
    writes: sessions
      .writes()
      .map((envelope) =>
        JSON.stringify(readEnvelope(envelope).history, (key, value: unknown) =>
          key === 'callOccurrenceKey' ? undefined : value,
        ),
      ),
  };
}

describe('durability under every writeTracking mode', () => {
  for (const durability of ['sync', 'async'] as const) {
    it(`'${durability}': the same crash keeps everything through the last completed iteration, in every mode`, async () => {
      const runs = await Promise.all(MODES.map((mode) => crash(mode, durability)));
      for (const run of runs) expect(run.tools).toEqual(['did step-1', 'did step-2']);
      // The same writes, of the same conversations, in the same order.
      expect(runs[1]!.writes).toEqual(runs[0]!.writes);
      expect(runs[2]!.writes).toEqual(runs[0]!.writes);
      expect(runs[0]!.writes.length).toBeGreaterThan(1);
    });
  }

  it("'exit': the same crash loses the turn in every mode (nothing mid-run, as before)", async () => {
    for (const mode of MODES) expect((await crash(mode, 'exit')).tools).toBeUndefined();
  });

  it("'sync' under writeTracking 'off': iteration 2's tool does not run until iteration 1's write lands", async () => {
    const ran: string[] = [];
    const sessions = sessionsSeen();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: agentOf(twoToolTurns(), ran, 'off'),
      sessions,
      host,
      durability: 'sync',
    });
    try {
      sessions.stallAfter(1);
      const inFlight = host.deliver({ input: 'go', sessionId: 'gated' });
      for (let i = 0; i < 200 && !ran.includes('one'); i++)
        await new Promise((r) => setTimeout(r, 5));
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      expect(ran).toEqual(['one']);
      sessions.release();
      expect((await inFlight).output).toBe('both done');
      expect(ran).toEqual(['one', 'two']);
    } finally {
      sessions.release();
      await handle.close();
    }
  });
});

describe('the writer marks a stage from its writes', () => {
  const event = (runtimeStageId: string) => ({
    stageName: 's',
    stageId: 's',
    runtimeStageId,
    pipelineId: 'p',
    timestamp: 0,
  });
  function harness() {
    const written: unknown[] = [];
    const writer = durableWriter({
      mode: 'async',
      write: (_id, conversation) => {
        written.push(conversation);
        return Promise.resolve();
      },
    });
    const recorder = writer.capture({
      sessionId: 'c',
      runId: () => 'run-1',
      identity: () => undefined,
      state: () => ({
        history: [{ role: 'user', content: 'hi' }],
        userMessage: 'hi',
        iteration: 1,
      }),
    });
    return { writer, recorder, written };
  }

  it('a commit with no mutations still writes when its stage wrote history (writeTracking off)', async () => {
    const { writer, recorder, written } = harness();
    recorder.onWrite!({ ...event('tool-calls#2'), key: 'history', value: [], operation: 'set' });
    recorder.onCommit!({ ...event('tool-calls#2'), mutations: [] });
    await writer.settle();
    expect(written).toHaveLength(1);
  });

  it('a commit whose stage wrote other keys, or another stage’s commit, writes nothing', async () => {
    const { writer, recorder, written } = harness();
    recorder.onWrite!({ ...event('a#1'), key: 'iteration', value: 2, operation: 'set' });
    recorder.onCommit!({
      ...event('a#1'),
      mutations: [{ key: 'history', value: [], operation: 'set' }],
    });
    recorder.onWrite!({ ...event('b#2'), key: 'history', value: [], operation: 'set' });
    recorder.onCommit!({ ...event('c#3'), mutations: [] });
    await writer.settle();
    expect(written).toHaveLength(0);
  });

  it("a retried stage's discarded attempt does not count: only what the final attempt wrote", async () => {
    const { writer, recorder, written } = harness();
    recorder.onWrite!({ ...event('tool-calls#2'), key: 'history', value: [], operation: 'set' });
    recorder.onStageRetry!({
      stageName: 's',
      stageId: 's',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 0,
      message: 'failed',
      structuredError: { message: 'failed', name: 'Error' } as never,
      traversalContext: { runtimeStageId: 'tool-calls#2' } as never,
    });
    recorder.onCommit!({ ...event('tool-calls#2'), mutations: [] });
    await writer.settle();
    expect(written).toHaveLength(0);
  });
});
