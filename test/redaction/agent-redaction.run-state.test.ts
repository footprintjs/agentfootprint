/**
 * A run's redaction is the RUN's — never state the agent instance holds.
 *
 * Every per-run fact of the redaction lives with the run it describes:
 *   - the policy a run is covered by is handed to ITS executor
 *     (`runRedaction.ts` · `applyTo`), and a snapshot is served under the
 *     policy of the executor it comes from (`policyOfExecutor`) — never the
 *     instance's latest;
 *   - the policy a paused run was covered by rides its OWN state into its
 *     checkpoint (`AgentState.runRedaction`, written by seed off the run that
 *     owns the scope), and a resumed leg reads it from there;
 *   - a resume's leg policy (the carried one, the caller's, the paused leg's
 *     marks) goes back from `emitPauseResume` to that leg's executor.
 *
 * Pinned here: interleaved runs on one instance, a run that throws or is
 * aborted, records read after a run ends, the one-run-at-a-time guard, and
 * the FAIL-CLOSED resume: a carried policy that cannot be read, or one that is
 * missing from a checkpoint whose run kept names out, refuses the resume with
 * `ResumeRedactionError` before anything moves.
 */
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  askHuman,
  defineTool,
  isPaused,
  PendingQuestionError,
  ResumeRedactionError,
  RunInFlightError,
} from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { VOCABULARY_VERSION } from '../../src/redaction/conversation.js';
import { coverageOfExecutor } from '../../src/redaction/runRedaction.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { carriedConversationPolicy, locationsOf } from './fixture.js';

// The conversation's names plus the tool's field: a value the person or the
// model writes travels under many names, and the vocabulary is the list. Names
// only, so the paused run's checkpoint carries all of it (a carried PATTERN is
// a reference the resuming side must hold — the block at the end).
const P: RedactionPolicy = carriedConversationPolicy();
const Q: RedactionPolicy = { keys: ['finalContent'] };

