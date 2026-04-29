/**
 * 10 — Observability: enable.thinking + enable.logging.
 *
 * The `.enable.*` namespace attaches pre-built observability recorders.
 *   - `thinking({onStatus})`  — Claude-Code-style terse status line
 *   - `logging({domains})`    — firehose structured logs filtered by domain
 *
 * These are one-liners. Under the hood they subscribe to the runner's
 * typed dispatcher and format the events.
 *
 * Run:  npx tsx examples/10-observability.ts
 */

import {
  Agent,
  LoggingDomains,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/04-observability',
  title: 'Observability — enable.thinking + enable.logging',
  group: 'features',
  description: 'One-liner Tier-3 observability: .enable.thinking for status line + .enable.logging for firehose structured logs.',
  defaultInput: 'analyze the Q3 report',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'thinking', 'logging'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
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

  // #region enable-thinking
  // Live status line — user-facing "what's the agent doing right now".
  const stopThinking = agent.enable.thinking({
    onStatus: (status) => console.log(`  ⎈ ${status}`),
  });
  // #endregion enable-thinking

  // #region enable-logging
  // Firehose logging filtered to stream + agent domains. The logger
  // object wraps console, pino, winston, etc. — any object with a
  // `log(message, data?)` method.
  const stopLogging = agent.enable.logging({
    domains: [LoggingDomains.STREAM, LoggingDomains.AGENT],
    logger: {
      log: (message) => console.log(`  [log] ${message}`),
    },
  });
  // #endregion enable-logging

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
