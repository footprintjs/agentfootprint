import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../src/core/pause.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';
import { sourceEvidenceLimits } from '../../src/artifacts/sourceEvidence/guards.js';
import type { SourceEvidenceCandidate } from '../../src/artifacts/sourceEvidence/types.js';
import {
  buildCheckpoint,
  RunCheckpointError,
  validateCheckpoint,
} from '../../src/core/runCheckpoint.js';
const { applyContinuation, checkpointFor } = Agent.prototype as unknown as {
  applyContinuation: (...args: unknown[]) => void;
  checkpointFor: (...args: unknown[]) => ReturnType<Agent['checkpoint']>;
};

const ref = (n: number) => `art_${String(n).padStart(22, '0')}`;
const index = () => ({ version: 1 as const, refs: [ref(2), ref(1)], omitted: 3 });
const tracker = () => ({
  runId: 'old-run',
  history: [{ role: 'user' as const, content: 'old question' }],
  originalInput: { message: 'old question' },
  lastCompletedIteration: 1,
});
const configured = (maxReceipts = 32) => ({
  admit: (candidate: SourceEvidenceCandidate) => candidate,
  limits: sourceEvidenceLimits({ maxReceipts }),
});
const options = (provider = mock({ reply: 'done' }), maxReceipts = 32) => ({
  provider,
  model: 'mock',
  artifacts: inMemoryArtifacts(),
  sourceEvidence: configured(maxReceipts),
});

