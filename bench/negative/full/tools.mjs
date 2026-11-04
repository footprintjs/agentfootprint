/** Synthetic tool/provider fixtures for the full-path benchmark. Tools execute
 * through the real dispatcher; the side log is an audit, never checker input. */
import { isDeepStrictEqual } from 'node:util';

const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const errorOf = (error) => ({ name: error.name, message: error.message });

export function fixtureTools(root, definitions, { attempts, activeTurn, mayExecute }) {
  return definitions.map((definition) => {
    const { name, description, inputSchema, search, effects, period, askOrAssume, responses } =
      definition;
    if (!Array.isArray(responses) || responses.length === 0)
      throw new Error(`fixture tool ${name} needs authored responses`);
    const schema = copy(inputSchema);
    if (Object.hasOwn(schema.properties ?? {}, 'benchTenant'))
      throw new Error(`fixture tool ${name} uses reserved benchTenant argument`);
    schema.properties = { ...schema.properties, benchTenant: { type: 'string' } };
    schema.required = [...(schema.required ?? []), 'benchTenant'];
    const declaration =
      search === undefined
        ? undefined
        : {
            ...copy(search),
            arguments: [...copy(search.arguments), { name: 'benchTenant', role: 'filter' }],
          };
    let count = 0;
    const tool = root.defineTool({
      name,
      description,
      inputSchema: schema,
      ...(effects === undefined ? {} : { effects }),
      ...(declaration === undefined ? {} : { search: declaration }),
      ...(period === undefined ? {} : { period: copy(period) }),
      ...(askOrAssume === undefined ? {} : { askOrAssume: copy(askOrAssume) }),
      execute(args, context) {
        const index = count++;
        const attempt = {
          tool: name,
          ordinal: index + 1,
          turn: activeTurn(),
          args: copy(args),
          ...(typeof context?.toolCallId === 'string' && { toolCallId: context.toolCallId }),
        };
        attempts.push(attempt);
        try {
          if (!mayExecute(name, args)) throw new Error(`unscheduled fixture execution for ${name}`);
          const response = responses[index];
          if (response === undefined) throw new Error(`fixture exhausted for ${name}`);
          if (
            response.when !== undefined &&
            Object.entries(response.when).some(
              ([key, value]) => !isDeepStrictEqual(args[key], value),
            )
          )
            throw new Error(`fixture arguments do not match authored response for ${name}`);
          const value = copy(response.value);
          let result;
          if (response.kind === 'throw') throw new Error(String(value));
          if (response.kind === 'absent') result = root.absent(value);
          else if (response.kind === 'described') result = root.describedResult(value);
          else if (response.kind === 'coverage')
            result = root.coverage(value.result, value.coverage);
          else if (response.kind === 'raw') result = value;
          else throw new Error(`unknown fixture response kind: ${response.kind}`);
          if (response.supplement !== undefined)
            result = { ...result, source_candidates: copy(response.supplement) };
          if (response.status !== undefined)
            result = { content: result, effects: [], status: response.status };
          attempt.result = copy(result);
          attempt.outcome = 'returned';
          return result;
        } catch (error) {
          attempt.outcome = 'threw';
          attempt.error = errorOf(error);
          throw error;
        }
      },
    });
    return root.hostFilled(tool, { benchTenant: root.fromIdentity('tenant') });
  });
}

/** This is a separate synthetic index read; it never changes the baseline result. */
export function nearFixture(near, arm) {
  if (
    !near ||
    !Array.isArray(near.names) ||
    near.names.length > 3 ||
    near.names.some((name) => typeof name !== 'string' || !isNear(near.asked, name))
  )
    throw new Error('near arm requires at most three authored candidate names');
  if (
    typeof near.source !== 'string' ||
    !near.source.trim() ||
    typeof near.measuredAt !== 'string' ||
    !near.measuredAt.trim() ||
    !Number.isSafeInteger(near.count) ||
    near.count < near.names.length ||
    near.completeWithinIndex !== true
  )
    throw new Error('near arm requires authored source, count, time, and complete-index facts');
  const source = near.source;
  return {
    name: 'bench_name_index',
    description:
      'Read the separately authored source name index. Suggestions never substitute an entity.',
    inputSchema: { type: 'object', properties: { asked: { type: 'string' } }, required: ['asked'] },
    effects: 'read',
    responses: [
      {
        kind: 'absent',
        when: { asked: near.asked },
        value: {
          what: 'the exact requested name',
          among: {
            argument: 'asked',
            source,
            measuredAt: near.measuredAt,
            count: near.count,
          },
        },
        ...(arm === 'near-list' && {
          supplement: {
            source,
            asked: near.asked,
            suggestions: near.names.map((name) => JSON.stringify(name)),
            note: 'Did you mean one of these? Suggestions only; do not substitute another entity.',
          },
        }),
      },
    ],
  };
}