/** An agent whose first call asks a person about `ssn`, then answers. */
function asker(provider?: LLMProvider) {
  const ask = defineTool<{ ssn: string }, string>({
    name: 'confirm',
    description: 'ask a person to confirm',
    inputSchema: { type: 'object', properties: { ssn: { type: 'string' } }, required: ['ssn'] },
    execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?` }),
  });
  return Agent.create({ provider: provider ?? pausesThenAnswers('SSN-A-1111'), model: 'm' })
    .tool(ask)
    .build();
}

/** A provider that calls `confirm` with `ssn` once, then answers. */
function pausesThenAnswers(ssn: string): LLMProvider {
  let calls = 0;
  return {
    name: 'pauses-then-answers',
    complete: async (): Promise<LLMResponse> => {
      calls += 1;
      return calls === 1
        ? {
            content: '',
            toolCalls: [{ id: 'p1', name: 'confirm', args: { ssn } }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          }
        : {
            content: 'confirmed',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
    },
  };
}

/** Every record a resume leg leaves: its snapshot, its recording, its events. */
async function resumeRecords(
  agent: ReturnType<typeof asker>,
  checkpoint: Parameters<ReturnType<typeof asker>['resume']>[0],
) {
  const events: AgentfootprintEvent[] = [];
  const off = agent.on('*', (e) => events.push(e));
  const recorder = recordRun(agent);
  await agent.resume(checkpoint, { answer: 'yes' });
  off();
  return [agent.getLastSnapshot(), recorder.toRecording(), events];
}

describe('interleaved runs on one instance: each run keeps its own policy', () => {
  it('A pauses under P; B cannot run between its legs; A resumes covered by P — from its checkpoint', async () => {
    const agent = asker(pausesThenAnswers('SSN-A-1111'));
    const a = await agent.run({ message: 'check A' }, { redact: P });
    expect(isPaused(a)).toBe(true);
    if (!isPaused(a)) return;

    // B on the SAME instance while A waits: refused — a person's unanswered
    // question outranks a new message (the conversation law), so no run can
    // slip between A's legs on this instance at all.
    await expect(agent.run({ message: 'B: my ssn is SSN-B-2222' })).rejects.toBeInstanceOf(
      PendingQuestionError,
    );

    // A resumes: covered by P, read from A's checkpoint — no policy passed.
    for (const record of await resumeRecords(agent, a.checkpoint)) {
      expect(locationsOf(record, 'SSN-A-1111')).toEqual([]);
    }
    expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(true);
  });

  it('two instances interleave: B neither inherits P nor loses Q', async () => {
    // A on one instance pauses under P; B on another runs under Q, then with
    // none; A resumes on a THIRD (fresh) instance — the hosted shape.
    const a = await asker().run({ message: 'check A' }, { redact: P });
    if (!isPaused(a)) throw new Error('A must pause');

    const bAgent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'B answer SSN-B-2222' }),
      model: 'm',
    }).build();
    const bRecorder = recordRun(bAgent);
    await bAgent.run({ message: 'B ssn SSN-B-2222' }, { redact: Q });
    const bUnderQ = JSON.stringify(bAgent.getLastSnapshot());
    // Q kept its own name out…
    expect(bUnderQ).not.toContain('"finalContent":"B answer');
    // …and P's names were never B's: B's message is in B's record.
    expect(JSON.stringify(bRecorder.toRecording())).toContain('SSN-B-2222');
    await bAgent.run({ message: 'B again SSN-B-3333' });
    expect(servedUnderPolicy(bAgent.getLastSnapshot())).toBe(false);

    for (const record of await resumeRecords(asker(), a.checkpoint)) {
      expect(locationsOf(record, 'SSN-A-1111')).toEqual([]);
    }
  });
});

describe('a run that throws or is aborted leaves nothing for the next run', () => {
  const failing = (): LLMProvider => ({
    name: 'fails',
    complete: async (): Promise<LLMResponse> => {
      throw new Error('provider down');
    },
  });

  it('a throwing run under P: its snapshot is served under P; the next run is its own', async () => {
    let fail = true;
    const agent = Agent.create({
      provider: {
        name: 'flaky',
        complete: async (req): Promise<LLMResponse> => {
          if (fail) return failing().complete(req);
          return {
            content: 'ok',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      } as LLMProvider,
      model: 'm',
    }).build();
    await expect(agent.run({ message: 'my ssn SSN-T-4444' }, { redact: P })).rejects.toThrow();
    // Read AFTER the run ended: the policy of the run it describes.
    expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(true);
    expect(locationsOf(agent.getLastSnapshot(), 'SSN-T-4444')).toEqual([]);

    fail = false;
    await agent.run({ message: 'plain SSN-T-5555' });
    // The next run was handed nothing: it is not covered by P.
    expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(false);
    expect(JSON.stringify(agent.getLastSnapshot())).toContain('SSN-T-5555');
  });

  it('an aborted run under P: the same', async () => {
    const controller = new AbortController();
    const agent = Agent.create({
      provider: {
        name: 'hangs',
        complete: async (): Promise<LLMResponse> => {
          controller.abort();
          throw new Error('aborted');
        },
      } as LLMProvider,
      model: 'm',
    }).build();
    await expect(
      agent.run(
        { message: 'my ssn SSN-AB-6666' },
        { redact: P, env: { signal: controller.signal } },
      ),
    ).rejects.toThrow();
    expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(true);
    expect(locationsOf(agent.getLastSnapshot(), 'SSN-AB-6666')).toEqual([]);
  });

  it('records read after the run ends use the policy of the run they describe', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'done' }),
      model: 'm',
    }).build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'first SSN-R-7777' }, { redact: P });
    const firstRecording = recorder.toRecording();
    const firstSnapshot = agent.getLastSnapshot();
    expect(locationsOf(firstRecording, 'SSN-R-7777')).toEqual([]);
    expect(locationsOf(firstSnapshot, 'SSN-R-7777')).toEqual([]);
    // A later run handed nothing serves ITS snapshot raw — and never changes
    // what the first run's records were served under.
    await agent.run({ message: 'second SSN-R-8888' });
    expect(JSON.stringify(agent.getLastSnapshot())).toContain('SSN-R-8888');
    expect(locationsOf(firstRecording, 'SSN-R-7777')).toEqual([]);
  });
});

describe('a late fact is served under the policy of the run it belongs to', () => {
  it('a fact of run A dispatched after run B opened keeps A’s policy; B’s own facts keep B’s', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'done' }),
      model: 'm',
    }).build();
    const seen: AgentfootprintEvent[] = [];
    agent.on('*', (e) => seen.push(e));
    await agent.run({ message: 'A' }, { redact: P });
    const runA = seen.find((e) => e.type === 'agentfootprint.agent.turn_start')?.meta?.runId;
    expect(typeof runA).toBe('string');
    await agent.run({ message: 'B' }); // no policy
    const runB = seen.filter((e) => e.type === 'agentfootprint.agent.turn_start').at(-1)
      ?.meta?.runId;
    seen.length = 0;
    // A host files a fact for each run AFTER both finished (`emitAttributed`
    // stamps the run's id, as a turn's late artifact facts do).
    const fact = { args: { ssn: 'SSN-LATE-9999' } };
    agent.emitAttributed('agentfootprint.artifact.redeemed', fact, {
      sessionId: 's',
      runId: runA!,
    });
    agent.emitAttributed('agentfootprint.artifact.redeemed', fact, {
      sessionId: 's',
      runId: runB!,
    });
    expect(seen).toHaveLength(2);
    expect(locationsOf(seen[0], 'SSN-LATE-9999')).toEqual([]);
    expect(JSON.stringify(seen[1])).toContain('SSN-LATE-9999');
  });
});

describe('every leg is at least as covered as the one before it', () => {
  it('a policy added at the first resume still covers the third leg', async () => {
    // Pauses twice: run → resume #1 (handed Q here only) → resume #2 (handed nothing).
    let calls = 0;
    const provider: LLMProvider = {
      name: 'pauses-twice',
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls <= 2) {
          return {
            content: '',
            toolCalls: [{ id: `p${calls}`, name: 'confirm', args: { ssn: `SSN-LEG-${calls}` } }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: 'confirmed',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        };
      },
    };
    const agent = asker(provider);
    const first = await agent.run({ message: 'check' });
    if (!isPaused(first)) throw new Error('leg 1 must pause');
    const second = await agent.resume(first.checkpoint, { answer: 'yes' }, { redact: P });
    if (!isPaused(second)) throw new Error('leg 2 must pause');
    // Leg 2's checkpoint carries leg 2's whole policy, P included.
    expect(JSON.stringify(second.checkpoint.sharedState)).toContain('runRedaction');
    for (const record of await resumeRecords(asker(provider), second.checkpoint)) {
      expect(locationsOf(record, 'SSN-LEG-2')).toEqual([]);
    }
  });
});

describe('before any run opens its redaction, the declared policy serves', () => {
  it('a consumer emit on an agent that declares a policy, before its first run', () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'x' }),
      model: 'm',
      redact: { patterns: [/ssn/i] },
    }).build();
    const seen: AgentfootprintEvent[] = [];
    agent.on('*', (e) => seen.push(e));
    agent.emit('app.custom', { customer: { ssn: 'SSN-PRE-1212' } });
    expect(seen).toHaveLength(1);
    expect(locationsOf(seen, 'SSN-PRE-1212')).toEqual([]);
    // An agent that declares none emits as it always did.
    const plain = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).build();
    const raw: AgentfootprintEvent[] = [];
    plain.on('*', (e) => raw.push(e));
    plain.emit('app.custom', { customer: { ssn: 'SSN-PRE-1212' } });
    expect(JSON.stringify(raw)).toContain('SSN-PRE-1212');
  });
});

describe('one run at a time per instance — the guard', () => {
  it('a second run while one is in flight is refused (RunInFlightError)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = Agent.create({
      provider: {
        name: 'slow',
        complete: async (): Promise<LLMResponse> => {
          await gate;
          return {
            content: 'ok',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      } as LLMProvider,
      model: 'm',
    }).build();
    const first = agent.run({ message: 'one' }, { redact: P });
    await expect(agent.run({ message: 'two' })).rejects.toBeInstanceOf(RunInFlightError);
    release();
    await first;
  });
});

describe('a resume that cannot carry its redaction is refused — fail closed', () => {
  const paused = async () => {
    const outcome = await asker().run({ message: 'check' }, { redact: P });
    if (!isPaused(outcome)) throw new Error('must pause');
    return outcome.checkpoint;
  };

  it("'unreadable' — a carried policy this library did not write", async () => {
    const checkpoint = await paused();
    for (const bad of [{ keys: 'history' }, 'history', { patterns: [{ source: 1, flags: '' }] }]) {
      const tampered = {
        ...checkpoint,
        sharedState: { ...checkpoint.sharedState, runRedaction: bad },
      };
      const agent = asker();
      const events: AgentfootprintEvent[] = [];
      agent.on('*', (e) => events.push(e));
      const refusal = await agent.resume(tampered, { answer: 'yes' }).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(ResumeRedactionError);
      expect(refusal).toMatchObject({ reason: 'unreadable', code: 'ERR_RESUME_REDACTION' });
      // Nothing moved: no event, no run.
      expect(events).toEqual([]);
      expect(agent.getLastSnapshot()).toBeUndefined();
    }
  });

  it("'missing' — the run kept names out but the checkpoint carries no policy", async () => {
    const checkpoint = await paused();
    expect(checkpoint.redactionMarks?.keys.length).toBeGreaterThan(0);
    const { runRedaction: _dropped, ...rest } = checkpoint.sharedState as Record<string, unknown>;
    const stripped = { ...checkpoint, sharedState: rest };
    await expect(asker().resume(stripped, { answer: 'yes' })).rejects.toMatchObject({
      name: 'ResumeRedactionError',
      reason: 'missing',
    });
    // Every leg of a covered run writes its policy into its checkpoint, so a
    // checkpoint without one was altered — and a policy named at the resume
    // cannot stand in for the one the run was covered by (it may be narrower).
    for (const named of [P, { keys: ['unrelated'] }]) {
      const agent = asker();
      const events: AgentfootprintEvent[] = [];
      agent.on('*', (e) => events.push(e));
      const refusal = await agent
        .resume(stripped, { answer: 'yes' }, { redact: named })
        .catch((e: unknown) => e);
      expect(refusal).toMatchObject({ name: 'ResumeRedactionError', reason: 'missing' });
      expect(events).toEqual([]);
      expect(agent.getLastSnapshot()).toBeUndefined();
    }
  });
});

describe('a carried pattern is a reference the resuming side must hold — never compiled', () => {
  /** An agent like `asker`, with a declared policy when one is given. */
  const declaring = (redact?: RedactionPolicy) =>
    Agent.create({
      provider: pausesThenAnswers('SSN-PAT-5555'),
      model: 'm',
      ...(redact !== undefined && { redact }),
    })
      .tool(
        defineTool<{ ssn: string }, string>({
          name: 'confirm',
          description: 'ask a person to confirm',
          inputSchema: {
            type: 'object',
            properties: { ssn: { type: 'string' } },
            required: ['ssn'],
          },
          execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?` }),
        }),
      )
      .build();
  // The app's own field names, as a pattern — handed to ONE run.
  const PER_RUN: RedactionPolicy = conversationRedaction({ patterns: [/^ssn$/i] });

  const pausedUnder = async (redact: RedactionPolicy) => {
    const outcome = await declaring().run({ message: 'check' }, { redact });
    if (!isPaused(outcome)) throw new Error('must pause');
    return outcome.checkpoint;
  };

  it('a hostile pattern in a tampered checkpoint is refused before anything moves', async () => {
    const checkpoint = await pausedUnder(P);
    const state = checkpoint.sharedState as { runRedaction?: Record<string, unknown> };
    // A pattern built to hang a backtracking matcher, swapped in from storage.
    const tampered = {
      ...checkpoint,
      sharedState: {
        ...checkpoint.sharedState,
        runRedaction: { ...state.runRedaction, patterns: [{ source: '^(a+)+$', flags: '' }] },
      },
    };
    const agent = declaring();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    const refusal = await agent.resume(tampered, { answer: 'yes' }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ResumeRedactionError);
    expect(refusal).toMatchObject({ reason: 'unknown-pattern', code: 'ERR_RESUME_REDACTION' });
    expect((refusal as Error).message).not.toContain('a+');
    expect(events).toEqual([]);
    expect(agent.getLastSnapshot()).toBeUndefined();
  });

  it('the library’s own vocabulary is held everywhere: its patterns carry without being passed', async () => {
    const checkpoint = await pausedUnder(conversationRedaction());
    const agent = declaring();
    await agent.resume(checkpoint, { answer: 'yes' });
    expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(true);
    expect(locationsOf(agent.getLastSnapshot(), 'SSN-PAT-5555')).toEqual([]);
  });

  it('an app pattern handed to one run: the resume names it again, or is refused', async () => {
    const checkpoint = await pausedUnder(PER_RUN);
    await expect(declaring().resume(checkpoint, { answer: 'yes' })).rejects.toMatchObject({
      name: 'ResumeRedactionError',
      reason: 'unknown-pattern',
    });
    // Named again at the resume: the carried reference resolves to it.
    const agent = declaring();
    await agent.resume(checkpoint, { answer: 'yes' }, { redact: PER_RUN });
    expect(locationsOf(agent.getLastSnapshot(), 'SSN-PAT-5555')).toEqual([]);
  });

  it('an app pattern the agent DECLARES carries without being passed', async () => {
    const checkpoint = await pausedUnder(PER_RUN);
    const agent = declaring(PER_RUN);
    await agent.resume(checkpoint, { answer: 'yes' });
    expect(locationsOf(agent.getLastSnapshot(), 'SSN-PAT-5555')).toEqual([]);
  });
});

