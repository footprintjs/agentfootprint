import { flowChart } from 'footprintjs';
import { expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { runnerLive } from '../../../src/core/runnerLive.js';
import { mock } from '../../../src/doors/providers.js';
import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { MemoryDefinition, MemoryIdentity } from '../../../src/memory/index.js';

const TURN_END = 'agentfootprint.agent.turn_end';
type TurnEnd = AgentfootprintEventMap[typeof TURN_END];
const TURN_EVENTS = new Set<string>([
  'agentfootprint.agent.turn_start',
  TURN_END,
  'agentfootprint.stream.llm_start',
  'agentfootprint.stream.llm_end',
  'agentfootprint.stream.token',
]);

it.each([
  ['inline', 'fresh'],
  ['inline', 'resumed'],
  ['deferred', 'fresh'],
  ['deferred', 'resumed'],
] as const)(
  'marks mounted turn events and the owning turn end in both views (%s, %s)',
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

    const served: AgentfootprintEvent[] = [];
    const real: AgentfootprintEvent[] = [];
    const offServed = root.on('*', (event) => served.push(event));
    const offReal = runnerLive(root)!.onRealEvent((event) => real.push(event));

    try {
      const run = await root.run({ message: 'Approve the report.' });
      if (turn === 'resumed') {
        if (!isPaused(run)) throw new Error('The child should pause');
        await root.drainObservers();
        expect(served.some((event) => event.type === TURN_END)).toBe(false);
        expect(real.some((event) => event.type === TURN_END)).toBe(false);
        expect(await root.resume(run.checkpoint, { approved: true })).toBe('Root answer.');
      } else {
        expect(run).toBe('Root answer.');
      }
      await root.drainObservers();

      const ends = (events: AgentfootprintEvent[]) =>
        events.filter((event): event is TurnEnd => event.type === TURN_END);
      expect(ends(real).map((event) => event.payload.finalContent)).toEqual([
        'Child answer.',
        'Root answer.',
      ]);
      expect(ends(served).map((event) => event.payload)).toEqual(['[REDACTED]', '[REDACTED]']);
      const address = (event: AgentfootprintEvent) => [event.type, event.meta.runtimeStageId];
      expect(served.filter((event) => TURN_EVENTS.has(event.type)).map(address)).toEqual(
        real.filter((event) => TURN_EVENTS.has(event.type)).map(address),
      );
      for (const events of [served, real]) {
        const [childEnd, rootEnd] = ends(events);
        expect(childEnd?.meta).not.toHaveProperty('rootTurn');
        expect(rootEnd?.meta.rootTurn).toBe(true);

        const mounted = events.filter((event) => event.meta.subflowPath.includes('member'));
        const mountedTurnEvents = mounted.filter((event) => TURN_EVENTS.has(event.type));
        expect(new Set(mountedTurnEvents.map((event) => event.type))).toEqual(TURN_EVENTS);
        for (const event of mountedTurnEvents)
          expect(event.meta.mountedTurn, event.type).toBe(true);
        const owning = events.filter((event) => !event.meta.subflowPath.includes('member'));
        for (const event of owning)
          expect(event.meta, event.type).not.toHaveProperty('mountedTurn');
      }
    } finally {
      offServed();
      offReal();
      await Promise.all([root.shutdown(), inner.shutdown()]);
    }
  },
);