function isNear(asked, name) {
  if (typeof asked !== 'string' || asked.length > 512 || name.length > 512) return false;
  const fold = (s) => [
    ...s
      .normalize('NFC')
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212]/g, '-'),
  ];
  const a = fold(asked),
    b = fold(name);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j] ? 1 : 0)));
    row = next;
  }
  return row[b.length] <= Math.max(2, Math.floor(Math.max(a.length, b.length) * 0.25));
}

const CAPABILITIES = [
  'promptCaching',
  'thinkingHandler',
  'thinkingMode',
  'carriesInMessages',
  'carriesForcedToolChoice',
  'supportsForcedToolChoice',
  'carriesNativeOutputSchema',
  'supportsNativeOutputSchema',
];

export function scheduledProvider(provider, state, calls, mode, candidateOf) {
  function scripted() {
    const batch = state.schedule[state.step++];
    if (batch !== undefined) {
      state.permitted.push(...batch.map((call) => call.name));
      return {
        content: '',
        toolCalls: batch.map((call, i) => ({
          id: call.id ?? `fixture-${state.turn}-${state.step}-${i + 1}`,
          name: call.name,
          args: copy(call.arguments ?? call.args ?? {}),
        })),
        usage: { input: 0, output: 0 },
        stopReason: 'tool_use',
      };
    }
    if (state.padding !== undefined && !state.padded) {
      state.padded = true;
      return {
        content: JSON.stringify({ summary: state.padding, negatives: [] }),
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      };
    }
    return undefined;
  }
  const wrapped = { name: provider.name };
  for (const key of CAPABILITIES) if (provider[key] !== undefined) wrapped[key] = provider[key];
  wrapped.stream = async function* (request, hooks) {
    if (state.failure !== undefined) throw state.failure;
    const script = scripted();
    const call = {
      index: calls.length + 1,
      turn: state.turn,
      source: script === undefined ? 'provider' : 'scripted',
      request: copy(request),
      chunks: [],
      startedAt: new Date().toISOString(),
    };
    calls.push(call);
    const started = performance.now();
    try {
      if (script === undefined) {
        const isCorrection =
          (request.tools?.length ?? 0) === 0 &&
          JSON.stringify(request).includes('internal citation correction');
        const afterRead = state.allowFresh && state.lastWasTool && state.paid === 1;
        if (
          state.paid >= 1 &&
          !afterRead &&
          !(mode === 'enforce' && !state.corrected && isCorrection)
        )
          throw new Error(
            'benchmark permits one answer and one genuine tools-off citation correction',
          );
        if (isCorrection) state.corrected = true;
        state.paid += 1;
      }
      const iterable =
        script !== undefined
          ? chunksOf(script)
          : provider.stream === undefined
          ? chunksOf(await provider.complete(request, hooks))
          : provider.stream(request, hooks);
      for await (const chunk of iterable) {
        call.chunks.push(copy(chunk));
        if (chunk.done && chunk.response === undefined)
          throw new Error('benchmark provider stream lacks a terminal response');
        if (chunk.done && chunk.response !== undefined) {
          call.response = copy(chunk.response);
          call.candidate = candidateOf(chunk.response.content);
          if (script === undefined) state.lastWasTool = (chunk.response.toolCalls?.length ?? 0) > 0;
        }
        yield chunk;
      }
      if (call.response === undefined)
        throw new Error('benchmark provider stream lacks a terminal response');
    } catch (error) {
      state.failure = error;
      call.error = errorOf(error);
      throw error;
    } finally {
      call.latencyMs = performance.now() - started;
    }
  };
  wrapped.complete = async (request, hooks) => {
    let response;
    for await (const chunk of wrapped.stream(request, hooks))
      if (chunk.response) response = chunk.response;
    return response;
  };
  return wrapped;
}

async function* chunksOf(response) {
  const pieces = response.content.match(/[\s\S]{1,64}/g) ?? [];
  for (const [tokenIndex, content] of pieces.entries()) yield { tokenIndex, content, done: false };
  yield { tokenIndex: pieces.length, content: '', done: true, response };
}
