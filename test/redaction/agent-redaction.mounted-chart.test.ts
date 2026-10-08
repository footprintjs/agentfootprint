/**
 * A runner's chart mounted into an executor the APP built keeps its runner's
 * declared policy on every event it emits.
 *
 * `Runner.getSpec()` documents the door: `parent.addSubFlowChartNext('sf-agent',
 * agent.getSpec(), 'Agent')`, run by the app's own `FlowChartExecutor`.
 * footprintjs hands a mounted chart's stages the PARENT executor's scopes, so
 * no run of this library made them; a typed event's payload is served at its
 * source only through a scope a run made (`runRedaction.ts` · `emitServed`).
 * Every stage of a runner's chart is bound to its runner when the chart is
 * built (`chartBinding.ts` · `bindChartStages`), so a stage that starts in a
 * scope no run tied serves its events under the runner's DECLARED policy.
 *
 * The named limit beside it: the mounted chart's STATE belongs to the app's
 * executor, and follows that executor's own policy (footprintjs's law).
 */
import { FlowChartExecutor, flowChart } from 'footprintjs';
import type { CombinedRecorder, RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { locationsOf } from './fixture.js';

const SSN = 'SSN-MOUNTED-7777';

/** An agent that calls `lookup` with the person's ssn, then answers. */
function agentWith(redact: RedactionPolicy | undefined) {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: { ssn: SSN } }] },
        { content: 'Found it.' },
      ],
    }),
    model: 'm',
    ...(redact !== undefined && { redact }),
  })
    .tool(
      defineTool<{ ssn: string }, unknown>({
        name: 'lookup',
        description: 'Look a citizen up.',
        inputSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
        execute: ({ ssn }) => ({ ssn, status: 'active' }),
      }),
    )
    .build();
}

/** The app's own chart and executor, with the agent mounted through `getSpec()`. */
async function runMounted(redact: RedactionPolicy | undefined, executorPolicy?: RedactionPolicy) {
  const agent = agentWith(redact);
  const app = flowChart<{ question: string; answer?: unknown }>(
    'Ask',
    (scope) => {
      scope.question = 'Is this citizen active?';
    },
    'ask',
  )
    .addSubFlowChartNext('sf-agent', agent.getSpec(), 'Agent', {
      inputMapper: (parent) => ({ message: String(parent.question) }),
      outputMapper: (out) => ({ answer: out }),
    })
    .build();
  const executor = new FlowChartExecutor(app);
  if (executorPolicy !== undefined) executor.setRedactionPolicy(executorPolicy);
  const emitted: { name: string; payload: unknown }[] = [];
  executor.attachCombinedRecorder({
    id: 'app-recorder',
    onEmit: (event: { name: string; payload: unknown }) =>
      emitted.push({ name: event.name, payload: event.payload }),
  } as unknown as CombinedRecorder);
  await executor.run({ input: {} });
  return {
    typed: emitted.filter((e) => e.name.startsWith('agentfootprint.')),
    snapshot: executor.getSnapshot(executorPolicy !== undefined ? { redact: true } : undefined),
  };
}

describe('a runner’s chart mounted into the app’s own executor', () => {
  it('CONTROL — an agent that declares nothing emits its events as they are', async () => {
    const { typed } = await runMounted(undefined);
    expect(typed.length).toBeGreaterThan(0);
    expect(locationsOf(typed, SSN).length).toBeGreaterThan(0);
  });

  it('its typed events are served under the policy the agent declares', async () => {
    const { typed } = await runMounted({ keys: ['ssn'] });
    const control = await runMounted(undefined);
    // Without the agent's policy the field travels; under it, no event carries
    // it — by name where it rides as `ssn`, by kind everywhere else…
    expect(fieldsNamedSsn(control.typed)).toContain(SSN);
    expect(locationsOf(typed, SSN)).toEqual([]);
    // …and the same events go out, with or without it.
    expect(typed.map((e) => e.name)).toEqual(control.typed.map((e) => e.name));
  });

  it('the vocabulary declared on the agent keeps the conversation out of every event', async () => {
    const { typed } = await runMounted(conversationRedaction());
    expect(locationsOf(typed, SSN)).toEqual([]);
    expect(locationsOf(typed, 'Is this citizen active?')).toEqual([]);
  });

  it('THE NAMED LIMIT — the mounted chart’s state follows the app executor’s own policy', async () => {
    // The agent declares the vocabulary, the app's executor nothing: its state is the app's.
    const raw = await runMounted(conversationRedaction());
    expect(locationsOf(raw.snapshot, SSN).length).toBeGreaterThan(0);
    // The app hands its executor the policy, and its state is covered too.
    const covered = await runMounted(conversationRedaction(), conversationRedaction());
    expect(locationsOf(covered.snapshot, SSN)).toEqual([]);
    expect(locationsOf(covered.typed, SSN)).toEqual([]);
  });

  it('the agent’s own runs are untouched by the binding: served as before', async () => {
    const agent = agentWith(conversationRedaction());
    const events: unknown[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.run({ message: 'Is this citizen active?' });
    expect(events.length).toBeGreaterThan(0);
    expect(locationsOf(events, SSN)).toEqual([]);
  });
});

/** Every value an event carries under a key named `ssn`, at any depth. */
function fieldsNamedSsn(events: readonly { payload: unknown }[]): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'ssn') out.push(child);
      walk(child);
    }
  };
  for (const e of events) walk(e.payload);
  return out;
}
