/** Shared runner and policy canaries; neither arm gets a second citation checker. */
import { observation, scenarios, systemText, scriptedReply } from './fixture.mjs';
import { answerCheck } from './answerCheck.mjs';
import { MODEL } from './budget.mjs';
import { sha256, pinnedModule } from './identity.mjs';
export function modules(directory, arm) {
  const name = arm === 'baseline' ? 'af-baseline' : 'af-candidate';
  return { ...pinnedModule(directory, name), ...pinnedModule(directory, name, './providers') };
}
export async function canaries(api) {
  const call = (id, reference) => ({
    id,
    name: 'lookup',
    args: reference
      ? { _findings: { previous: [{ toolCallId: reference, standing: 'noise' }] } }
      : {},
  });
  const cases = [
    { name: 'valid', turns: [[call('one')], [call('two', 'one')]], executes: 2, refuses: 0 },
    { name: 'unserved', turns: [[call('one', 'ghost')]], executes: 0, refuses: 1 },
    {
      name: 'ambiguous',
      turns: [[call('same')], [call('same')], [call('three', 'same')]],
      executes: 2,
      refuses: 1,
    },
    { name: 'same-batch', turns: [[call('one'), call('two', 'one')]], executes: 1, refuses: 1 },
  ];
  const outcomes = [];
  for (const test of cases) {
    let at = 0,
      executes = 0;
    const agent = api.Agent.create({
      provider: api.mock({
        respond: () => (test.turns[at] ? { content: '', toolCalls: test.turns[at++] } : 'done'),
      }),
      model: 'mock',
      maxIterations: 5,
    })
      .tool(
        api.defineTool({
          name: 'lookup',
          description: 'Synthetic canary',
          inputSchema: { type: 'object', properties: {} },
          execute: () => {
            executes++;
            return 'synthetic';
          },
        }),
      )
      .findings()
      .build();
    await agent.run({ message: 'Run the synthetic canary.' });
    const refuses =
      agent
        .getLastSnapshot()
        .sharedState.findingsLedger?.filter((r) => r.kind === 'reference-refusal').length ?? 0;
    if (executes !== test.executes || refuses !== test.refuses)
      throw new Error('pilot Phase A canary failed');
    outcomes.push({ name: test.name, executes, refuses });
  }
  return outcomes;
}
function wireResponse(reply, step) {
  return {
    id: `msg_fixture_${step}`,
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [
      ...(reply.content ? [{ type: 'text', text: reply.content }] : []),
      ...(reply.toolCalls ?? []).map((c) => ({
        type: 'tool_use',
        id: c.id,
        name: c.name,
        input: c.args,
      })),
    ],
    stop_reason: reply.toolCalls?.length ? 'tool_use' : 'end_turn',
    // Rehearsal values are deliberately all uncached: never fake measured savings.
    usage: {
      input_tokens: 8000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
export async function runArm({ api, arm, scenarioId, budget, transport, partition }) {
  const scenario = scenarios.find((s) => s.id === scenarioId),
    frames = [];
  let pending,
    step = 0,
    reads = 0;
  const client = {
    messages: {
      create: async (body, options) => {
        const frame = {};
        const response = await budget.call(
          body,
          async (approved, bounded) => {
            frame.request = approved;
            frames.push(frame);
            return transport
              ? transport(approved, bounded)
              : wireResponse(scriptedReply(pending, scenario, ++step), step);
          },
          { arm, run: scenario.id, signal: options?.signal },
        );
        frame.response = {
          content: response.content,
          usage: response.usage,
          stop_reason: response.stop_reason,
        };
        return response;
      },
    },
  };
  const inner = api.anthropic({ _client: client, defaultModel: MODEL });
  const provider = {
    ...inner,
    stream: undefined,
    complete(request, hooks) {
      pending = request;
      return inner.complete(request, hooks);
    },
  };
  const agent = api.Agent.create({
    provider,
    model: MODEL,
    maxTokens: 1024,
    maxIterations: 4,
    temperature: 0,
    contextBudget: { systemPrompt: 40000 },
  })
    .system(systemText(partition))
    .tool(
      api.defineTool({
        name: 'lookup',
        description: 'Read a synthetic live relay observation.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string', enum: [scenario.key] } },
          required: ['key'],
          additionalProperties: false,
        },
        execute: ({ key }) => {
          if (key !== scenario.key) throw new Error('synthetic key refused');
          return observation(scenario, ++reads);
        },
      }),
    )
    .findings()
    .build();
  let output,
    ended = 'complete';
  try {
    output = await agent.run({ message: scenario.question });
  } catch {
    ended = 'stopped';
  }
  const rows = agent.getLastSnapshot()?.sharedState?.findingsLedger ?? [];
  const standing = rows.filter((r) => r.kind === 'standing');
  const answer = typeof output === 'string' ? output : undefined;
  let plantedFidelity = false;
  try {
    const value = JSON.parse(answer);
    plantedFidelity =
      value.answer === `${scenario.key} ${scenario.expected}` && reads === scenario.reads;
  } catch {
    /* A non-JSON answer is not promoted to a successful fixture; answerCheck names the form. */
  }
  return {
    arm,
    scenario: scenario.id,
    ended,
    calls: frames.length,
    reads,
    plantedFidelity,
    // Closed labels only (answerCheck.mjs): why a strict `false` failed, never the reply itself.
    answerCheck: answerCheck(answer, scenario, reads),
    referenceRefusals: rows.filter((r) => r.kind === 'reference-refusal').length,
    recordedIdentifiedStandingRows: standing.filter((r) => r.unknownId !== true).length,
    recordedUnknownStandingRows: standing.filter((r) => r.unknownId === true).length,
    extraTurns: Math.max(0, frames.length - (scenario.reads + 1)),
    // Bodies stay in memory for fidelity/stability checks, never in the report.
    requestHashes: frames.map((f) => sha256(JSON.stringify(f.request))),
    toolsStable: frames.every(
      (f) => JSON.stringify(f.request.tools) === JSON.stringify(frames[0]?.request.tools),
    ),
    systemStable: frames.every(
      (f) => JSON.stringify(f.request.system) === JSON.stringify(frames[0]?.request.system),
    ),
  };
}
