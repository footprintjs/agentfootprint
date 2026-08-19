/**
 * fileRecordingSink — one archived run, one JSON file, in a directory.
 *
 * The destination that needs nothing installed: an incident can be inspected
 * with `ls` and `cat`, and a run archive is a folder you can tar. It is also
 * the reference implementation of {@link RecordingSink} — a sink is one method,
 * and this file is what "implement the other ones like this" points at.
 *
 * ## The file name is a key, and keys must be injective
 *
 * `runId` becomes a file name, which makes `runId ↦ name` a mapping used as a
 * key: two different runs landing on one name means one archive silently
 * overwrites another, and the evidence is gone with no error anywhere. So the
 * mapping is `runId + '.json'` — appending a constant suffix, which is
 * injective — over a DOMAIN that is asserted rather than assumed, and anything
 * outside it is refused by name.
 *
 * The domain is `[a-z0-9]` followed by `[a-z0-9._-]*`, and every exclusion is
 * load-bearing:
 *
 *   • **no uppercase.** This is the one that looks like fussiness and is not.
 *     macOS/APFS and Windows/NTFS are case-INSENSITIVE by default, so `run-A`
 *     and `run-a` are two distinct strings that name ONE file. A mapping that
 *     is injective as a string can still collide as a file name, which is
 *     exactly the bug artifacts/scopePath.ts found on a stock Mac in 9.44.0 —
 *     its conformance battery had pairs for separators, absence markers and
 *     pre-escaped values, and no pair differing only in case. Excluding
 *     uppercase from the domain means no two valid ids differ by case alone, so
 *     there is nothing for a case-folding filesystem to fold together.
 *   • **no `/` or `\`.** A separator inside a field is separator donation: an
 *     id containing one would silently become a path with a directory hop.
 *   • **no leading `.` or `-`.** A leading dot hides the archive from `ls`; a
 *     leading dash is read as a flag by every CLI tool that would then handle
 *     it. Both are enforced by the first-character class.
 *   • **no bare `.` / `..`.** Path navigation, not names.
 *   • **length capped.** `NAME_MAX` is 255 on the common filesystems and the
 *     suffixes here add to it.
 *   • **no Windows reserved device names.** `con`, `nul`, `com1` … are devices
 *     with OR without an extension: `con.json` opens the console, not a file.
 *
 * Ids this library mints all satisfy it: `makeRunId()` produces
 * `run-<epoch ms>-<seq>` and the footprintjs engine produces
 * `<epoch ms>-<padded counter>`. The assertion is there for the ids a CALLER
 * states, which is the case that is neither controlled nor rare.
 *
 * ## Atomic, so a reader never sees half an archive
 *
 * The bytes go to a temporary file in the same directory and are then renamed
 * into place. `rename` within one filesystem is atomic, so a crash mid-write
 * leaves a `.tmp` nobody reads rather than a truncated `.json` that parses as
 * far as it got — a half-written archive is the one failure a bug report cannot
 * survive, because it looks like evidence.
 *
 * Writing the same `runId` twice REPLACES the file, atomically. That is the
 * intended behaviour and worth stating: the run id is the archive's identity,
 * so a second envelope for one run is a newer version of one archive (a partial
 * crash dump later superseded by the finished run), not a second archive.
 *
 * Node-only. `node:fs` is reached through `lazyRequire`, the same law the other
 * filesystem adapters follow, so importing the door costs a browser bundle
 * nothing and constructing one where there is no filesystem refuses by name.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import type { RecordingEnvelope, RecordingSink } from './recordingEnvelope.js';

type FsModule = typeof import('node:fs');
type PathModule = typeof import('node:path');

/** The archive file's extension. Also the tmp file's discriminator. */
const ENVELOPE_EXTENSION = '.json';

/** `NAME_MAX` is 255; leave room for the extension and the tmp suffix. */
const MAX_RUN_ID_LENGTH = 200;

/** Valid from the first character on — see the module header for each rule. */
const SAFE_RUN_ID = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Reserved on Windows with any extension, so `con.json` is still the console.
 * Checked against the whole id because the id IS the name's stem.
 */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/**
 * Raised when a run id cannot safely become a file name.
 *
 * Its own class because the fix is never a retry: the caller has to name the
 * archive something a filesystem can hold one-to-one.
 */
export class UnsafeRecordingIdError extends Error {
  readonly code = 'ERR_UNSAFE_RECORDING_ID' as const;
  readonly runId: string;

