/**
 * exportTrace() — capture a run's full state as portable JSON for
 * shipping externally: viewer, support tickets, durable storage,
 * replay, audit.
 *
 * Default `redact: true` uses footprintjs's redacted-mirror snapshot so
 * configured-redacted keys arrive scrubbed.
 */

import { Agent, exportTrace, mock } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'observability/04-export-trace',
  title: 'exportTrace() — portable JSON snapshot',
  group: 'observability',
  description: 'Capture an entire run as JSON for viewers, replay, or support tickets.',
  defaultInput: 'What is my balance?',
  providerSlots: ['default'],
  tags: ['observability', 'export', 'portable'],
};

const defaultMock = (): LLMProvider =>
  mock([{ content: 'Sure — your account balance is $1,234.56.' }]);

export async function run(input: string, provider?: LLMProvider) {
  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a banking assistant.')
    .build();

  await agent.run(input);

  const trace = exportTrace(agent);
  const json = JSON.stringify(trace);

  return {
    schemaVersion: trace.schemaVersion,
    exportedAt: trace.exportedAt,
    redacted: trace.redacted,
    narrativeLines: trace.narrative?.length ?? 0,
    narrativeEntries: trace.narrativeEntries?.length ?? 0,
    snapshotKeys: Object.keys((trace.snapshot as object) ?? {}),
    sizeKb: Number((json.length / 1024).toFixed(1)),
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
