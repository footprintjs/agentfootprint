/** Full runtime benchmark: authored tool proposals, real native dispatch and
 * evidence capture, then a supplied answer provider. No network or file writes
 * live here. Scripted selection/padding are disclosed, never counted as paid. */
import { fixtureTools, nearFixture, scheduledProvider } from './tools.mjs';

const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const errorOf = (error) => ({
  name: error.name,
  message: error.message,
  ...(error.code && { code: error.code }),
});
export const SYSTEM_PROMPT =
  'Answer the user from the tool results and their stated limits. ' +
  'Do not substitute another entity. Return JSON with summary and negatives. Each negative ' +
  'citation has kind (none, not-found, or complete), about (the requested entity), and restsOn ' +
  '(the result handles supplied by tools). Include a citation for a negative conclusion; ' +
  'if no handle is supplied, leave negatives empty. Other text belongs only in summary.';
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: ['string', 'number'] },
          restsOn: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', pattern: '^r[1-9][0-9]{0,3}$' },
          },
        },
        required: ['kind', 'about', 'restsOn'],
      },
    },
  },
  required: ['summary', 'negatives'],
};

function parseAnswer(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.negatives)
  )
    throw new Error('benchmark answer requires summary and negatives');
  if (Object.keys(value).some((key) => !['summary', 'negatives'].includes(key)))
    throw new Error('benchmark answer contains an extra field');
  for (const entry of value.negatives) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !['none', 'not-found', 'complete'].includes(entry.kind) ||
      !['string', 'number'].includes(typeof entry.about) ||
      !Array.isArray(entry.restsOn) ||
      entry.restsOn.length === 0 ||
      entry.restsOn.some(
        (handle) => typeof handle !== 'string' || !/^r[1-9][0-9]{0,3}$/.test(handle),
      ) ||
      Object.keys(entry).some((key) => !['kind', 'about', 'restsOn'].includes(key))
    )
      throw new Error('benchmark answer contains an invalid citation');
  }
  return value;
}

function candidateOf(content) {
  try {
    return { valid: true, value: copy(parseAnswer(JSON.parse(content))) };
  } catch (error) {
    return { valid: false, error: errorOf(error) };
  }
}

