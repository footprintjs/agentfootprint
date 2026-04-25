/**
 * 11 — Typed events: 47 event types across 13 domains.
 *
 * Every runner exposes `.on(type, listener)` with compile-time payload
 * checking. Wildcards: `'*'` for all, `'agentfootprint.<domain>.*'` for a
 * domain. Consumer-owned domains (eval, memory, skill) use `runner.emit()`.
 *
 * Run:  npx tsx examples/v2/11-events.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/features/05-events',
  title: 'Events — typed .on() + wildcards + runner.emit()',
  group: 'v2-features',
  description: 'The 47-event typed registry: .on(type, listener) is compile-time checked; wildcards (* / domain.*) for broad subscriptions; runner.emit() for consumer events.',
  defaultInput: 'find info',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'events', 'typed', 'wildcard'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req) => {
      const hadTool = req.messages.some((m) => m.role === 'tool');
      return hadTool
        ? {
            content: 'all done',
            toolCalls: [],
            usage: { input: 30, output: 5 },
            stopReason: 'stop',
          }
        : {
            content: '',
            toolCalls: [{ id: 't', name: 'search', args: { q: 'kittens' } }],
            usage: { input: 20, output: 5 },
            stopReason: 'tool_use',
          };
    },
  };

  const agent = Agent.create({
    provider,
    model: 'mock',
  })
    .system('')
    .tool({
      schema: { name: 'search', description: '', inputSchema: { type: 'object' } },
      execute: () => '3 results found',
    })
    .build();

  // 1) Specific typed subscription — payload type is known.
  agent.on('agentfootprint.stream.llm_start', (e) => {
    console.log(`llm_start: iter=${e.payload.iteration} model=${e.payload.model}`);
  });

  // 2) Domain wildcard — every `stream.*` event.
  agent.on('agentfootprint.stream.*', (e) => {
    console.log(`[stream.*] ${e.type}`);
  });

  // 3) Global wildcard — every event (debugging).
  let totalEvents = 0;
  agent.on('*', () => {
    totalEvents++;
  });

  // 4) Consumer-owned eval event — agent.emit() dispatches to typed listeners.
  agent.on('agentfootprint.eval.score', (e) => {
    console.log(`eval.score: ${e.payload.metricId}=${e.payload.value}`);
  });

  const out = await agent.run({ message: 'find info' });

  // Emit a consumer eval event AFTER the run — typed payload, no cast.
  agent.emit('agentfootprint.eval.score', {
    metricId: 'response-quality',
    value: 0.85,
    target: 'run',
    targetRef: 'this-run',
    evaluator: 'heuristic',
  });

  console.log(`\nFinal: ${out}`);
  console.log(`Total events observed: ${totalEvents}`);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
