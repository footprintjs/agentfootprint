import { deepStrictEqual, ok } from 'node:assert/strict';

function projectGraph({ nodes, edges }) {
  return {
    nodes: nodes.map(({ id, kind, label }) => ({ id, kind, ...(label !== undefined && { label }) })),
    edges: edges.map(({ from, to, kind, label }) => ({ from, to, kind, ...(label !== undefined && { label }) })),
  };
}

// Each build supplies its own SDK, just as for the Quick Start weather run.
export async function recordSkillGraphRuns({ Agent, defineTool, mock, routeRecorder }, graphs) {
  async function run(graph, input, expectedHops, toolResult) {
    const routes = routeRecorder();
    const answer = 'The request was routed.';
    const provider = toolResult === undefined
      ? mock({ reply: answer })
      : mock({ replies: [
          {
            content: 'Checking the case.',
            stopReason: 'tool_use',
            toolCalls: [{ id: 'inspect-1', name: 'inspect_request', args: {} }],
          },
          answer,
        ] });
    const builder = Agent.create({ provider, model: 'mock' }).skillGraph(graph).watch(routes);
    if (toolResult !== undefined) {
      builder.tool(defineTool({
        name: 'inspect_request',
        description: 'Return the support case classification.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => toolResult,
      }));
    }
    const agent = builder.build();
    const tools = [];
    const declaredMaps = [];
    agent.on('agentfootprint.stream.tool_end', ({ payload }) => {
      tools.push([payload.toolCallId, payload.result, payload.error === true]);
    });
    agent.on('agentfootprint.skill.graph_declared', ({ payload }) => {
      declaredMaps.push(projectGraph(payload));
    });
    deepStrictEqual(await agent.run({ message: input }), answer);
    deepStrictEqual(tools, toolResult === undefined ? [] : [['inspect-1', toolResult, false]]);
    const hops = routes.getHops().map(({ outcome, fromSkill, toSkill }) => ({
      outcome, from: fromSkill ?? null, to: toSkill ?? null,
    }));
    deepStrictEqual(hops, expectedHops, `Unexpected route for ${JSON.stringify(input)}`);
    deepStrictEqual(declaredMaps, [projectGraph(graph)]);
    ok(agent.getLastSnapshot()?.executionTree, 'The real skill run must keep its execution tree.');
    return { graph: declaredMaps[0], input, hops };
  }

  const entry = (to) => ({ outcome: 'entry', from: null, to });
  const fromTriage = (to) => [entry('triage'), { outcome: 'route', from: 'triage', to }];
  return {
    quickstart: [
      await run(graphs.quickstart, 'I want my money back', [entry('refunds')]),
      await run(graphs.quickstart, 'why is there a CHARGE on my card', [entry('billing')]),
      await run(graphs.quickstart, 'my charger broke', [entry('triage')]),
    ],
    support: [
      await run(graphs.support, 'Can you help with my order?', fromTriage('billing'), 'Refund request'),
      await run(graphs.support, 'Can you help with my account?', fromTriage('tech'), 'Login error'),
    ],
  };
}