/** Doors are injected so tests use source while CLI runs the built package. */
export async function runCase({ doors, caseDef, arm, cell = 'main', provider, model, rep }) {
  if (!['off', 'observe', 'enforce', 'long', 'near-count', 'near-list'].includes(arm))
    throw new Error(`unknown benchmark arm: ${arm}`);
  const mode = arm === 'off' ? 'off' : ['enforce', 'long'].includes(arm) ? 'enforce' : 'observe';
  const { root, observe, memory } = doors;
  const identity = caseDef.identity ?? {
    tenant: 'benchmark-tenant',
    principal: 'benchmark-caller',
    conversationId: JSON.stringify([caseDef.id, cell, arm, model, rep]),
  };
  const calls = [],
    attempts = [],
    turns = [];
  const state = {
    turn: 1,
    step: 0,
    paid: 0,
    padded: false,
    permitted: [],
    corrected: false,
    schedule: [...(caseDef.schedule ?? [])],
  };
  const long = cell === 'long';
  if (long)
    state.padding =
      caseDef.longContext?.padding ?? 'Synthetic context padding. '.repeat(700).slice(0, 16_384);
  const paddingChars = state.padding?.length;
  const definitions = [...caseDef.tools];
  if (arm.startsWith('near-')) {
    definitions.push(nearFixture(caseDef.near, arm));
    state.schedule.push([{ name: 'bench_name_index', arguments: { asked: caseDef.near.asked } }]);
  }
  const store = new memory.InMemoryStore();
  const tools = fixtureTools(root, definitions, {
    attempts,
    activeTurn: () => state.turn,
    mayExecute(name) {
      const index = state.permitted.indexOf(name);
      if (index >= 0) {
        state.permitted.splice(index, 1);
        return true;
      }
      return (
        state.allowFresh === true &&
        (caseDef.longContext?.freshSchedule ?? []).flat().some((call) => call.name === name)
      );
    },
  });
  const builder = root.Agent.create({
    provider: scheduledProvider(provider, state, calls, mode, candidateOf),
    model,
    reactMode: 'dynamic',
    maxTokens: 384,
    temperature: 0,
    maxIterations:
      Math.max(state.schedule.length, caseDef.longContext?.schedule?.length ?? 0) + (long ? 4 : 3),
    recordSystemPrompt: true,
  })
    .system(SYSTEM_PROMPT)
    .outputSchema(
      { parse: parseAnswer },
      {
        jsonSchema: OUTPUT_SCHEMA,
        strategy: 'instruct',
        retries: 0,
      },
    )
    .memory(
      memory.defineMemory({
        id: 'benchmark-conversation',
        type: memory.MEMORY_TYPES.EPISODIC,
        strategy: { kind: memory.MEMORY_STRATEGIES.WINDOW, size: 16 },
        store,
      }),
    );
  for (const tool of tools) builder.tool(tool);
  if (mode === 'enforce')
    builder.negativeClaims({
      field: 'negatives',
      tools: definitions.map((tool) => tool.name),
      unestablished: 'withhold',
    });
  if (mode === 'observe') builder.negativeClaims({ prose: true });
  if (caseDef.clock !== undefined) builder.time({ zone: 'UTC' });
  const agent = builder.build();
  async function execute(message, followup) {
    const recorder = observe.recordRun(agent, { maxEvents: 100_000 });
    const delivered = { tokens: [], turnEnds: [] };
    const off = [
      agent.on('agentfootprint.stream.token', (e) => delivered.tokens.push(e.payload.content)),
      agent.on('agentfootprint.agent.turn_end', (e) => delivered.turnEnds.push(copy(e.payload))),
    ];
    const started = performance.now();
    let output = null,
      error = null;
    const options = {
      identity,
      ...(caseDef.clock !== undefined && { time: { now: caseDef.clock, zone: 'UTC' } }),
    };
    try {
      output = copy(
        await (followup ? agent.followUp(message, options) : agent.run({ message, ...options })),
      );
    } catch (caught) {
      error = errorOf(caught);
    } finally {
      recorder.stop();
      for (const unsubscribe of off) unsubscribe();
    }
    const recording = copy(recorder.toRecording());
    const shared = recording.snapshot?.sharedState ?? {};
    const nativeRecord =
      shared.negativeClaimState === undefined
        ? null
        : copy(
            doors.negative.negativeRecordOf({
              ...shared,
              $getValue: (key) => shared[key],
            }),
          );
    const checkpoint = copy(agent.checkpoint());
    turns.push({
      turn: state.turn,
      message,
      output,
      error,
      latencyMs: performance.now() - started,
      recording,
      droppedEvents: recorder.droppedEvents,
      nativeRecord,
      delivered,
      history: copy(checkpoint?.history ?? shared.history ?? []),
      checkpoint,
      memory: copy((await store.list(identity, { limit: 1000 })).entries),
      answerNegatives: copy(agent.answerNegatives()),
      answerValidation: copy(agent.answerValidation()),
      outputContractUnmet: copy(agent.outputContractUnmet()),
    });
  }
  await execute(long ? caseDef.longContext?.firstPrompt ?? caseDef.prompt : caseDef.prompt, false);
  if (long && turns[0].error === null) {
    Object.assign(state, {
      turn: 2,
      step: 0,
      paid: 0,
      padding: undefined,
      corrected: false,
      allowFresh: true,
      schedule: caseDef.longContext?.schedule ?? [],
    });
    await execute(
      caseDef.longContext?.followupPrompt ?? 'Is that still true now? Use the earlier reads.',
      true,
    );
  }
  return {
    caseId: caseDef.id,
    arm,
    cell,
    mode,
    model,
    rep,
    identity,
    calls,
    attempts,
    turns,
    disclosure: {
      toolSelection: 'fixture-scheduled native dispatch',
      ...(long && {
        firstAnswer: `scripted ${paddingChars}-character padding; only turn two uses the supplied provider`,
        paddingChars,
      }),
      ...(arm.startsWith('near-') && {
        near: 'additional independently authored synthetic source-index read; baseline result unchanged; complete only within that named index',
      }),
    },
  };
}