describe('source evidence checkpoint carrier', () => {
  it('keeps legacy checkpoint shape and return identity when the feature is absent', () => {
    const legacy = buildCheckpoint(tracker());
    expect(legacy).not.toHaveProperty('sourceEvidence');
    expect(validateCheckpoint(legacy)).toBe(legacy);
  });

  it('keeps ordinary unmounted agents and their native pause carriers unchanged', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' }).build();
    const pausedAgent = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 'hold', name: 'hold', args: {} }] }] }),
      model: 'mock',
    })
      .tool({
        schema: { name: 'hold', description: 'Pause', inputSchema: { type: 'object' } },
        execute: () => pauseHere({ question: 'continue?' }),
      })
      .build();
    try {
      await agent.run('ordinary');
      expect(agent.checkpoint()).not.toHaveProperty('sourceEvidence');
      const paused = await pausedAgent.run('pause');
      if (!isPaused(paused)) throw new Error('fixture did not pause');
      expect(paused.checkpoint.sharedState).not.toHaveProperty('sourceEvidence');
    } finally {
      await agent.shutdown();
      await pausedAgent.shutdown();
    }
  });

  it.each([
    ['unknown version', { ...index(), version: 2 }],
    ['invalid ref', { ...index(), refs: ['not-an-artifact'] }],
    ['duplicate ref', { ...index(), refs: [ref(1), ref(1)] }],
    ['oversized index', { ...index(), refs: Array.from({ length: 129 }, (_, i) => ref(i)) }],
    ['negative omissions', { ...index(), omitted: -1 }],
    ['unsafe omissions', { ...index(), omitted: Number.MAX_SAFE_INTEGER + 1 }],
    ['copied subject', { ...index(), subject: 'private-array' }],
    ['copied source values', { ...index(), scalars: { applications: 'private-app' } }],
  ])('refuses %s before continuation', (_name, sourceEvidence) => {
    expect(() => validateCheckpoint({ ...buildCheckpoint(tracker()), sourceEvidence })).toThrow(
      /source evidence/i,
    );
  });

  it('detaches an admitted index without copying application identities or values', () => {
    const sourceEvidence = index();
    const original = { ...buildCheckpoint(tracker()), sourceEvidence };
    const accepted = validateCheckpoint(original);
    expect(accepted.sourceEvidence).toEqual(sourceEvidence);
    expect(accepted.sourceEvidence).not.toBe(sourceEvidence);
    sourceEvidence.refs.push(ref(3));
    expect(accepted.sourceEvidence?.refs).toEqual([ref(2), ref(1)]);
    expect(Object.keys(accepted.sourceEvidence!)).toEqual(['version', 'refs', 'omitted']);
  });

  it('never invokes a checkpoint carrier getter', () => {
    const get = vi.fn(() => index());
    const original = Object.defineProperty(buildCheckpoint(tracker()), 'sourceEvidence', {
      enumerable: true,
      get,
    });
    expect(() => validateCheckpoint(original)).toThrow(/source evidence/i);
    expect(get).not.toHaveBeenCalled();
  });

  it('uses the same detached carrier for ordinary and crash checkpoint writers', () => {
    const sourceEvidence = index();
    const state = {
      history: tracker().history,
      iteration: 1,
      userMessage: 'old question',
      sourceEvidence,
      ignoredPrivateSource: { array: 'private-array', applications: ['private-app'] },
    };
    const context = {
      sourceEvidenceConfig: configured(),
      foldedSpansOf: () => undefined,
      evidenceRecoveryOf: () => undefined,
      findingsLedgerOf: () => undefined,
      continuityCursorOf: () => undefined,
      conversationOwner: () => ({}),
      lastInputRefused: () => false,
      turnNumberOf: () => undefined,
    };
    const selected = {
      view: { snapshot: () => ({ sharedState: state }) },
      value: {},
      context: { runId: 'old-run' },
    };
    const ordinary = checkpointFor.call(context as never, selected as never);
    const crash = buildCheckpoint(
      tracker(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      sourceEvidence,
    );
    expect(ordinary?.sourceEvidence).toEqual(sourceEvidence);
    expect(crash.sourceEvidence).toEqual(sourceEvidence);
    sourceEvidence.refs.push(ref(3));
    expect(ordinary?.sourceEvidence?.refs).toEqual([ref(2), ref(1)]);
    expect(crash.sourceEvidence?.refs).toEqual([ref(2), ref(1)]);
    expect(JSON.stringify([ordinary, crash])).not.toMatch(/private-array|private-app/);
  });

  it('refuses carrier loss on an unmounted continuation and detaches its pending handoff', () => {
    const cp = { ...buildCheckpoint(tracker()), sourceEvidence: index() };
    expect(() => applyContinuation.call({} as never, {} as never, cp, 'test', true)).toThrow(
      /source evidence/i,
    );
    const values: Record<string, unknown> = {};
    applyContinuation.call(
      { sourceEvidenceConfig: configured() } as never,
      values as never,
      cp,
      'test',
      true,
    );
    expect(values.pendingResumeSourceEvidence).toEqual(cp.sourceEvidence);
    expect(values.pendingResumeSourceEvidence).not.toBe(cp.sourceEvidence);
  });

  it('seeds once per owned run, keeps newest refs under a tighter cap and leaves fresh runs empty', async () => {
    const agent = Agent.create(options(undefined, 1)).build();
    try {
      await agent.run('first');
      expect(agent.checkpoint()?.sourceEvidence).toEqual({ version: 1, refs: [], omitted: 0 });
      const prior = { ...agent.checkpoint()!, sourceEvidence: index() };
      await agent.run({ message: 'continue', continueFrom: prior });
      expect(agent.checkpoint()?.sourceEvidence).toEqual({
        version: 1,
        refs: [ref(2)],
        omitted: 4,
      });
      await agent.run('fresh');
      expect(agent.checkpoint()?.sourceEvidence).toEqual({ version: 1, refs: [], omitted: 0 });
    } finally {
      await agent.shutdown();
    }
  });

  it('refuses omission-counter overflow and clears a continuation that failed before seeding', async () => {
    const agent = Agent.create(options(undefined, 1)).build();
    try {
      const prior = {
        ...buildCheckpoint(tracker()),
        sourceEvidence: { ...index(), omitted: Number.MAX_SAFE_INTEGER },
      };
      await expect(agent.run({ message: 'overflow', continueFrom: prior })).rejects.toThrow(
        /source evidence.*overflow/i,
      );
      await agent.run('fresh after refusal');
      expect(agent.checkpoint()?.sourceEvidence).toEqual({ version: 1, refs: [], omitted: 0 });
    } finally {
      await agent.shutdown();
    }
  });

  it('retains the index in a real recoverable crash and resumeOnError', async () => {
    const provider = mock({
      replies: [{ toolCalls: [{ id: 'one', name: 'read_fixture', args: {} }] }, 'done'],
    });
    const complete = provider.complete.bind(provider);
    let fail = false;
    const agent = Agent.create(
      options({
        ...provider,
        complete: async (...args: Parameters<typeof complete>) => {
          if (fail) throw new Error('temporary provider outage');
          fail = true;
          return complete(...args);
        },
      }),
    )
      .tool({
        schema: {
          name: 'read_fixture',
          description: 'Read fixture',
          inputSchema: { type: 'object' },
        },
        execute: async () => ({ count: 1 }),
      })
      .build();
    try {
      const prior = { ...buildCheckpoint(tracker()), sourceEvidence: index() };
      const failure = await agent
        .run({ message: 'continue', continueFrom: prior })
        .catch((error) => error);
      expect(failure).toBeInstanceOf(RunCheckpointError);
      expect(failure.checkpoint.sourceEvidence).toEqual(index());
      fail = false;
      await agent.resumeOnError(failure.checkpoint);
      expect(agent.checkpoint()?.sourceEvidence).toEqual(index());
    } finally {
      await agent.shutdown();
    }
  });

  it('carries an empty index through a native pause and refuses missing, malformed or unmounted restoration', async () => {
    const provider = mock({
      replies: [{ toolCalls: [{ id: 'hold', name: 'hold', args: {} }] }, 'done'],
    });
    const agent = Agent.create(options(provider))
      .tool({
        schema: { name: 'hold', description: 'Pause', inputSchema: { type: 'object' } },
        execute: () => pauseHere({ question: 'continue?' }),
      })
      .build();
    try {
      const paused = await agent.run('pause');
      if (!isPaused(paused)) throw new Error('fixture did not pause');
      expect(paused.checkpoint.sharedState.sourceEvidence).toEqual({
        version: 1,
        refs: [],
        omitted: 0,
      });
      const missing = structuredClone(paused.checkpoint);
      delete missing.sharedState.sourceEvidence;
      await expect(agent.resume(missing, 'yes')).rejects.toThrow(/source evidence/i);
      const malformed = structuredClone(paused.checkpoint);
      malformed.sharedState.sourceEvidence = { ...index(), omitted: -1 };
      await expect(agent.resume(malformed, 'yes')).rejects.toThrow(/source evidence/i);
      const tightened = Agent.create(options(undefined, 1)).build();
      try {
        const older = structuredClone(paused.checkpoint);
        older.sharedState.sourceEvidence = index();
        await expect(tightened.resume(older, 'yes')).rejects.toThrow(/source evidence/i);
        expect(older.sharedState.sourceEvidence).toEqual(index());
      } finally {
        await tightened.shutdown();
      }
      const unarmed = Agent.create({
        provider: mock({ reply: 'unexpected' }),
        model: 'mock',
      }).build();
      try {
        await expect(unarmed.resume(paused.checkpoint, 'yes')).rejects.toThrow(/source evidence/i);
      } finally {
        await unarmed.shutdown();
      }
      await agent.resume(paused.checkpoint, 'yes');
      expect(agent.checkpoint()?.sourceEvidence).toEqual({ version: 1, refs: [], omitted: 0 });
    } finally {
      await agent.shutdown();
    }
  });
});
