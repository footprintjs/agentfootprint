/**
 * 13 — Live state: O(1) "what's happening RIGHT NOW" reads.
 *
 * `LiveStateRecorder` answers three live questions about an in-flight
 * run, in O(1), without folding the event log:
 *
 *   - Is an LLM call in flight? What's the partial answer so far?
 *   - Is a tool executing? Which tool?
 *   - Is the agent in a turn? Which turn index?
 *
 * Built on the footprintjs `BoundaryStateTracker<TState>` storage
 * primitive (v4.17.2+). Each tracker subscribes to one matched
 * event pair — `[start, stop]` — and clears its transient state
 * automatically on stop. Memory is O(K active boundaries), not O(N events).
 *
 * Use case: live commentary in UI ("Chatbot is thinking…", "Calling
 * tool: weather"), CLI status lines, Sentry breadcrumbs at exception
 * time, test harnesses that wait for the LLM to settle, etc.
 *
 * Run:  npx tsx examples/features/13-live-state.ts
 */

import { Agent, liveStateRecorder } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/13-live-state',
  title: 'Live state — O(1) "is it happening NOW" reads',
  group: 'features',
  description:
    'liveStateRecorder() bundles three trackers (LLM / tool / turn) on the BoundaryStateTracker storage primitive. Subscribe once, read O(1) at any moment.',
  defaultInput: "what's the weather in Seattle?",
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'live-state', 'streaming'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
  })
    .system('You answer weather questions.')
    .tool({
      schema: {
        name: 'weather',
        description: 'Get current weather for a city.',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
      execute: () => ({ tempF: 62, conditions: 'cloudy' }),
    })
    .build();

  // #region attach
  // ONE attach for all three live views.
  const live = liveStateRecorder();
  live.subscribe(agent);
  // #endregion attach

  // #region peek-during-run
  // Background peek loop — interleaves with the run so we see the
  // tracker's transient state evolve mid-flight. Real consumers (UI,
  // CLI, dashboards) do this from their render/animation loop.
  const peeks: string[] = [];
  const interval = setInterval(() => {
    const parts: string[] = [];
    if (live.isAgentInTurn()) parts.push(`turn=${live.getCurrentTurnIndex()}`);
    if (live.isLLMInFlight()) parts.push(`llm:"${live.getPartialLLM().slice(0, 30)}"`);
    if (live.isToolExecuting()) parts.push(`tool=${live.getExecutingToolNames().join(',')}`);
    if (parts.length > 0) peeks.push(parts.join(' · '));
  }, 5);
  // #endregion peek-during-run

  try {
    const result = await agent.run({ message: input });
    // result is `string | RunnerPauseOutcome` — pull the answer from
    // the string variant; pause outcomes don't apply to this demo.
    const answer = typeof result === 'string' ? result : '(paused)';
    return {
      answer,
      peeksDuringRun: peeks,
      finalState: {
        llmInFlight: live.isLLMInFlight(),
        toolExecuting: live.isToolExecuting(),
        agentInTurn: live.isAgentInTurn(),
      },
    };
  } finally {
    clearInterval(interval);
    live.unsubscribe();
  }
}

// CLI entry — runs the example with the bundled mock provider.
if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
