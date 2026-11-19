import { flowChart } from 'footprintjs';
import { expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { runnerLive } from '../../../src/core/runnerLive.js';
import { mock } from '../../../src/doors/providers.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { MemoryDefinition, MemoryIdentity } from '../../../src/memory/index.js';

const TURN_END = 'agentfootprint.agent.turn_end';
type TurnEnd = AgentfootprintEventMap[typeof TURN_END];

it.each([
  ['inline', 'fresh'],
  ['inline', 'resumed'],
  ['deferred', 'fresh'],
  ['deferred', 'resumed'],
] as const)(
  'marks only the owning turn end in both event paths (%s, %s)',
  async (observerDelivery, turn) => {
    const inner = Agent.create({
      provider: mock({
        replies:
          turn === 'fresh'
            ? ['Child answer.']
            : [{ toolCalls: [{ id: 'ask', name: 'approval', args: {} }] }, 'Child answer.'],
      }),
      model: 'mock',
    })
      .tool({
        schema: { name: 'approval', description: 'Approve', inputSchema: { type: 'object' } },
        execute: () => pauseHere({ question: 'Continue?' }),
      })
      .build();

    // Mount the child inside an owning Agent so both ends share the same
    // native execution and the same application dispatcher.
    const read = flowChart<{ memberIdentity: MemoryIdentity }>(
      'Read',
      (scope) => {
        scope.memberIdentity = scope.$getArgs<{ identity: MemoryIdentity }>().identity;
      },
      'read',
    )
      .addSubFlowChartNext('member', inner.getSpec(), 'Member', {
        inputMapper: (parent) => ({ identity: parent.memberIdentity, message: 'Ask the member.' }),
      })
      .build();
    const root = Agent.create({
      provider: mock({ reply: 'Root answer.' }),
      model: 'mock',
      observerDelivery,
      redact: { emitPatterns: [/^agentfootprint\.agent\.turn_end$/] },
    })
      .memory({
        id: 'nested',
        type: 'episodic',
        timing: 'turn-start',
        read: read as unknown as MemoryDefinition['read'],
      })
      .build();

    const served: TurnEnd[] = [];
    const real: TurnEnd[] = [];
    const offServed = root.on(TURN_END, (event) => served.push(event));
    const offReal = runnerLive(root)!.onRealEvent((event) => {
      if (event.type === TURN_END) real.push(event);
    });

    try {
      const run = await root.run({ message: 'Approve the report.' });
      if (turn === 'resumed') {
        if (!isPaused(run)) throw new Error('The child should pause');
        expect(served).toEqual([]);
        expect(real).toEqual([]);
        expect(await root.resume(run.checkpoint, { approved: true })).toBe('Root answer.');
      } else {
        expect(run).toBe('Root answer.');
      }

      expect(real.map((event) => event.payload.finalContent)).toEqual([
        'Child answer.',
        'Root answer.',
      ]);
      expect(served.map((event) => event.payload)).toEqual(['[REDACTED]', '[REDACTED]']);
      expect(served.map((event) => event.meta.runtimeStageId)).toEqual(
        real.map((event) => event.meta.runtimeStageId),
      );
      for (const [childEnd, rootEnd] of [served, real]) {
        expect(childEnd?.meta).not.toHaveProperty('rootTurn');
        expect(rootEnd?.meta.rootTurn).toBe(true);
      }
    } finally {
      offServed();
      offReal();
    }
  },
);
