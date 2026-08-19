/**
 * The recording envelope — the versioned contract that makes a saved run
 * archivable, and the sink that files one.
 *
 * What is actually under test here is a single rule: an envelope never states
 * a fact it had to guess. A reader of an archive was not there when the run
 * happened, so every field is a claim, and the failures worth guarding are the
 * ones where a plausible value would have been accepted silently:
 *
 *   - an anonymous run must produce NO `principal` key — not a placeholder and
 *     not the session id, which is the "a conversation id is not an actor" law
 *     the event meta already keeps and this envelope inherits;
 *   - `droppedEvents: 0` must mean "none were dropped", never "we did not
 *     look", so a bare Recording (which carries no count) is refused;
 *   - `startedAt` must not be read off the earliest RETAINED event once the cap
 *     has discarded the head of the stream — that timestamp is the moment
 *     recording overflowed, not the moment the run began;
 *   - a recording that spans two runs (a recorder left attached across
 *     `run()` and `resume()`) must not be filed under the first run id it saw;
 *   - a privacy mode this version cannot honour is REFUSED BY NAME rather than
 *     approximated, because every downstream reader decides how carefully to
 *     handle the bytes from that label alone.
 *
 * Sections:
 *   1. unit          — the shape, the derivations, the producer stamp
 *   2. identity      — never invented (the load-bearing one)
 *   3. refusals      — every fact that cannot be derived says so by name
 *   4. privacy       — v1 is 'full' only, and says so
 *   5. round-trip    — the whole envelope survives JSON exactly
 *   6. file names    — the injectivity battery, with a broken control
 *   7. the sink      — atomic write, no debris, replace-in-place
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { recordRun, type Recording } from '../../../src/recorders/observability/recordRun.js';
import {
  buildRecordingEnvelope,
  persistRecording,
  IndeterminateRunFactError,
  UnsupportedPrivacyModeError,
  RECORDING_ENVELOPE_FORMAT,
  FULL_PRIVACY_POLICY_ID,
  type RecordingEnvelope,
  type RecordingSink,
} from '../../../src/recorders/observability/recordingEnvelope.js';
import {
  fileRecordingSink,
  recordingFileName,
  UnsafeRecordingIdError,
} from '../../../src/recorders/observability/fileRecordingSink.js';

function agent(reply = 'done') {
  return Agent.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('be brief')
    .build();
}

/** One recorded run, handed back as the live handle. */
async function recorded(options?: { maxEvents?: number; identity?: Record<string, string> }) {
  const runner = agent();
  const rec = recordRun(runner, options?.maxEvents ? { maxEvents: options.maxEvents } : {});
  await runner.run({ message: 'hi', ...(options?.identity && { identity: options.identity }) });
  return { runner, rec };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'afp-recording-envelope-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Collects what a sink was handed, without touching a disk. */
function memorySink(): RecordingSink & { written: RecordingEnvelope[] } {
  const written: RecordingEnvelope[] = [];
  return {
    written,
    write: (envelope) => {
      written.push(envelope);
      return Promise.resolve({ id: envelope.run.runId });
    },
  };
}

// ─── 1. UNIT ────────────────────────────────────────────────────────

describe('recording envelope — unit', () => {
  it('stamps the format, the producer versions, and carries the recording whole', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(envelope.format).toBe('agentfootprint.recording.v1');
    expect(envelope.format).toBe(RECORDING_ENVELOPE_FORMAT);

    // Read from the real package manifests through the same helper the bug
    // report uses — a version that cannot be read answers 'unknown', and that
    // would make the stamp useless, so this pins the real thing.
    const rootVersion = (
      JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
        version: string;
      }
    ).version;
    expect(envelope.producer.agentfootprintVersion).toBe(rootVersion);

    // KNOWN DEFECT, pinned deliberately rather than papered over: footprintjs's
    // package.json `exports` map lists no './package.json', so
    // require('footprintjs/package.json') throws ERR_PACKAGE_PATH_NOT_EXPORTED
    // and engineVersion() answers 'unknown' — in a plain CJS Node process just
    // as here, which means every bug-report bundle's `environment.footprintjs`
    // has been 'unknown' too. The envelope does not LIE ('unknown' is
    // libraryVersion.ts's documented "cannot tell"), but the stamp is not
    // useful. Pinned so that repairing engineVersion() trips this test and
    // whoever does it finds this note, instead of the fix landing unnoticed.
    expect(envelope.producer.footprintjsVersion).toBe('unknown');

    // The recording rides unmodified — all three fields, same object.
    expect(envelope.recording.events.length).toBeGreaterThan(0);
    expect(envelope.recording.snapshot).toBeDefined();
    expect(envelope.recording.structure).toBeDefined();
  });

  it('derives the run id from the EVENT meta, not the snapshot’s engine id', async () => {
    const { rec } = await recorded();
    const recording = rec.toRecording();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    const metaRunId = recording.events[0]?.meta.runId;
    const engineRunId = (recording.snapshot as { runId?: string }).runId;

    expect(envelope.run.runId).toBe(metaRunId);
    // The two really are different namespaces — if this ever stops being true
    // the fallback question becomes live again, so it is pinned here.
    expect(engineRunId).toBeDefined();
    expect(envelope.run.runId).not.toBe(engineRunId);
  });

  it('reports droppedEvents from the live recorder, and 0 means none', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(rec.droppedEvents).toBe(0);
    expect(envelope.run.droppedEvents).toBe(0);
  });

  it('counts real drops rather than reporting a comfortable zero', async () => {
    const { rec } = await recorded({ maxEvents: 3 });
    expect(rec.droppedEvents).toBeGreaterThan(0);

    const envelope = buildRecordingEnvelope(rec, {
      // startedAt must be stated once the head is gone — see the refusal test.
      run: { complete: true, startedAt: '2026-08-18T00:00:00.000Z' },
    });
    rec.stop();
    expect(envelope.run.droppedEvents).toBe(rec.droppedEvents);
  });

  it('lifts the configuration from the run’s own run_configured manifest', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(envelope.configuration?.manifest).toBeDefined();
    expect(envelope.configuration?.manifest?.llm?.model).toBe('mock');
    expect(envelope.configuration?.agentId).toBe(envelope.configuration?.manifest?.agentId);
  });

  it('accepts a bare Recording when the caller supplies what it cannot know', async () => {
    const { rec } = await recorded();
    const recording: Recording = rec.toRecording();
    rec.stop();

    const envelope = buildRecordingEnvelope(recording, {
      run: { complete: true, droppedEvents: 0 },
    });
    expect(envelope.run.droppedEvents).toBe(0);
    expect(envelope.run.runId).toBe(recording.events[0]?.meta.runId);
  });
});