describe('a carried policy records the vocabulary version it was built under — fail closed across versions', () => {
  const pausedUnder = async (redact: RedactionPolicy) => {
    const outcome = await asker().run({ message: 'check' }, { redact });
    if (!isPaused(outcome)) throw new Error('must pause');
    return outcome.checkpoint;
  };
  /** The checkpoint with its carried policy narrowed to an "older list" (one of today's names dropped). */
  const narrowed = (
    checkpoint: Awaited<ReturnType<typeof pausedUnder>>,
    vocabulary: string | undefined,
  ) => {
    const state = checkpoint.sharedState as { runRedaction: Record<string, unknown> };
    const keys = (state.runRedaction['keys'] as string[]).filter((k) => k !== 'userPrompt');
    const { vocabulary: _v, ...rest } = state.runRedaction;
    void _v;
    return {
      ...checkpoint,
      sharedState: {
        ...checkpoint.sharedState,
        runRedaction: { ...rest, keys, ...(vocabulary !== undefined && { vocabulary }) },
      },
    };
  };
  /** The rationale of the resumed leg's route decisions — library text, content by default. */
  const resumedRationales = async (checkpoint: Awaited<ReturnType<typeof pausedUnder>>) => {
    const agent = asker();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.resume(checkpoint, { answer: 'yes' });
    const executor = (agent as unknown as { lastExecutor: object }).lastExecutor;
    const rationales = events
      .filter((e) => e.type === 'agentfootprint.agent.route_decided')
      .map((e) => (e.payload as { rationale?: unknown }).rationale);
    return { rationales, coverage: coverageOfExecutor(executor) };
  };

  it('a run under the vocabulary carries the CURRENT version; one under a narrower policy carries none', async () => {
    const covered = await pausedUnder(P);
    const carried = (covered.sharedState as { runRedaction: { vocabulary?: string } }).runRedaction;
    expect(carried.vocabulary).toBe(VOCABULARY_VERSION);
    const narrow = await pausedUnder({ keys: ['ssn'] });
    const carriedNarrow = (narrow.sharedState as { runRedaction: { vocabulary?: string } })
      .runRedaction;
    expect(carriedNarrow.vocabulary).toBeUndefined();
  });

  it('a leg whose record names an OLDER version is covered by the current vocabulary — default-deny stays on', async () => {
    const forged = narrowed(await pausedUnder(P), 'v1-00000000');
    const { rationales, coverage } = await resumedRationales(forged);
    expect(rationales.length).toBeGreaterThan(0);
    for (const rationale of rationales) expect(rationale).toBe('[REDACTED]');
    // The name the older list lacked covers the leg again.
    expect(coverage.state).toBe('covered');
    if (coverage.state === 'covered') expect(coverage.policy.keys).toContain('userPrompt');
  });

  it('control: the same older list stamped with the CURRENT version resumes as carried — the version is what decides', async () => {
    const forged = narrowed(await pausedUnder(P), VOCABULARY_VERSION);
    const { rationales, coverage } = await resumedRationales(forged);
    // The list resumes as it was carried: without the dropped name. Its events
    // are still served by the value-kind rule — under ANY policy.
    expect(coverage.state).toBe('covered');
    if (coverage.state === 'covered') expect(coverage.policy.keys).not.toContain('userPrompt');
    for (const rationale of rationales) expect(rationale).toBe('[REDACTED]');
  });

  it('a version that is not text is refused as unreadable', async () => {
    const checkpoint = await pausedUnder(P);
    const state = checkpoint.sharedState as { runRedaction: Record<string, unknown> };
    const tampered = {
      ...checkpoint,
      sharedState: {
        ...checkpoint.sharedState,
        runRedaction: { ...state.runRedaction, vocabulary: 7 },
      },
    };
    await expect(asker().resume(tampered, { answer: 'yes' })).rejects.toMatchObject({
      name: 'ResumeRedactionError',
      reason: 'unreadable',
    });
  });
});
