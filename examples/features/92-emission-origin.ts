/** Read event origins without guessing an unavailable engine position. */
import assert from 'node:assert/strict';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { EventMeta } from '../../src/events.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/92-emission-origin',
  title: 'Emission time and available log positions',
  group: 'features',
  description:
    'Read source emission time under deferred delivery. Engine coordinates stay optional and distinct from the agent run identity.',
  defaultInput: 'Say hello.',
  providerSlots: [],
  tags: ['features', 'observability', 'events'],
};

export async function run(input: string): Promise<unknown> {
  const agent = Agent.create({
    provider: mock({ reply: 'Hello.' }),
    model: 'mock',
    observerDelivery: 'deferred',
  }).build();

  // #region emission-origin
  const origins: EventMeta[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => origins.push(event.meta));
  await agent.run(input);

  const rows = origins.map((origin) => ({
    agentRunId: origin.runId,
    emittedAt: origin.wallClockMs,
    emitter: origin.runtimeStageId,
    position: origin.sourcePosition ?? 'unavailable',
  }));
  // sourcePosition.engineRunId belongs to the execution engine, not the agent.
  // A position is the already-committed prefix, NOT the emitter's final state.
  // No position? Do not substitute the current cursor or root commit count.
  // #endregion emission-origin

  assert.equal(rows.length, 1);
  assert.ok(Number.isFinite(rows[0].emittedAt));
  return rows;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
