/**
 * 01 — Pause / Resume: human-in-the-loop, two independent processes.
 *
 * Production-shaped example. A tool calls `pauseHere({question})` to
 * request human input. The Agent returns a `RunnerPauseOutcome`
 * carrying a JSON-serializable checkpoint. The checkpoint is the ONLY
 * thing that crosses time and process boundaries — the agent
 * instance, runtime, recorders all dissolve.
 *
 * Two exports model the two real-world phases:
 *
 *   `run(input, provider?)`
 *     Process A (typically the request handler): build a fresh agent,
 *     run it. Returns either the final string OR a paused outcome
 *     whose checkpoint can be persisted to Redis / Postgres /
 *     localStorage.
 *
 *   `resume(checkpoint, humanAnswer, provider?)`
 *     Process B (could be hours / days / a different machine later):
 *     build a fresh agent with the SAME chart definition, hydrate it
 *     from the stored checkpoint with the human's answer. Returns
 *     the final string.
 *
 * The two functions share `buildAgent()` so the chart definition is
 * one source of truth. They do NOT share an Agent instance — each
 * phase constructs its own. cross-executor resume (footprintjs
 * 4.17.0+) makes this safe: subflow scope is restored from the
 * checkpoint, recorder/narrative state is fresh.
 *
 * CLI mode chains the two for a quick demo (see bottom of file).
 * Playground mode invokes them separately — `run()` from the Run
 * button, then `resume()` from the HITL form's Submit button when the
 * user answers the pause question.
 */

import {
  Agent,
  pauseHere,
  isPaused,
  type LLMProvider,
} from '../../src/index.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/features/01-pause-resume',
  title: 'Pause / Resume — human-in-the-loop',
  group: 'v2-features',
  description: 'Two-phase HITL: run() may pause and return a checkpoint; resume(checkpoint, answer) finishes the run from the human\'s reply. Process A and Process B can be days apart.',
  defaultInput: 'refund order 123',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'pause', 'resume', 'HITL'],
};

/**
 * Build the agent. Pure factory — no execution, no I/O. Both `run()`
 * and `resume()` call this so the chart definition (system prompt,
 * tool registry, voice config) is identical across the two phases.
 */
function buildAgent(provider?: LLMProvider) {
  return Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
  })
    .system('You process refunds. Use askOperator to request approval.')
    .tool({
      schema: {
        name: 'askOperator',
        description: 'Ask a human operator for approval.',
        inputSchema: {
          type: 'object',
          properties: { question: { type: 'string' } },
        },
      },
      execute: (args) => {
        const q = (args as { question: string }).question;
        // pauseHere throws a PauseRequest; the Agent catches it,
        // captures the checkpoint, and surfaces a RunnerPauseOutcome
        // up to whoever called .run().
        pauseHere({ question: q, severity: 'high' });
        return ''; // unreachable — pauseHere always throws
      },
    })
    .build();
}

/**
 * Process A. Kicks off the agent. Returns either the final answer
 * (no human approval needed) or a `RunnerPauseOutcome` with a
 * serializable checkpoint the caller stores until the human responds.
 */
export async function run(
  input: string,
  provider?: LLMProvider,
): Promise<unknown> {
  const agent = buildAgent(provider);
  return agent.run({ message: input });
  // → string                      (run completed without pause)
  // → RunnerPauseOutcome           ({ paused: true, checkpoint, pauseData })
}

/**
 * Process B. Resumes from a stored checkpoint. The `humanAnswer`
 * becomes the paused tool's return value, which the LLM sees as a
 * regular `messages[role=tool]` entry.
 *
 * Build a NEW agent (same chart) — never the one from `run()`. The
 * checkpoint is the only thing that crosses the process boundary.
 */
export async function resume(
  checkpoint: FlowchartCheckpoint,
  humanAnswer: unknown,
  provider?: LLMProvider,
): Promise<unknown> {
  const agent = buildAgent(provider);
  return agent.resume(checkpoint, humanAnswer);
}

// ── CLI demo: chain the two phases for a quick standalone run ──────

if (isCliEntry(import.meta.url)) {
  (async () => {
    const first = await run(meta.defaultInput ?? '');
    if (!isPaused(first)) {
      console.log('Finished without pausing:', first);
      printResult(first);
      return;
    }
    console.log('Pause data:', JSON.stringify(first.pauseData, null, 2));

    // Simulate Redis round-trip.
    const wire = JSON.stringify(first.checkpoint);
    const restored: FlowchartCheckpoint = JSON.parse(wire);

    const final = await resume(restored, 'Approved by Alice');
    console.log('\nFinal:', final);
    printResult(final);
  })().catch(console.error);
}
