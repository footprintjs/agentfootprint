/**
 * exportTrace — capture a run's full state as portable JSON.
 *
 * Use this to ship traces externally:
 *   - paste into the agent-playground viewer for visual debugging
 *   - send to support / engineering for bug reports
 *   - log to durable storage for replay or audit
 *   - attach to incident tickets
 *
 * The default `redact: true` requests the redacted-mirror snapshot from
 * footprintjs (4.14+) so configured-redacted keys arrive scrubbed.
 *
 * Run: npx tsx examples/observability/29-export-trace.ts
 */

import { Agent, exportTrace, mock } from 'agentfootprint';

async function main() {
  const agent = Agent.create({
    provider: mock([{ content: 'Sure — your account balance is $1,234.56.' }]),
  })
    .system('You are a banking assistant.')
    .build();

  await agent.run('What is my balance?');

  // Default: redact: true. With a redaction policy configured upstream,
  // sensitive sharedState keys arrive as 'REDACTED' instead of raw.
  const trace = exportTrace(agent);

  console.log('schemaVersion:', trace.schemaVersion);
  console.log('exportedAt:   ', trace.exportedAt);
  console.log('redacted:     ', trace.redacted);
  console.log('narrative lines:', trace.narrative?.length ?? 0);
  console.log('entries:        ', trace.narrativeEntries?.length ?? 0);
  console.log('snapshot keys: ', Object.keys((trace.snapshot as object) ?? {}));

  // The full trace is JSON-serializable — pipe into a file, send over HTTP,
  // or paste into the viewer. ~1 line shown.
  const json = JSON.stringify(trace);
  console.log(`trace size: ${(json.length / 1024).toFixed(1)} kB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
