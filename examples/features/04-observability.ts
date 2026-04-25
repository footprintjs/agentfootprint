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
 * Run:  npx tsx examples/v2/10-observability.ts
 */

import {
  Agent,
  LoggingDomains,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/features/04-observability',
  title: 'Observability — enable.thinking + enable.logging',
  group: 'v2-features',
  description: 'One-liner Tier-3 observability: .enable.thinking for status line + .enable.logging for firehose structured logs.',
  defaultInput: 'analyze the Q3 report',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'observability', 'thinking', 'logging'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req) => {
      const hadTool = req.messages.some((m) => m.role === 'tool');
      return hadTool
        ? {
            content: 'Done analyzing.',
            toolCalls: [],
            usage: { input: 40, output: 10 },
            stopReason: 'stop',
          }
        : {
            content: '',
            toolCalls: [{ id: 't', name: 'analyze', args: {} }],
            usage: { input: 30, output: 5 },
            stopReason: 'tool_use',
          };
    },
  };

  const agent = Agent.create({
    provider,
    model: 'mock',
  })
    .system('You analyze data.')
    .tool({
      schema: { name: 'analyze', description: '', inputSchema: { type: 'object' } },
      execute: () => 'analysis complete',
    })
    .build();

  // Live status line — user-facing "what's the agent doing right now".
  const stopThinking = agent.enable.thinking({
    onStatus: (status) => console.log(`  ⎈ ${status}`),
  });

  // Firehose logging filtered to stream + agent domains. The logger
  // object wraps console, pino, winston, etc. — any object with a
  // `log(message, data?)` method.
  const stopLogging = agent.enable.logging({
    domains: [LoggingDomains.STREAM, LoggingDomains.AGENT],
    logger: {
      log: (message) => console.log(`  [log] ${message}`),
    },
  });

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
