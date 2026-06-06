/**
 * 10 — Observability: enable.liveStatus + enable.observability.
 *
 * The `.enable.*` namespace attaches observability via uniform STRATEGIES:
 *   - `liveStatus({ strategy })`     — Claude-Code-style terse status line
 *   - `observability({ strategy })`  — firehose structured logs / vendor sink
 *
 * Every strategy is explicit (no magic defaults) — pick a built-in
 * (`chatBubbleLiveStatus`, `consoleObservability`) or supply a vendor one
 * (Datadog, OTel, AgentCore, …). Under the hood each subscribes to the
 * runner's typed dispatcher and formats the events.
 *
 * Run:  npx tsx examples/features/04-observability.ts
 */

import { Agent } from '../../src/index.js';
import { chatBubbleLiveStatus, consoleObservability } from '../../src/strategies/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/04-observability',
  title: 'Observability — enable.liveStatus + enable.observability',
  group: 'features',
  description:
    'Strategy-based Tier-3 observability: .enable.liveStatus for a status line + .enable.observability for firehose structured logs.',
  defaultInput: 'analyze the Q3 report',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'liveStatus', 'strategies'],
};

export async function run(input: string, provider?: import('../../src/index.js').LLMProvider): Promise<unknown> {
  // 'feature' kind: smart mock auto-runs "tool call → final answer".
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
  })
    .system('You analyze data.')
    .tool({
      schema: { name: 'analyze', description: '', inputSchema: { type: 'object' } },
      execute: () => 'analysis complete',
    })
    .build();

  // #region enable-livestatus
  // Live status line — user-facing "what's the agent doing right now".
  // The chat-bubble strategy maps the thinking-state machine to one line.
  const stopThinking = agent.enable.liveStatus({
    strategy: chatBubbleLiveStatus({ onLine: (line) => console.log(`  ⎈ ${line}`) }),
  });
  // #endregion enable-livestatus

  // #region enable-observability
  // Firehose observability via the console strategy. Swap in any vendor
  // strategy (Datadog, OTel, AgentCore, CloudWatch) — same call site.
  const stopLogging = agent.enable.observability({
    strategy: consoleObservability({ logger: { log: (...args) => console.log('  [log]', ...args) } }),
  });
  // #endregion enable-observability

  let out: unknown;
  try {
    out = await agent.run({ message: input });
    console.log('\nAgent output:', out);
  } finally {
    stopThinking();
    stopLogging();
  }
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
