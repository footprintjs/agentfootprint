/**
 * 12 — `agentfootprint/status` subpath: low-level chat-bubble status.
 *
 * Two ways to drive a "what's the agent doing right now" line:
 *
 *   • HIGH-LEVEL — `agent.enable.thinking({ onStatus })`. One callback,
 *     opinionated formatter, see `examples/features/04-observability.ts`.
 *   • LOW-LEVEL — this example. The state machine + templates + renderer,
 *     for consumers building custom chat UIs (Lens, embedded widgets,
 *     locale-aware bots) where they want full control over formatting,
 *     per-tool overrides, locale switching, arg interpolation, etc.
 *
 * What this example shows:
 *   1. Subscribe to '*' (every event) and accumulate them in a log.
 *   2. After each event, call `selectThinkingState(events)` — returns the
 *      CURRENT state (idle | tool | streaming | paused | null).
 *   3. Resolve a template + interpolate vars via `renderThinkingLine`.
 *   4. Per-tool overrides: `tool.<toolName>` keys win over generic `tool`.
 *
 * Run:  npx tsx examples/features/06-status-subpath.ts
 */

import { Agent, type AgentfootprintEvent } from '../../src/index.js';
import {
  selectThinkingState,
  renderThinkingLine,
  defaultThinkingTemplates,
  type ThinkingTemplates,
} from '../../src/status.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/06-status-subpath',
  title: 'Status subpath — selectThinkingState + renderThinkingLine + templates',
  group: 'features',
  description:
    'Low-level chat-bubble status: derive ThinkingState from events, render via per-tool templates with var interpolation. Sister to enable.thinking; this is the primitive consumers compose into custom UIs.',
  defaultInput: 'check the weather in Paris',
  providerSlots: ['default'],
  tags: ['feature', 'status', 'thinking', 'chat-bubble', 'subpath'],
};

// Per-tool overrides — the same shape Neo's chat-bubble uses.
// Keys MUST match the registered tool names.
//
// Built-in template vars (filled by selectThinkingState):
//   - {{appName}}     — passed via ThinkingContext at render time
//   - {{toolName}}    — set when state === 'tool'
//   - {{toolCallId}}  — set when state === 'tool' and id is available
//   - {{partial}}     — set when state === 'streaming' (accumulated tokens)
//   - {{question}}    — set when state === 'paused' (pause reason)
//
// For arg-aware templates (e.g. "Looking up weather in {{city}}"), the
// consumer takes the AgentfootprintEvent stream directly and substitutes
// from `event.payload.args`. See `neo-mds-triage` ChatFeed.tsx for the
// reference implementation.
const myTemplates: ThinkingTemplates = {
  ...defaultThinkingTemplates,
  idle: 'Bot is thinking…',
  'tool.weather': 'Looking up the weather…',
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
        description: 'Get current weather.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      execute: ({ city }: { city: string }) => `${city}: 72°F, sunny`,
    })
    .build();

  const events: AgentfootprintEvent[] = [];
  const statusLine = (): string | null => {
    const state = selectThinkingState(events);
    if (!state) return null;
    return renderThinkingLine(state, { appName: 'Bot' }, myTemplates);
  };

  // Subscribe '*' (the global wildcard — note: NOT 'agentfootprint.*'
  // which is invalid). Re-render the status line on every event.
  const off = agent.on('*', (event: AgentfootprintEvent) => {
    events.push(event);
    const line = statusLine();
    if (line !== null) {
      console.log(`  💬 ${line}`);
    }
  });

  try {
    const result = await agent.run({ message: input });
    return result;
  } finally {
    off();
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
