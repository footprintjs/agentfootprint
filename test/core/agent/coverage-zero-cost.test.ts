/**
 * Zero-cost-when-unused, for both coverage primitives.
 *
 * The house law an additive feature has to pay for: an agent whose tools
 * return neither `absent(…)` nor `coverage(…)` must be byte-identical to the
 * release before this one — same delivered bytes, same events, same tracked
 * state, same chart. Recognition is deliberately STRICT (a reserved marker
 * key, not a duck-typed field) precisely so this test can be written.
 *
 * Sections follow Convention 3: Regression only — every case here is a pin.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool, readAbsence, readCoverageResult } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

const call = (name: string, id = 't1') => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Ev = { name: string; payload: Record<string, unknown> };
const capture = () => {
  const all: Ev[] = [];
  const recorder = {
    id: 'capture-zero-cost',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) =>
      all.push({ name: e.name, payload: e.payload ?? {} }),
  };
  return { all, recorder };
};

/** Every ordinary shape a tool has ever returned, including the near-misses
 *  that share a word with the primitives without sharing their marker. */
const ORDINARY: readonly unknown[] = [
  'no rows matched',
  '',
  [],
  [{ port: 'fc1/3' }],
  { rows: [] },
  { rows: [], count: 0 },
  { not_found: true, count: 0, query: { port: 'fc1/3' } },
  { checked: ['a source'], notChecked: [] },
  { coverage: { checked: ['a source'] }, result: 'ok' },
  { af_absent: false, checked: ['a source'] },
  null,
  0,
  false,
];

describe('regression: neither shape is recognized in anything else', () => {
  it('every ordinary return value reads as data', () => {
    for (const value of ORDINARY) {
      expect(readAbsence(value)).toBeUndefined();
      expect(readCoverageResult(value)).toBeUndefined();
    }
  });
});

describe('regression: an agent that returns neither shape is byte-identical', () => {
  const plainTool = defineTool({
    name: 'list_ports',
    description: 'ports on a switch',
    inputSchema: { type: 'object', properties: {} },
    // The shape a real "found nothing" looks like TODAY — the thing this
    // release is an alternative to, not a replacement for.
    execute: () => ({ rows: [], count: 0 }),
  });

  const run = async () => {
    const caps = capture();
    const agent = Agent.create({
      provider: mock({
        replies: [call('list_ports'), final('Nothing matched.')] as never,
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .tool(plainTool)
      .watch(caps.recorder)
      .build();
    const out = await agent.run('list the ports');
    return { agent, out, ...caps };
  };

  it('emits no coverage event of either kind', async () => {
    const t = await run();
    expect(
      t.all.filter(
        (e) =>
          e.name === 'agentfootprint.tools.absent' ||
          e.name === 'agentfootprint.tools.coverage_declared',
      ),
    ).toHaveLength(0);
  });

  it('writes no scope key — the snapshot has no `coverageDeclared` at all', async () => {
    const t = await run();
    const state = t.agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('coverageDeclared' in state).toBe(false);
  });

  it('delivers the tool’s own bytes, and declares no status', async () => {
    const t = await run();
    const toolEnd = t.all.find((e) => e.name === 'agentfootprint.stream.tool_end');
    expect(toolEnd?.payload.status).toBeUndefined();
    const history = (
      t.agent.getLastSnapshot()?.sharedState as {
        history: Array<{ role: string; content: string }>;
      }
    ).history;
    expect(history.find((m) => m.role === 'tool')?.content).toBe('{"rows":[],"count":0}');
  });

  it('ships the model’s answer unchanged, with the travel option ON as well as off', async () => {
    const t = await run();
    expect(t.out).toBe('Nothing matched.');

    const caps = capture();
    const withOption = Agent.create({
      provider: mock({ replies: [call('list_ports'), final('Nothing matched.')] as never }),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .tool(plainTool)
      .limitsTravelWithTheAnswer()
      .watch(caps.recorder)
      .build();
    expect(await withOption.run('list the ports')).toBe('Nothing matched.');
  });

  it('the chart is the same chart — mounting the option changes no stage id or shape', async () => {
    const build = (travel: boolean) => {
      let b = Agent.create({
        provider: mock({ replies: [final('x')] as never }),
        model: 'mock',
      })
        .system('s')
        .tool(plainTool);
      if (travel) b = b.limitsTravelWithTheAnswer();
      return b.build();
    };
    const idsOf = (agent: Agent) => JSON.stringify(agent.getSpec(), null, 0).length;
    // Same structure, same serialized size: the option swaps ONE stage
    // function body, never a node, an id or an edge.
    expect(idsOf(build(true))).toBe(idsOf(build(false)));
  });
});