// ─── 2. IDENTITY — never invented ───────────────────────────────────

describe('recording envelope — identity is never invented', () => {
  it('an anonymous run produces NO principal and NO tenant key at all', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    // `in`, not `=== undefined`: a key present with an undefined value would
    // survive as a key here and vanish through JSON, so the two must not be
    // conflated. Absent means ABSENT.
    expect('principal' in envelope.run).toBe(false);
    expect('tenant' in envelope.run).toBe(false);
    expect('sessionId' in envelope.run).toBe(false);
  });

  it('never derives a principal from a session id', async () => {
    const runner = agent();
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' }, { sessionId: 'session-abc' });
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(envelope.run.sessionId).toBe('session-abc');
    // The whole point: a session id is a correlation key, not an actor.
    expect('principal' in envelope.run).toBe(false);
    expect('tenant' in envelope.run).toBe(false);
  });

  it('carries the principal and tenant the caller actually named', async () => {
    const { rec } = await recorded({
      identity: { conversationId: 'c-1', principal: 'ada', tenant: 'acme' },
    });
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(envelope.run.principal).toBe('ada');
    expect(envelope.run.tenant).toBe('acme');
  });
});

// ─── 3. REFUSALS ────────────────────────────────────────────────────

describe('recording envelope — a fact it cannot derive, it refuses by name', () => {
  it('refuses droppedEvents for a bare Recording rather than assuming 0', async () => {
    const { rec } = await recorded();
    const recording = rec.toRecording();
    rec.stop();

    expect(() => buildRecordingEnvelope(recording, { run: { complete: true } })).toThrow(
      IndeterminateRunFactError,
    );
    try {
      buildRecordingEnvelope(recording, { run: { complete: true } });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as IndeterminateRunFactError).field).toBe('droppedEvents');
      expect((error as Error).message).toContain('did not look');
    }
  });

  it('refuses startedAt once the cap has discarded the head of the stream', async () => {
    const { rec } = await recorded({ maxEvents: 3 });
    expect(rec.droppedEvents).toBeGreaterThan(0);

    try {
      buildRecordingEnvelope(rec, { run: { complete: true } });
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(IndeterminateRunFactError);
      expect((error as IndeterminateRunFactError).field).toBe('startedAt');
    }
    rec.stop();
  });

  it('refuses a recording that spans two runs instead of filing it under the first', async () => {
    const runner = agent();
    const rec = recordRun(runner);
    await runner.run({ message: 'one' });
    await runner.run({ message: 'two' }); // a fresh runId is minted per run()
    const recording = rec.toRecording();
    rec.stop();

    const runIds = new Set(recording.events.map((e) => e.meta.runId));
    expect(runIds.size).toBe(2);

    try {
      buildRecordingEnvelope(rec, { run: { complete: true } });
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(IndeterminateRunFactError);
      expect((error as IndeterminateRunFactError).field).toBe('runId');
    }

    // …but an explicit statement is honoured: the caller owns the label.
    const stated = buildRecordingEnvelope(rec, {
      run: { complete: true, runId: [...runIds][0] as string },
    });
    expect(runIds.has(stated.run.runId)).toBe(true);
  });

  it('requires `complete` to be stated — it is never defaulted', async () => {
    const { rec } = await recorded();
    expect(() =>
      buildRecordingEnvelope(rec, { run: {} as unknown as { complete: boolean } }),
    ).toThrow(/run\.complete must be stated/);
    rec.stop();
  });

  it('refuses an unreadable caller timestamp', async () => {
    const { rec } = await recorded();
    expect(() =>
      buildRecordingEnvelope(rec, { run: { complete: true, startedAt: 'last tuesday' } }),
    ).toThrow(IndeterminateRunFactError);
    rec.stop();
  });
});