  constructor(runId: string, reason: string) {
    super(
      `[recording-sink] run id ${JSON.stringify(runId)} cannot become a file name: ${reason}\n\n` +
        `A file name is a key: if two runs can land on one name, one archive overwrites the ` +
        `other and the evidence is gone with nothing raised anywhere. So the safe set is ` +
        `asserted rather than hoped for — lowercase letters, digits, '.', '_' and '-', ` +
        `starting with a letter or digit, at most ${String(MAX_RUN_ID_LENGTH)} characters. ` +
        `(Uppercase is excluded because macOS and Windows fold case: 'run-A' and 'run-a' are ` +
        `two ids and one file.) Either state a run.runId in that set, or write to a sink whose ` +
        `keys are not file names.`,
    );
    this.name = 'UnsafeRecordingIdError';
    this.runId = runId;
  }
}

/**
 * The mapping under test: one run id → one file name, injectively.
 *
 * Exported so the collision battery can drive the mapping directly rather than
 * inferring it from files on a disk.
 *
 * @throws {UnsafeRecordingIdError} for any id outside the safe domain.
 */
export function recordingFileName(runId: string): string {
  if (typeof runId !== 'string' || runId === '') {
    throw new UnsafeRecordingIdError(String(runId), 'it is not a non-empty string.');
  }
  if (runId.length > MAX_RUN_ID_LENGTH) {
    throw new UnsafeRecordingIdError(
      runId,
      `it is ${String(runId.length)} characters; the limit is ${String(MAX_RUN_ID_LENGTH)}.`,
    );
  }
  if (/[A-Z]/.test(runId)) {
    throw new UnsafeRecordingIdError(
      runId,
      'it contains uppercase letters, and case-insensitive filesystems (macOS, Windows) would ' +
        'let it share a file with its lowercase twin.',
    );
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new UnsafeRecordingIdError(
      runId,
      'it must start with a lowercase letter or digit and contain only [a-z0-9._-] — path ' +
        'separators, spaces and control characters are not names.',
    );
  }
  if (/^\.+$/.test(runId)) {
    throw new UnsafeRecordingIdError(runId, 'it is only dots, which is path navigation.');
  }
  if (WINDOWS_RESERVED.has(runId)) {
    throw new UnsafeRecordingIdError(
      runId,
      `'${runId}' is a reserved device name on Windows, with or without an extension.`,
    );
  }
  return `${runId}${ENVELOPE_EXTENSION}`;
}

/** Options for {@link fileRecordingSink}. */
export interface FileRecordingSinkOptions {
  /** The archive directory. Created if missing, parents included. */
  readonly directory: string;
}

/** Process-local, so two sinks in one process cannot pick one tmp name. */
let _tmpSeq = 0;

/**
 * A directory-backed recording sink — one JSON file per run, written atomically.
 *
 * @example
 * ```ts
 * const recorder = recordRun(agent);
 * await agent.run({ message: 'hi' });
 *
 * await persistRecording(recorder, {
 *   sink: fileRecordingSink({ directory: './run-archive' }),
 *   run: { complete: true },
 * });
 * // → ./run-archive/run-1787093273110-1.json
 * ```
 */
export function fileRecordingSink(options: FileRecordingSinkOptions): RecordingSink {
  const directory = options?.directory;
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new TypeError(
      `[recording-sink] fileRecordingSink({ directory: ${JSON.stringify(directory)} }) names no ` +
        `directory. Give it a path — it will be created if it does not exist.`,
    );
  }
  const fs = lazyRequire<FsModule>('node:fs');
  const path = lazyRequire<PathModule>('node:path');
  fs.mkdirSync(directory, { recursive: true });

  return {
    async write(envelope: RecordingEnvelope): Promise<{ id: string; uri?: string }> {
      // Assert the name BEFORE serializing: a refusal should cost nothing, and
      // an id that cannot be filed should not first be turned into megabytes.
      const name = recordingFileName(envelope?.run?.runId);
      const target = path.join(directory, name);

      let text: string;
      try {
        text = `${JSON.stringify(envelope, null, 2)}\n`;
      } catch (cause) {
        // A circular reference or a BigInt inside the recording. Refuse by
        // name: the alternative is a file that exists and is not the run.
        throw new TypeError(
          `[recording-sink] this recording cannot be written as JSON: ${
            cause instanceof Error ? cause.message : String(cause)
          }. A run's state must survive structuredClone to be recorded at all, so this ` +
            `normally means a value was put into state after the run (a circular object, a ` +
            `BigInt). Nothing was written — a partial archive would be worse than none.`,
        );
      }

      // Same directory, so the rename is a same-filesystem move and therefore
      // atomic. `.tmp` can never collide with an archive name: archives always
      // end in `.json`, these always end in `.tmp`.
      const tmp = path.join(directory, `${name}.${String(process.pid)}.${String(++_tmpSeq)}.tmp`);
      try {
        await fs.promises.writeFile(tmp, text, 'utf8');
        await fs.promises.rename(tmp, target);
      } catch (cause) {
        // Leave no half-written debris behind, but never mask the real error.
        await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
        throw cause;
      }

      return { id: name, uri: `file://${path.resolve(target)}` };
    },
  };
}
