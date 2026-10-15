/**
 * REGRESSION — a pause is addressed like every other event.
 *
 * `pause.request` and `pause.resume` used to carry footprintjs's resume cursor
 * as their `meta.subflowPath`: one CUMULATIVE mount id per level
 * (`['step-p', 'step-p/x']`), where every other event carries the segment list
 * (`['step-p', 'x']`). At depth one the two agree, so it went unseen; at depth
 * two a reader looking for the pause's owner the way it finds every event's —
 * the deepest turn whose mount prefixes the event's path — found the parent
 * agent instead of the agent that paused (found by the AG-UI adapter's review).
 *
 * Pinned at depth two in both nestings that reach it — a parallel branch in a
 * sequence step, and a sequence inside a sequence — for both pause events.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, Parallel, Sequence } from '../../../src/index.js';
import type { AgentfootprintEvent } from '../../../src/index.js';
import { pauseHere } from '../../../src/core/pause.js';
import { mock } from '../../../src/llm-providers.js';

const ask = defineTool({
  name: 'ask_person',
  description: 'Ask a person.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => pauseHere({ question: 'Approve?' }),
});

const pausing = () =>
  Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [{ content: '', toolCalls: [{ id: 'c1', name: 'ask_person', args: {} }] }, 'done'],
    }),
    model: 'm',
  })
    .system('s')
    .tool(ask)
    .build();

const answering = () =>
  Agent.create({ provider: mock({ chunkDelayMs: 0, replies: ['other'] }), model: 'm' })
    .system('s')
    .build();

async function pathsOf(
  runner: ReturnType<typeof Sequence.create> extends { build(): infer R } ? R : never,
): Promise<{ turn: readonly string[]; request: readonly string[]; resume: readonly string[] }> {
  const seen: AgentfootprintEvent[] = [];
  runner.on('*', (event) => seen.push(event));
  const out = (await runner.run({ message: 'go' } as never)) as {
    paused?: boolean;
    checkpoint?: unknown;
  };
  expect(out.paused).toBe(true);
  await runner.resume(out.checkpoint as never, 'yes' as never);
  const pathOf = (type: string) => seen.find((e) => e.type === type)!.meta.subflowPath;
  // The paused agent's own turn — the path its every event carries.
  const turn = seen
    .filter((e) => e.type === 'agentfootprint.stream.tool_start')
    .map((e) => e.meta.subflowPath)[0]!;
  return {
    turn,
    request: pathOf('agentfootprint.pause.request'),
    resume: pathOf('agentfootprint.pause.resume'),
  };
}

describe('regression — pause events carry the segment path every event carries', () => {
  it('a parallel branch inside a sequence step (depth two)', async () => {
    const fan = Parallel.create({ id: 'p' })
      .branch('x', pausing())
      .branch('y', answering())
      .mergeWithFn((r) => JSON.stringify(r))
      .build();
    const { turn, request, resume } = await pathsOf(
      Sequence.create({ id: 'seq' }).step('p', fan).build(),
    );
    expect(turn).toHaveLength(2);
    expect(turn[1]).toBe('x'); // a segment, not the cumulative 'step-…/x'
    expect(request).toEqual(turn);
    expect(resume).toEqual(turn);
  });

  it('a sequence inside a sequence (depth two)', async () => {
    const inner = Sequence.create({ id: 'inner' }).step('a', pausing()).build();
    const { turn, request, resume } = await pathsOf(
      Sequence.create({ id: 'outer' }).step('in', inner).build(),
    );
    expect(turn).toHaveLength(2);
    expect(request).toEqual(turn);
    expect(resume).toEqual(turn);
  });

  it('at the root and at depth one the path is what it always was', async () => {
    const seen: AgentfootprintEvent[] = [];
    const agent = pausing();
    agent.on('*', (event) => seen.push(event));
    await agent.run({ message: 'go' });
    expect(seen.find((e) => e.type === 'agentfootprint.pause.request')!.meta.subflowPath).toEqual(
      [],
    );

    const one = Sequence.create({ id: 'one' }).step('a', pausing()).build();
    const oneSeen: AgentfootprintEvent[] = [];
    one.on('*', (event) => oneSeen.push(event));
    await one.run({ message: 'go' } as never);
    const request = oneSeen.find((e) => e.type === 'agentfootprint.pause.request')!;
    const toolStart = oneSeen.find((e) => e.type === 'agentfootprint.stream.tool_start')!;
    expect(request.meta.subflowPath).toEqual(toolStart.meta.subflowPath);
    expect(request.meta.subflowPath).toHaveLength(1);
  });
});