// ─── 4. COMPLETENESS AND ITS CONSEQUENCE ────────────────────────────

describe('recording envelope — an incomplete recording has no end time', () => {
  it('complete: true derives endedAt from the last event', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    const recording = rec.toRecording();
    rec.stop();

    const lastMs = recording.events[recording.events.length - 1]?.meta.wallClockMs as number;
    expect(envelope.run.endedAt).toBe(new Date(lastMs).toISOString());
    expect(Date.parse(envelope.run.endedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(envelope.run.startedAt),
    );
  });

  it('complete: false leaves endedAt ABSENT — the run had not ended', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: false } });
    rec.stop();

    expect(envelope.run.complete).toBe(false);
    expect('endedAt' in envelope.run).toBe(false);
  });

  it('…unless the caller states one', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, {
      run: { complete: false, endedAt: '2026-08-18T12:00:00.000Z' },
    });
    rec.stop();
    expect(envelope.run.endedAt).toBe('2026-08-18T12:00:00.000Z');
  });
});

// ─── 5. PRIVACY — v1 is 'full' only, and says so ────────────────────

describe('recording envelope — privacy modes it cannot honour are refused by name', () => {
  it("defaults to 'full' with a matchable policy id (the control that must pass)", async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    expect(envelope.privacy.mode).toBe('full');
    expect(envelope.privacy.policyId).toBe(FULL_PRIVACY_POLICY_ID);
  });

  for (const mode of ['redacted', 'structure-only'] as const) {
    it(`refuses '${mode}' rather than storing raw bytes under that label`, async () => {
      const { rec } = await recorded();
      try {
        buildRecordingEnvelope(rec, { run: { complete: true }, privacy: { mode } });
        expect.unreachable('should have refused');
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedPrivacyModeError);
        const err = error as UnsupportedPrivacyModeError;
        // Names what is not implemented, and why refusing beats approximating.
        expect(err.mode).toBe(mode);
        expect(err.message).toContain(mode);
        expect(err.message).toContain('not implemented');
        expect(err.message).toMatch(/LESS care|worse outcome/);
      }
      rec.stop();
    });
  }

  it('refuses an unknown mode too — an unrecognised label is not a safe one', async () => {
    const { rec } = await recorded();
    expect(() =>
      buildRecordingEnvelope(rec, {
        run: { complete: true },
        privacy: { mode: 'anonymised' as 'full' },
      }),
    ).toThrow(UnsupportedPrivacyModeError);
    rec.stop();
  });

  it('refuses BEFORE the sink is reached — nothing is stored under a bad label', async () => {
    const { rec } = await recorded();
    const sink = memorySink();
    await expect(
      persistRecording(rec, { sink, run: { complete: true }, privacy: { mode: 'redacted' } }),
    ).rejects.toBeInstanceOf(UnsupportedPrivacyModeError);
    expect(sink.written).toHaveLength(0);
    rec.stop();
  });
});

// ─── 6. ROUND TRIP ──────────────────────────────────────────────────

