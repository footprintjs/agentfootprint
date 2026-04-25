/**
 * 07 — Pause / Resume: human-in-the-loop.
 *
 * A tool calls `pauseHere({question})` to request human input. The
 * Agent returns a `RunnerPauseOutcome` carrying a JSON-serializable
 * checkpoint. Store it anywhere (Redis, Postgres, localStorage), then
 * call `.resume(checkpoint, humanAnswer)` to continue — same process
 * OR different process.
 *
 * Run:  npx tsx examples/v2/07-pause-resume.ts
 */

import {
  Agent,
  pauseHere,
  isPaused,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/features/01-pause-resume',
  title: 'Pause / Resume — human-in-the-loop',
  group: 'v2-features',
  description: 'A tool calls pauseHere() to request human input; Agent.run returns a serializable checkpoint; .resume(checkpoint, answer) continues.',
  defaultInput: 'refund order 123',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'pause', 'resume', 'HITL'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const provider: LLMProvider = {
    name: 'refund-mock',
    complete: async (req) => {
      const hadHumanAnswer = req.messages.some((m) => m.role === 'tool');
      if (hadHumanAnswer) {
        return {
          content: 'Refund approved by ops — processed order #123.',
          toolCalls: [],
          usage: { input: 40, output: 20 },
          stopReason: 'stop',
        };
      }
      return {
        content: 'I need operator approval before processing a refund.',
        toolCalls: [
          {
            id: 'c1',
            name: 'askOperator',
            args: { question: 'Approve $500 refund on order #123?' },
          },
        ],
        usage: { input: 30, output: 15 },
        stopReason: 'tool_use',
      };
    },
  };

  const agent = Agent.create({ provider, model: 'mock' })
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
        // Throw a PauseRequest — Agent catches and pauses the ReAct loop.
        pauseHere({ question: q, severity: 'high' });
        return ''; // unreachable — pauseHere always throws
      },
    })
    .build();

  agent.on('agentfootprint.pause.request', (e) =>
    console.log(`⏸  paused — reason: ${e.payload.reason}`),
  );
  agent.on('agentfootprint.pause.resume', (e) =>
    console.log(`▶  resumed — paused for ${e.payload.pausedDurationMs}ms`),
  );

  const first = await agent.run({ message: 'refund order 123' });
  if (!isPaused(first)) {
    console.log('Finished without pausing:', first);
    return;
  }

  console.log('Pause data:', first.pauseData);

  // Serialize → deserialize (simulates Redis store/restore).
  const wire = JSON.stringify(first.checkpoint);
  const restored = JSON.parse(wire);

  // Later, after the human responds…
  const final = await agent.resume(restored, 'Approved by Alice');
  console.log('\nFinal:', final);
  return final;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
