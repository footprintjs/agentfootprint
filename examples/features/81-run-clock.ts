/**
 * 81 — the run clock: when "now" is and which zone the person is in, declared and recorded.
 *
 * A support desk serves people in many zones. "Any failed backups since 8?" means
 * 8 in the PERSON's zone, and a server that silently reads it in its own zone
 * answers a different question. So the time layer makes the clock an INPUT:
 *
 *   Agent.create(...).time({ zone: 'America/Los_Angeles' })   // a fallback, optional
 *   agent.run({ message, time: { now: sentAt, zone: session.zone } })
 *
 *   - the zone is per run; the builder's is a fallback; with neither the zone is
 *     UNKNOWN — never the server's, never guessed: the clock row says
 *     `zoneSource: 'unknown'`, instants are spelled in UTC and say so, and the
 *     person is asked their zone before any time they wrote is read;
 *   - every request ends with the library's one time line, opening with the
 *     turn's clock ("This turn's time: Friday 2026-10-09 08:40 …");
 *   - `now` is the app's (the message's time), else the turn's start, recorded as
 *     a default nobody chose (`nowSource: 'default'`);
 *   - seed files ONE `clock` row per turn on the ledger; each dispatched call files
 *     a `call` row with `dispatchedAt` (a tool evaluates "the last hour" against
 *     its own clock, which after a pause is later than `now`);
 *   - a resume that passes a different `time` keeps the frozen clock — the paused
 *     turn's words were read against it — and files `clock-on-resume`;
 *   - with `.limitsTravelWithTheAnswer()`, every `Period:` line is shown in the
 *     person's zone, the zone named — "to 8:40" reads 08:40.
 *
 * Run:  npm run example examples/features/81-run-clock.ts
 */

import {
  Agent,
  absent,
  defineTool,
  isPaused,
  pauseHere,
  type CallRow,
  type ClockOnResumeRow,
  type ClockRow,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/81-run-clock',
  title: 'The run clock — when "now" is and which zone the person is in, declared and recorded',
  group: 'features',
  description:
    'Each run declares its clock: time: { now, zone } (the zone per run, .time({ zone }) a fallback, ' +
    'neither → the zone is unknown, asked, never guessed). Seed files one clock row per turn, each call a call row with dispatchedAt; a ' +
    'resume passing a new time keeps the frozen clock and files clock-on-resume; the limits block ' +
    'shows each Period line in the person’s zone.',
  defaultInput: 'Any failed backups on host-103 since 8?',
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** A backup search whose result says what its read covered (instants, never words). */
const backupFailures = defineTool({
  name: 'backup_failures',
  description: 'Failed backup jobs for one host since a time.',
  inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
  execute: async ({ host }: { host?: string }) =>
    absent({
      what: `failed backup jobs for ${host ?? 'the host'}`,
      checked: ['every backup job in the live index'],
      period: {
        queried: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00Z' },
        held: 'unknown',
      },
    }),
});

/** A step that stops for the person before it re-runs anything. */
const confirmRerun = defineTool({
  name: 'confirm_rerun',
  description: 'Ask the person before re-running a job.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => pauseHere({ question: 'Re-run the failed job?' }),
});

const rowsOf = <T>(agent: Agent, kind: string): T[] =>
  (agent.findings() ?? []).filter((r) => r.kind === kind) as T[];

// #region run-clock
function desk(script: NonNullable<Parameters<typeof mock>[0]>['replies']) {
  return Agent.create({ provider: mock({ replies: script }), model: 'small-model' })
    .tool(backupFailures)
    .tool(confirmRerun)
    .time({ zone: 'America/Los_Angeles' }) // the fallback; each run's own zone wins
    .limitsTravelWithTheAnswer()
    .build();
}
// #endregion run-clock

export async function run(input: string): Promise<string> {
  // 1. The person's zone and the message's time travel with the run.
  const agent = desk([
    { toolCalls: [{ id: 'call-1', name: 'backup_failures', args: { host: 'host-103' } }] },
    { content: 'No failed backups on host-103 since 8.' },
  ]);
  const answer = String(
    await agent.run({
      message: input,
      time: { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' },
    }),
  );
  const [clock] = rowsOf<ClockRow>(agent, 'clock');
  console.log('the clock row:', JSON.stringify(clock));
  console.log('the call row: ', JSON.stringify(rowsOf<CallRow>(agent, 'call')[0]));
  console.log(`\n${answer}\n`);
  check(clock?.nowSource === 'app' && clock.zoneSource === 'run', 'the clock the app declared');
  check(
    answer.includes('2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)'),
    'the Period line in the person’s zone, "to 8:40" shown as 08:40',
  );

  // 2. No zone anywhere — the zone is UNKNOWN, never the server's and never guessed.
  const zoneless = Agent.create({ provider: mock({ replies: [{ content: 'hi' }] }), model: 'm' })
    .time()
    .build();
  await zoneless.run({ message: input, time: { now: '2026-10-09T15:40:00Z' } });
  const [unknown] = rowsOf<ClockRow>(zoneless, 'clock');
  console.log('no zone anywhere →', JSON.stringify(unknown));
  check(
    unknown?.zoneSource === 'unknown' && unknown.zone === 'UTC',
    'a run with no zone records it as unknown (UTC is only the spelling)',
  );

  // 3. A pause, and a resume half an hour later that passes the current time:
  //    recorded, not applied — the paused turn keeps its clock.
  const paused = desk([
    { toolCalls: [{ id: 'call-1', name: 'confirm_rerun', args: {} }] },
    { content: 'Re-run started.' },
  ]);
  const outcome = await paused.run({ message: 'Re-run it', time: { now: '2026-10-09T15:40:00Z' } });
  if (!isPaused(outcome)) throw new Error('expected a pause');
  await paused.resume(outcome.checkpoint, 'yes', { time: { now: '2026-10-09T16:10:00Z' } });
  const [kept] = rowsOf<ClockRow>(paused, 'clock');
  const [onResume] = rowsOf<ClockOnResumeRow>(paused, 'clock-on-resume');
  console.log('kept clock:     ', kept?.now);
  console.log('clock-on-resume:', JSON.stringify(onResume));
  check(kept?.now === '2026-10-09T15:40:00Z', 'the frozen clock kept');
  check(onResume?.passed.now === '2026-10-09T16:10:00Z', 'the passed time recorded');

  return `${clock?.zone} · now ${clock?.now} (${clock?.nowSource})`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