describe('recording envelope — survives JSON exactly', () => {
  it('stringify → parse → deep-equal, recording included', async () => {
    const { rec } = await recorded({
      identity: { conversationId: 'c-1', principal: 'ada', tenant: 'acme' },
    });
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });
    rec.stop();

    const revived = JSON.parse(JSON.stringify(envelope)) as RecordingEnvelope;

    // The whole thing, not a field-by-field spot check: this is the claim the
    // envelope makes by existing — that it can be written down and read back.
    expect(revived).toEqual(envelope);
    expect(revived.recording.events).toHaveLength(envelope.recording.events.length);
    expect(revived.run.principal).toBe('ada');
  });

  it('an absent optional is an absent KEY, so the round trip cannot change shape', async () => {
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: false } });
    rec.stop();

    const revived = JSON.parse(JSON.stringify(envelope)) as RecordingEnvelope;
    expect(revived).toEqual(envelope);
    expect(Object.keys(revived.run).sort()).toEqual(Object.keys(envelope.run).sort());
  });
});

// ─── 7. FILE NAMES — the injectivity battery ────────────────────────

/**
 * Ids chosen so that a careless mapping collides on them: case twins (the
 * 9.44.0 filesystem-folding bug), separator donation, dot navigation, and the
 * extension appearing inside the id itself.
 */
const NAME_CORPUS: readonly string[] = [
  'run-1787093273110-1',
  'run-1787093273110-2',
  '1787093273111-0000000001',
  'run-a',
  'run-A', // case twin of 'run-a' — one file on macOS/Windows
  'a-b',
  'a/b', // separator donation: becomes 'a-b' under a naive replace
  'a.b',
  'ab',
  'archive.json', // the extension inside the id
  'archive',
  '..',
  '.hidden',
  'con', // Windows device
  'x'.repeat(300),
  '',
];

/**
 * Drive any id→name mapping over the corpus and report the first pair that
 * lands on ONE file.
 *
 * Names are compared case-folded, because that is what the filesystem this
 * repo runs on does: a mapping that is injective as a string but not after
 * folding still loses an archive, which is the whole finding of 9.44.0.
 * Refused ids cannot collide — a refusal writes no file — so they are skipped,
 * and the caller checks separately that the mapping accepted a real corpus.
 */
function findCollision(
  map: (id: string) => string,
  ids: readonly string[],
): { a: string; b: string; name: string } | undefined {
  const byName = new Map<string, string>();
  for (const id of ids) {
    let name: string;
    try {
      name = map(id);
    } catch {
      continue;
    }
    const folded = name.toLowerCase();
    const prior = byName.get(folded);
    if (prior !== undefined && prior !== id) return { a: prior, b: id, name };
    byName.set(folded, id);
  }
  return undefined;
}

function acceptedCount(map: (id: string) => string, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) {
    try {
      map(id);
      n += 1;
    } catch {
      /* refused */
    }
  }
  return n;
}

describe('recording file names — the mapping is injective, and the battery proves it', () => {
  it('the real mapping has no collisions (control that must PASS)', () => {
    expect(findCollision(recordingFileName, NAME_CORPUS)).toBeUndefined();
  });

  it('…and is not passing vacuously — it accepts the real ids', () => {
    // If the mapping refused everything, "no collisions" would be worthless.
    expect(acceptedCount(recordingFileName, NAME_CORPUS)).toBeGreaterThanOrEqual(8);
    expect(recordingFileName('run-1787093273110-1')).toBe('run-1787093273110-1.json');
  });

  it('CATCHES a mapping that lowercases instead of refusing uppercase', () => {
    // The 9.44.0 bug, reproduced: injective as a string, one file on disk.
    const broken = (id: string): string => `${id.toLowerCase()}.json`;
    const collision = findCollision(broken, NAME_CORPUS);
    expect(collision).toBeDefined();
    expect([collision?.a, collision?.b].sort()).toEqual(['run-A', 'run-a']);
  });

  it('CATCHES a mapping that rewrites separators instead of refusing them', () => {
    // A corpus with no case twins, so the separator pair is the ONLY thing that
    // can collide — otherwise the case twins above are found first and this
    // test would pass without ever exercising separator donation.
    const separatorCorpus = ['a-b', 'a/b', 'a\\b', 'run-1', 'run-2'];
    expect(findCollision(recordingFileName, separatorCorpus)).toBeUndefined();

    const broken = (id: string): string => `${id.replace(/[/\\]/g, '-')}.json`;
    const collision = findCollision(broken, separatorCorpus);
    expect(collision).toBeDefined();
    expect([collision?.a, collision?.b].sort()).toEqual(['a-b', 'a/b']);
  });

  it('CATCHES a mapping that strips the characters it dislikes', () => {
    const broken = (id: string): string => `${id.replace(/[^a-z0-9]/gi, '').toLowerCase()}.json`;
    expect(findCollision(broken, NAME_CORPUS)).toBeDefined();
  });

  for (const [id, why] of [
    ['run-A', 'uppercase folds on macOS and Windows'],
    ['a/b', 'a path separator is not a name'],
    ['a\\b', 'a path separator is not a name'],
    ['..', 'path navigation'],
    ['.hidden', 'a leading dot hides the archive'],
    ['-flag', 'a leading dash reads as a CLI flag'],
    ['con', 'a Windows device name'],
    ['nul', 'a Windows device name'],
    ['com1', 'a Windows device name'],
    ['a b', 'a space is not in the safe set'],
    ['a b', 'control characters are not names'],
    ['', 'an empty id names nothing'],
    ['x'.repeat(201), 'longer than the filesystem allows once suffixed'],
  ] as const) {
    it(`refuses ${JSON.stringify(id)} by name — ${why}`, () => {
      expect(() => recordingFileName(id)).toThrow(UnsafeRecordingIdError);
    });
  }

  it('the refusal teaches: it names the id and the safe set', () => {
    try {
      recordingFileName('Run-42');
      expect.unreachable('should have refused');
    } catch (error) {
      const err = error as UnsafeRecordingIdError;
      expect(err.code).toBe('ERR_UNSAFE_RECORDING_ID');
      expect(err.runId).toBe('Run-42');
      expect(err.message).toContain('Run-42');
      expect(err.message).toMatch(/uppercase/i);
    }
  });
});

