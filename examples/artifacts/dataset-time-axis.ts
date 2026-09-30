/** A producer declares its rows' time axis; a viewer draws a series without guessing. */
import {
  Agent, defineTool, describeTimeAxis, inMemoryArtifacts, normaliseInstants, readTimeAxis,
  withDatasetArtifacts,
  type DatasetResultAdapter, type DatasetTimeAxis, type LLMProvider,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/dataset-time-axis',
  title: 'Declare which column is time',
  group: 'artifacts',
  description: 'A tool declares the time column, its unit and how each row summarises its interval; a viewer reads the ticket instead of guessing and compares times as UTC instants.',
  defaultInput: 'Show the hourly IO profile.',
  providerSlots: ['default'],
  tags: ['artifacts', 'datasets', 'time-series', 'charts'],
};

// #region declare
const hourly = {
  rows: [
    { ts: 1_726_300_800, avg_iops: 410, peak_iops: 1_220 },
    { ts: 1_726_304_400, avg_iops: 380, peak_iops: 990 },
    { ts: 1_726_308_000, avg_iops: 455, peak_iops: 1_410 },
  ],
};

// Epoch SECONDS under a column called `ts`: nothing a viewer could guess safely.
const timeAxis: DatasetTimeAxis = {
  column: 'ts',
  unit: 'epoch-s',
  interval: '1h',
  aggregate: { avg_iops: 'avg', peak_iops: 'max' },
};

const adapter: DatasetResultAdapter<Record<string, unknown>, typeof hourly, { ref: string }> = {
  describe(result) {
    return {
      datasets: [{
        key: 'rows',
        artifact: { kind: 'dataset/rows', mediaType: 'application/json', data: result.rows, timeAxis },
      }],
      project([publication]) {
        if (publication?.artifact.status !== 'stored') throw new Error('The series could not be retained.');
        return { ref: publication.artifact.meta.ref };
      },
    };
  },
};
// #endregion declare

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = inMemoryArtifacts();
  const scope = { conversationId: 'io-profile-demo' };
  const profile = defineTool({
    name: 'io_profile', description: 'Hourly IO profile of one port.',
    execute: async () => hourly,
  });
  let call = 0;
  const agent = Agent.create({
    artifacts: store, model: 'mock', maxIterations: 3,
    provider: provider ?? mock({ respond() {
      return ++call === 1
        ? { toolCalls: [{ id: 'p', name: 'io_profile', args: {} }] }
        : 'The hourly profile is on screen.';
    } }),
  }).system('Use io_profile.').tool(withDatasetArtifacts(profile, adapter)).build();
  await agent.run({ message: input, identity: scope });

  // #region read
  // The viewer's side: the ticket says what the rows are, so nothing is guessed.
  const [ticket] = (await store.list(scope)).artifacts;
  const reading = readTimeAxis(ticket);
  const title = reading.status === 'declared'
    ? `IO profile — ${describeTimeAxis(reading.axis) ?? 'time series'}`
    : 'IO profile (table)';
  // #endregion read

  // #region normalise
  // Comparing needs instants, not spellings: the view turns the declared column into
  // UTC at one precision, sorted, and leaves the stored rows exactly as they were.
  const record = ticket === undefined ? null : await store.get(scope, ticket.ref);
  const view = reading.status === 'declared' && record !== null
    ? normaliseInstants(record.data as unknown[], reading.axis)
    : undefined;
  const first = view?.status === 'instants' ? view.points[0] : undefined;

  // A wall-clock string with no offset and no declared zone is never read as UTC.
  const unzoned = normaliseInstants(
    [{ t: '2026-09-14T10:00:00Z' }, { t: '2026-09-14T11:00:00' }],
    { column: 't', unit: 'iso' },
  );
  // #endregion normalise

  // #region refuse
  const refused = await store
    .put(scope, { kind: 'dataset/rows', mediaType: 'application/json', data: [],
      timeAxis: { column: 'ts', unit: 'epoch-s', aggregate: 'avg' } })
    .then(() => 'stored', (err: Error) => err.message.replace(/^\[artifacts\] /, '').replace(/\.$/, ''));
  // #endregion refuse

  return [
    `Chart title: ${title}.`,
    `Time column: ${reading.status === 'declared' ? `${reading.axis.column} (${reading.axis.unit})` : 'none'}.`,
    `First point: ${first ? `${first.at} (row ${first.row})` : 'none'}.`,
    `A string with no offset and no zone: ${unzoned.status === 'refused' ? 'refused' : `${unzoned.status}, ${unzoned.counts.naive} value not read as UTC`}.`,
    `A summary with no interval: ${refused}.`,
  ].join('\n');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(error => { console.error(error); process.exitCode = 1; });
}
