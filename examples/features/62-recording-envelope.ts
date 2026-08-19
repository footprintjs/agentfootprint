/**
 * 62 — The recording envelope: a run you can still read next quarter.
 *
 * `recordRun` already freezes a run into `{ events, snapshot, structure }`,
 * and that is exactly right for handing to a viewer in the same process.
 * What it is NOT is a thing you can put on disk: it carries no format
 * marker, no producer version, no statement of WHICH run it is, and no
 * statement of whether it is the WHOLE run. So every consumer that wanted
 * to archive one invented its own wrapper, and each wrapper guessed
 * differently about the same missing facts.
 *
 * The envelope is the producer-owned answer: one format string, and every
 * field either a fact the library can prove or a fact the caller stated.
 * `persistRecording` builds it and hands it to a sink; `fileRecordingSink`
 * is the reference sink — one JSON file per run, written atomically.
 *
 * This example shows the three things worth knowing:
 *
 *   1. record → persist → read the JSON back, unchanged;
 *   2. identity is never INVENTED — an anonymous run archives with no
 *      `principal` key at all, not a placeholder and not a session id;
 *   3. a fact the envelope cannot honour is REFUSED BY NAME — asking for
 *      privacy `'structure-only'` throws before the sink is reached, and
 *      a bare `Recording` cannot report a drop count it never had.
 *
 * The refusals are the feature, not the rough edges around it. An archive
 * is read by people who were not there when the run happened, so every
 * field is a claim — and a claim that turns out to be a guess is worse
 * than a missing field, because a missing field sends the reader to look
 * and a wrong one stops them looking.
 *
 * Everything here runs on the mock provider and writes to a temp
 * directory it deletes on the way out: no network, no API key, no
 * leftovers.
 *
 * Run:  npm run example examples/features/62-recording-envelope.ts
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  recordRun,
  persistRecording,
  buildRecordingEnvelope,
  fileRecordingSink,
  FULL_PRIVACY_POLICY_ID,
  RECORDING_ENVELOPE_FORMAT,
  IndeterminateRunFactError,
  UnsupportedPrivacyModeError,
  type Recording,
  type RecordingEnvelope,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/62-recording-envelope',
  title: 'Recording envelope — a saved run that says what it is',
  group: 'features',
  description:
    'Persist a recorded run as one versioned JSON archive, read it back unchanged, and watch ' +
    'the envelope refuse by name every fact it would otherwise have had to guess.',
  defaultInput: 'Weather in San Francisco?',
  providerSlots: ['default'],
  tags: ['features', 'observability', 'recording', 'archive', 'privacy', 'provenance'],
};

/** Small assert so a broken round trip fails the example instead of printing a lie. */
function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const llm = provider ?? mock({ reply: 'Sunny, 18°C.' });
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .system('Answer weather questions in one line.')
    .build();

  const directory = mkdtempSync(join(tmpdir(), 'af-run-archive-'));

  try {
    // #region persist
    // A recording is collected AS the run happens — start before run().
    const recorder = recordRun(agent);
    const answer = await agent.run({ message: input });

    const { id, uri } = await persistRecording(recorder, {
      sink: fileRecordingSink({ directory }),
      // `complete` has no default and no derivation: a frozen recording looks
      // identical whether it was taken after the run or from a crash handler,
      // so the API asks rather than guessing.
      run: { complete: true },
    });
    recorder.stop();
    // #endregion persist

    console.log(`archived as ${id}`);
    console.log(`           ${uri ?? '(this sink has no address)'}\n`);

    // ── 1. The round trip: what came back is what went in. ──
    const onDisk = JSON.parse(readFileSync(join(directory, id), 'utf8')) as RecordingEnvelope;

    check(onDisk.format === RECORDING_ENVELOPE_FORMAT, 'the format marker to survive the file');
    check(onDisk.privacy.mode === 'full', "privacy.mode to be 'full'");
    check(onDisk.privacy.policyId === FULL_PRIVACY_POLICY_ID, 'a matchable privacy policy id');
    check(onDisk.run.complete, 'the archive to state that it holds a whole run');
    check(onDisk.run.droppedEvents === 0, 'a proven zero drop count');
    check(typeof onDisk.run.endedAt === 'string', 'a complete run to carry an end time');
    check(onDisk.recording.events.length > 0, 'the recording to ride along whole');

    console.log(`format          ${onDisk.format}`);
    console.log(`produced by     agentfootprint ${onDisk.producer.agentfootprintVersion}`);
    console.log(`run             ${onDisk.run.runId}`);
    console.log(`window          ${onDisk.run.startedAt} → ${onDisk.run.endedAt ?? '(open)'}`);
    console.log(`complete        ${String(onDisk.run.complete)}`);
    console.log(`events          ${onDisk.recording.events.length} (0 dropped)`);
    console.log(`model           ${onDisk.configuration?.manifest?.llm?.model ?? '(unstated)'}`);

    // ── 2. Identity is inherited from the event meta, never invented. ──
    // This run named no actor, so the archive names none. Absent is a real
    // answer — a placeholder, or a session id wearing an actor's name, would
    // be a claim nobody made.
    check(!('principal' in onDisk.run), 'an anonymous run to archive with no principal key');
    check(!('tenant' in onDisk.run), 'an anonymous run to archive with no tenant key');
    console.log(`principal       (absent — this run named no actor)\n`);

    // ── 3. Two refusals. Both are the feature. ──
    // #region refusals
    // (a) A privacy label this version cannot honour. Downstream readers
    //     decide how carefully to handle the bytes FROM THIS FIELD, so
    //     stamping 'structure-only' over raw bytes would get them handled
    //     with LESS care than bytes that admit they are raw.
    const before = readdirSync(directory).length;
    try {
      await persistRecording(recorder, {
        sink: fileRecordingSink({ directory }),
        run: { complete: true },
        privacy: { mode: 'structure-only' },
      });
      throw new Error('expected the unsupported privacy mode to be refused');
    } catch (error) {
      if (!(error instanceof UnsupportedPrivacyModeError)) throw error;
      console.log(`privacy '${error.mode}' — refused, and nothing was written:\n`);
      console.log(`  ${error.message.split('\n')[0]}`);
      check(readdirSync(directory).length === before, 'no file to appear under a bad label');
    }

    // (b) A bare `Recording` carries no drop count — only the live handle
    //     counts what the maxEvents cap discarded. Reporting 0 would turn
    //     "we did not look" into "none were dropped".
    const bare: Recording = onDisk.recording;
    try {
      buildRecordingEnvelope(bare, { run: { complete: true } });
      throw new Error('expected the missing drop count to be refused');
    } catch (error) {
      if (!(error instanceof IndeterminateRunFactError)) throw error;
      console.log(`\nrun.${error.field} on a bare Recording — refused rather than assumed:\n`);
      console.log(`  ${error.message.slice(0, 160)}…`);
    }

    // …and the refusal names its own fix: state the fact yourself.
    const stated = buildRecordingEnvelope(bare, { run: { complete: true, droppedEvents: 0 } });
    check(stated.run.droppedEvents === 0, 'a stated drop count to be honoured');
    // #endregion refusals

    console.log('\n  → stated explicitly, the same recording envelopes fine.');

    if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
    return answer;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