// ─── 8. THE SINK ────────────────────────────────────────────────────

describe('fileRecordingSink — one archive per run, atomically', () => {
  it('writes the envelope as one JSON file that parses back equal', async () => {
    const dir = tempDir();
    const { rec } = await recorded();
    const envelope = buildRecordingEnvelope(rec, { run: { complete: true } });

    const result = await persistRecording(rec, {
      sink: fileRecordingSink({ directory: dir }),
      run: { complete: true },
    });
    rec.stop();

    expect(result.id).toBe(`${envelope.run.runId}.json`);
    expect(result.uri).toContain('file://');

    const files = readdirSync(dir);
    expect(files).toEqual([`${envelope.run.runId}.json`]);
    // No temporary debris: the rename is the only thing that leaves a file.
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);

    const onDisk = JSON.parse(
      readFileSync(join(dir, files[0] as string), 'utf8'),
    ) as RecordingEnvelope;
    expect(onDisk.format).toBe(RECORDING_ENVELOPE_FORMAT);
    expect(onDisk.run.runId).toBe(envelope.run.runId);
    expect(onDisk.recording.events).toHaveLength(envelope.recording.events.length);
  });

  it('creates the directory, refuses a nameless one', () => {
    const dir = join(tempDir(), 'nested', 'archive');
    expect(() => fileRecordingSink({ directory: dir })).not.toThrow();
    expect(() => fileRecordingSink({ directory: '' })).toThrow(/names no directory/);
  });

  it('refuses an unsafe run id before writing anything', async () => {
    const dir = tempDir();
    const { rec } = await recorded();
    const sink = fileRecordingSink({ directory: dir });

    await expect(
      persistRecording(rec, { sink, run: { complete: true, runId: 'Run/../escape' } }),
    ).rejects.toBeInstanceOf(UnsafeRecordingIdError);
    rec.stop();

    // Nothing was written — not even a temporary file.
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a second envelope for one run REPLACES the archive rather than adding one', async () => {
    const dir = tempDir();
    const { rec } = await recorded();
    const sink = fileRecordingSink({ directory: dir });

    await persistRecording(rec, { sink, run: { complete: false } });
    const partial = JSON.parse(
      readFileSync(join(dir, readdirSync(dir)[0] as string), 'utf8'),
    ) as RecordingEnvelope;
    expect(partial.run.complete).toBe(false);

    await persistRecording(rec, { sink, run: { complete: true } });
    rec.stop();

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const finished = JSON.parse(
      readFileSync(join(dir, files[0] as string), 'utf8'),
    ) as RecordingEnvelope;
    expect(finished.run.complete).toBe(true);
    expect(finished.run.endedAt).toBeDefined();
  });

  it('persistRecording refuses anything that is not a sink', async () => {
    const { rec } = await recorded();
    await expect(
      persistRecording(rec, {
        sink: {} as unknown as RecordingSink,
        run: { complete: true },
      }),
    ).rejects.toThrow(/needs a sink with a write/);
    rec.stop();
  });
});
