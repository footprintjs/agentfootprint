/**
 * A reliability fail-fast ends the run the same way in every chart shape.
 *
 * `reactMode: 'dynamic-grouped'` runs the LLM call inside the `sf-llm-call`
 * subflow. Its fail-fast exit writes the `reliabilityFail*` record and breaks —
 * and until this was fixed the break stopped only the subflow and the record
 * stayed inside it: the outer loop went on to `Final` and the run RETURNED `''`
 * where `'classic'` and `'dynamic'` raise `ReliabilityFailFastError`.
 *
 * The rule pinned here is one outcome per exit, whatever the mode: the same
 * error class, kind, reason, payload and cause (masked under an output policy),
 * the same record on `sharedState`, one `reliability.fail_fast` event, and no
 * delivered answer.
 */
import { describe, expect, it } from 'vitest';
import { Agent, allow, type LLMProvider } from '../../src/index.js';
import { ReliabilityFailFastError, type ReliabilityConfig } from '../../src/reliability/index.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
type Mode = (typeof MODES)[number];

const DRAFT = 'not-json-draft';

/** A complete-only provider whose answer fails the output schema. */
function schemaFailing(): LLMProvider {
  return {
    name: 'schema-failing',
    complete: async () => ({
      content: DRAFT,
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    }),
  };
}

/** A provider whose every call fails upstream. */
function upstreamFailing(): LLMProvider {
  return {
    name: 'upstream-failing',
    complete: async () => {
      throw new Error('upstream 500');
    },
  };
}

/** A streaming provider that sends one token, then drops the stream. */
function midStreamFailing(): LLMProvider {
  return {
    name: 'mid-stream-failing',
    complete: async () => {
      throw new Error('complete() is not used when stream() exists');
    },
    async *stream() {
      yield { content: 'partial', tokenIndex: 0, done: false };
      throw new Error('stream dropped');
    },
  };
}

interface Exit {
  readonly provider: () => LLMProvider;
  readonly schema: boolean;
  readonly reliability: ReliabilityConfig;
}

const EXITS: Readonly<Record<string, Exit>> = {
  // A failure no rule claims → the loop's default fail-fast.
  'no rule (schema failure)': {
    provider: schemaFailing,
    schema: true,
    reliability: { postDecide: [{ when: () => false, then: 'retry', kind: 'never' }] },
  },
  'no rule (provider error)': {
    provider: upstreamFailing,
    schema: false,
    reliability: { postDecide: [{ when: () => false, then: 'retry', kind: 'never' }] },
  },
  'fail-fast rule': {
    provider: schemaFailing,
    schema: true,
    reliability: { postDecide: [{ when: () => true, then: 'fail-fast', kind: 'schema-stop' }] },
  },
  // A rule that wants a retry after the first token → escalated to fail-fast.
  'mid-stream': {
    provider: midStreamFailing,
    schema: false,
    reliability: {
      postDecide: [{ when: (s) => s.error !== undefined, then: 'retry', kind: 'retry-it' }],
    },
  },
  'pre-check': {
    provider: schemaFailing,
    schema: false,
    reliability: { preCheck: [{ when: () => true, then: 'fail-fast', kind: 'over-budget' }] },
  },
};

function agentFor(mode: Mode, exit: Exit, governed: boolean): Agent {
  let builder = Agent.create({ provider: exit.provider(), model: 'mock', reactMode: mode });
  if (exit.schema)
    builder = builder.outputSchema({ parse: (raw: unknown) => JSON.parse(String(raw)) });
  builder = builder.reliability(exit.reliability);
  if (governed) builder = builder.act({ output: [{ name: 'pass', onMessage: () => allow() }] });
  return builder.build();
}

/** Everything about how the run ended that must not depend on the chart shape. */
async function outcomeOf(mode: Mode, exit: Exit, governed: boolean) {
  const agent = agentFor(mode, exit, governed);
  let failFastEvents = 0;
  let turnEnds = 0;
  agent.on('agentfootprint.reliability.fail_fast', () => {
    failFastEvents += 1;
  });
  agent.on('agentfootprint.agent.turn_end', () => {
    turnEnds += 1;
  });
  const settled = await agent.run('hello').then(
    (value) => ({ returned: value as unknown }),
    (error: unknown) => ({ error }),
  );
  const state = (agent.getLastSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
  const error = 'error' in settled ? settled.error : undefined;
  const failure = error instanceof ReliabilityFailFastError ? error : undefined;
  const cause = failure?.cause as Error | undefined;
  return {
    ...('returned' in settled && { returned: settled.returned }),
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    kind: failure?.kind,
    reason: failure?.reason,
    message: failure?.message,
    payload: failure?.payload,
    cause: cause === undefined ? undefined : { name: cause.name, message: cause.message },
    record: {
      kind: state.reliabilityFailKind,
      reason: state.reliabilityFailReason,
      payload: state.reliabilityFailPayload,
      causeMessage: state.reliabilityFailCauseMessage,
      causeName: state.reliabilityFailCauseName,
    },
    failFastEvents,
    turnEnds,
  };
}

describe('a reliability fail-fast ends the run the same way in every reactMode', () => {
  for (const governed of [false, true]) {
    for (const [name, exit] of Object.entries(EXITS)) {
      it(`${name} (${governed ? 'output policy' : 'no output policy'})`, async () => {
        const classic = await outcomeOf('classic', exit, governed);
        expect(classic).not.toHaveProperty('returned');
        expect(classic.errorClass).toBe('ReliabilityFailFastError');
        expect(classic.record.kind).toBe(classic.kind);
        expect(classic.failFastEvents).toBe(1);
        expect(classic.turnEnds).toBe(0);
        // The rule: every other chart shape ends the run exactly as 'classic' does.
        for (const mode of MODES.filter((m) => m !== 'classic')) {
          expect(await outcomeOf(mode, exit, governed), mode).toEqual(classic);
        }
        // Under an output policy a schema failure's text never reaches the error.
        if (governed && exit.schema) {
          expect(classic.cause?.message).not.toContain(DRAFT.slice(0, 6));
          expect(classic.payload).not.toHaveProperty('errorMessage');
        }
      });
    }
  }
});
