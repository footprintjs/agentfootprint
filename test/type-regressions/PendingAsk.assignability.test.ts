/**
 * Compile-level regression test — 7.19 lets a hosted run stop and ask.
 *
 * Four things have to stay true at the TYPE level, and the first is a security
 * property that no runtime test can guarantee for all time, so the real
 * compiler pins it here (this file lives under ./tsconfig.json, run via
 * `npm run test:types`, while its name still matches `test/**\/*.test.ts` so
 * `npm test` runs the runtime assertions too):
 *
 *   1. **`PendingAsk` has no `checkpoint`.** The engine checkpoint holds the
 *      entire shared state of the run — the system prompt, the whole
 *      conversation, every tool result. It belongs in the store the operator
 *      chose, never in a reply to whoever posted the request. Enforced by
 *      ABSENCE: the `@ts-expect-error` below fails the build the day someone
 *      adds the field "just for convenience".
 *   2. **`CheckpointEnvelope` is discriminated on `format`.** A reader that
 *      switches on it is exhaustive by construction, so a third format breaks
 *      the switch at compile time rather than at 3am.
 *   3. `HostReply.awaiting` is OPTIONAL — a minimal adapter need not implement
 *      the third terminal, exactly as it need not implement `emit`.
 *   4. `HostRequest.decision` is `unknown`. The port never interprets a
 *      person's answer, so it must never narrow it to a shape one tool happens
 *      to use.
 */
import { describe, expect, it } from 'vitest';
import type {
  CheckpointEnvelope,
  ConversationEnvelope,
  DurabilityMode,
  HostReply,
  HostRequest,
  PausedRun,
  PausedRunEnvelope,
  PendingAsk,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import { UnreadableEnvelopeError } from '../../src/hosting/index.js';
import { checkInApproved } from '../../src/index.js';

describe('PendingAsk — the question travels, the state does not', () => {
  it('carries the ask and nothing that could reconstruct the run', () => {
    const ask: PendingAsk = {
      sessionId: 'c-1',
      tool: 'approve_refund',
      question: 'Approve $10?',
      pauseData: { question: 'Approve $10?' },
    };
    expect(ask.tool).toBe('approve_refund');

    // LAW 1. There is no field here that carries the run's state, and the
    // build fails the day one appears.
    // @ts-expect-error — PendingAsk must never carry the engine checkpoint.
    const leaky: PendingAsk = { ...ask, checkpoint: { sharedState: {} } };
    void leaky;

    // …nor the conversation, for the same reason.
    // @ts-expect-error — PendingAsk must never carry the conversation either.
    const alsoLeaky: PendingAsk = { ...ask, conversation: { version: 1 } };
    void alsoLeaky;
  });

  it('is what a PausedRun hands out, while the run itself keeps the state', () => {
    const run: PausedRun = {
      checkpoint: {
        sharedState: {},
        executionTree: {},
        pausedStageId: 'tool-calls',
        subflowPath: [],
        subflowStates: {},
        pausedAt: 0,
      },
      conversation: {
        version: 1,
        runId: 'r',
        history: [],
        lastCompletedIteration: 0,
        originalInput: { message: 'hi' },
        checkpointedAt: 0,
      },
      pending: { pauseData: undefined },
    };
    // The store gets all three; only `pending` is ever handed to a caller.
    expect(Object.keys(run).sort()).toEqual(['checkpoint', 'conversation', 'pending']);
  });
});

describe('CheckpointEnvelope — discriminated, so a reader cannot drift', () => {
  it('narrows on format alone', () => {
    const read = (envelope: CheckpointEnvelope): string => {
      switch (envelope.format) {
        case 'conversation-v1': {
          const conversation: ConversationEnvelope = envelope;
          return conversation.data.runId;
        }
        case 'flowchart-v1': {
          const paused: PausedRunEnvelope = envelope;
          return paused.data.checkpoint.pausedStageId;
        }
      }
    };
    expect(
      read({
        format: 'flowchart-v1',
        savedAt: 0,
        data: {
          checkpoint: {
            sharedState: {},
            executionTree: {},
            pausedStageId: 'tool-calls',
            subflowPath: [],
            subflowStates: {},
            pausedAt: 0,
          },
          conversation: {
            version: 1,
            runId: 'r',
            history: [],
            lastCompletedIteration: 0,
            originalInput: { message: 'hi' },
            checkpointedAt: 0,
          },
          pending: { pauseData: undefined },
        },
      }),
    ).toBe('tool-calls');

    // @ts-expect-error — a format this runtime does not know is not an envelope.
    const unknown: CheckpointEnvelope = { format: 'session-v4', data: {}, savedAt: 0 };
    void unknown;
  });
});

describe('the ports 7.19 widened', () => {
  it('awaiting is optional, so a minimal adapter still satisfies HostReply', () => {
    const minimal: HostReply = {
      complete: () => undefined,
      fail: () => undefined,
    };
    expect(minimal.awaiting).toBeUndefined();

    const full: HostReply = {
      complete: () => undefined,
      fail: () => undefined,
      emit: () => undefined,
      awaiting: (pending: PendingAsk) => void pending,
    };
    expect(typeof full.awaiting).toBe('function');
  });

  it('decision is unknown — the port never decides what an answer looks like', () => {
    const request: HostRequest = { input: '', decision: checkInApproved({ by: 'alice' }) };
    // Whatever a tool asked for is a valid answer, including a bare value.
    const terse: HostRequest = { input: '', decision: 'yes' };
    expect(request.decision).toBeDefined();
    expect(terse.decision).toBe('yes');

    // A consumer has to narrow it themselves, which is the point.
    // @ts-expect-error — `unknown` is not assignable to a concrete shape.
    const assumed: { approved: boolean } = request.decision;
    void assumed;
  });

  it('UnreadableEnvelopeError is branchable without matching prose', () => {
    const err = new UnreadableEnvelopeError('{format=conversation-v1, data={}}', 'c-1');
    // The code is a LITERAL type, so a consumer can switch on it and have the
    // compiler check the arms. Widening it to `string` would silently make
    // every such switch inexhaustive.
    const code: 'ERR_UNREADABLE_ENVELOPE' = err.code;
    expect(code).toBe('ERR_UNREADABLE_ENVELOPE');

    // The session is OPTIONAL: a reader can know the bytes are bad without
    // knowing whose they were, and pretending otherwise would push every
    // refuser into inventing an id.
    const named: string | undefined = err.sessionId;
    expect(named).toBe('c-1');
    // @ts-expect-error — it may be absent, so it is not a `string`.
    const assumed: string = err.sessionId;
    void assumed;

    // A TypeError by ancestry: an existing `catch (e) { if (e instanceof
    // TypeError) … }` keeps compiling and keeps matching.
    const asTypeError: TypeError = err;
    expect(asTypeError).toBeInstanceOf(TypeError);

    // `withSession` returns the same class, so a caller can keep reading the
    // code and the preview off it.
    const copy: UnreadableEnvelopeError = err.withSession('c-2');
    expect(copy.storedPreview).toBe(err.storedPreview);
  });

  it('durability is the three modes and nothing else', () => {
    const modes: DurabilityMode[] = ['exit', 'async', 'sync'];
    expect(modes).toHaveLength(3);
    // @ts-expect-error — a fourth cadence would need designing, not spelling.
    const invented: DurabilityMode = 'eventually';
    void invented;

    // And it is optional on the composer — leaving it out IS 'exit'.
    const options: Omit<StandingAgentOptions, 'agent' | 'sessions' | 'host'> = {};
    expect(options.durability).toBeUndefined();
  });
});
