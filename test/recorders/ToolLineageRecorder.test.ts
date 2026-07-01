/**
 * ToolLineageRecorder — derives the tool→tool data-flow graph by value provenance.
 *
 * Unit tests feed synthetic emit events (full control over iterations/values).
 * The functional test runs a real agent where one tool's argument comes from a
 * prior tool's result, and asserts the edge is recovered end-to-end.
 */

import { describe, it, expect } from 'vitest';
import type { EmitEvent, LLMProvider } from 'footprintjs';
import { Agent, defineTool } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import { toolLineageRecorder } from '../../src/observe.js';

const ITER = 'agentfootprint.agent.iteration_start';
const START = 'agentfootprint.stream.tool_start';
const END = 'agentfootprint.stream.tool_end';

function ev(
  name: string,
  payload: unknown,
  runtimeStageId = 'stage#0',
  pipelineId = 'run-1',
): EmitEvent {
  return {
    name,
    payload,
    stageName: 'tool-calls',
    runtimeStageId,
    subflowPath: [],
    pipelineId,
    timestamp: 0,
  };
}

describe('toolLineageRecorder — unit (synthetic emits)', () => {
  it('links a later tool arg to the earlier tool result that produced the value', () => {
    const rec = toolLineageRecorder();
    rec.onEmit!(ev(ITER, { iterIndex: 1 }));
    rec.onEmit!(
      ev(START, {
        toolName: 'get_flogi_database',
        toolCallId: 'a',
        args: { hostname: 'lva1-mds01' },
      }),
    );
    rec.onEmit!(
      ev(END, { toolCallId: 'a', result: { fcid: '0x650300', wwpn: '21:00:00:24:ff:4a:12:03' } }),
    );
    rec.onEmit!(ev(ITER, { iterIndex: 2 }));
    rec.onEmit!(
      ev(START, {
        toolName: 'get_io_profile',
        toolCallId: 'b',
        args: { initiator_id: '0x650300' },
      }),
    );
    rec.onEmit!(ev(END, { toolCallId: 'b', result: 'profile…' }));

    const g = rec.getLineage();
    expect(g.nodes.map((n) => n.toolName)).toEqual(['get_flogi_database', 'get_io_profile']);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({
      from: { toolName: 'get_flogi_database' },
      to: { toolName: 'get_io_profile' },
      value: '0x650300',
    });
  });

  it('does NOT link tools in the SAME iteration (parallel calls share prior context)', () => {
    const rec = toolLineageRecorder();
    rec.onEmit!(ev(ITER, { iterIndex: 1 }));
    // two parallel tools in iter 1; B's args contain a value A also returns
    rec.onEmit!(ev(START, { toolName: 'A', toolCallId: 'a', args: {} }));
    rec.onEmit!(ev(END, { toolCallId: 'a', result: { id: 'SHARED-VALUE-123' } }));
    rec.onEmit!(ev(START, { toolName: 'B', toolCallId: 'b', args: { ref: 'SHARED-VALUE-123' } }));
    rec.onEmit!(ev(END, { toolCallId: 'b', result: 'ok' }));

    expect(rec.getLineage().edges).toHaveLength(0);
  });

  it('ignores short / non-distinctive values', () => {
    const rec = toolLineageRecorder({ minValueLength: 4 });
    rec.onEmit!(ev(ITER, { iterIndex: 1 }));
    rec.onEmit!(ev(START, { toolName: 'A', toolCallId: 'a', args: {} }));
    rec.onEmit!(ev(END, { toolCallId: 'a', result: { state: 'up' } })); // 2 chars
    rec.onEmit!(ev(ITER, { iterIndex: 2 }));
    rec.onEmit!(ev(START, { toolName: 'B', toolCallId: 'b', args: { want: 'up' } }));

    expect(rec.getLineage().edges).toHaveLength(0);
  });

  it('ignores numbers by default but links them when matchNumbers is on', () => {
    const make = (matchNumbers: boolean) => {
      const rec = toolLineageRecorder({ matchNumbers });
      rec.onEmit!(ev(ITER, { iterIndex: 1 }));
      rec.onEmit!(ev(START, { toolName: 'A', toolCallId: 'a', args: {} }));
      rec.onEmit!(ev(END, { toolCallId: 'a', result: { code: 778899 } }));
      rec.onEmit!(ev(ITER, { iterIndex: 2 }));
      rec.onEmit!(ev(START, { toolName: 'B', toolCallId: 'b', args: { code: 778899 } }));
      return rec.getLineage().edges.length;
    };
    expect(make(false)).toBe(0);
    expect(make(true)).toBe(1);
  });

  it('resets accumulated state when a new run starts (pipelineId changes)', () => {
    const rec = toolLineageRecorder();
    rec.onEmit!(ev(ITER, { iterIndex: 1 }, 'stage#0', 'run-1'));
    rec.onEmit!(ev(START, { toolName: 'A', toolCallId: 'a', args: {} }, 'stage#0', 'run-1'));
    rec.onEmit!(ev(END, { toolCallId: 'a', result: { id: 'CARRYOVER-9' } }, 'stage#0', 'run-1'));
    // new run — the old producer must not leak into the new run's edges
    rec.onEmit!(ev(ITER, { iterIndex: 2 }, 'stage#0', 'run-2'));
    rec.onEmit!(
      ev(
        START,
        { toolName: 'B', toolCallId: 'b', args: { ref: 'CARRYOVER-9' } },
        'stage#0',
        'run-2',
      ),
    );

    const g = rec.getLineage();
    expect(g.nodes.map((n) => n.toolName)).toEqual(['B']); // only the new run
    expect(g.edges).toHaveLength(0);
  });
});

describe('toolLineageRecorder — functional (real agent run)', () => {
  it('recovers a real lookup→fetch dependency from the emit stream', async () => {
    const lookup = defineTool({
      name: 'lookup',
      description: 'returns a token',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ token: 'TKN-ABC-9981' }),
    });
    const fetchTool = defineTool({
      name: 'fetch',
      description: 'uses a token',
      inputSchema: {
        type: 'object',
        properties: { token: { type: 'string' } },
        required: ['token'],
      },
      execute: async () => 'fetched',
    });

    let i = 0;
    const provider: LLMProvider = mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'lookup', args: {} }],
            stopReason: 'tool_use',
          };
        if (i === 2)
          return {
            content: '',
            toolCalls: [{ id: 'c2', name: 'fetch', args: { token: 'TKN-ABC-9981' } }],
            stopReason: 'tool_use',
          };
        return { content: 'done', toolCalls: [], stopReason: 'stop' };
      },
    });

    const lineage = toolLineageRecorder();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('')
      .tool(lookup)
      .tool(fetchTool)
      .recorder(lineage)
      .build();

    await agent.run({ message: 'go' });

    const g = lineage.getLineage();
    expect(g.nodes.map((n) => n.toolName).sort()).toEqual(['fetch', 'lookup']);
    expect(
      g.edges.some(
        (e) =>
          e.from.toolName === 'lookup' && e.to.toolName === 'fetch' && e.value === 'TKN-ABC-9981',
      ),
      'expected a lookup→fetch lineage edge on the shared token',
    ).toBe(true);
  });
});
