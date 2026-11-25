/**
 * recordingParts/splitError — why a recording could not be split into parts.
 *
 * A fixed code and, past a bound, which bound. The message is a fixed
 * sentence: it never quotes a key, a name or a recorded value, so a caller can
 * put it on a record that other people read.
 */

/** Why a split was refused. */
export type RecordingSplitErrorCode = 'not-a-recording' | 'unserializable' | 'over-limit';

/** Which bound an `over-limit` split passed. */
export type RecordingSplitLimit = 'invocations' | 'parts' | 'index' | 'path' | 'tree' | 'name';

const SENTENCES: Readonly<Record<RecordingSplitErrorCode, string>> = {
  'not-a-recording':
    'The value is not a recording: it needs an events array, and a snapshot whose subflowResults, when present, is an object.',
  unserializable: 'The recording could not be written as JSON.',
  'over-limit': 'The recording is larger than a saved recording in parts may be',
};

/** Raised by the split: nothing is stored for a recording it refuses. */
export class RecordingSplitError extends Error {
  readonly code: RecordingSplitErrorCode;
  readonly limit?: RecordingSplitLimit;

  constructor(code: RecordingSplitErrorCode, limit?: RecordingSplitLimit) {
    super(
      code === 'over-limit' && limit !== undefined
        ? `${SENTENCES[code]} (limit: ${limit}).`
        : SENTENCES[code],
    );
    this.name = 'RecordingSplitError';
    this.code = code;
    if (limit !== undefined) this.limit = limit;
  }
}
