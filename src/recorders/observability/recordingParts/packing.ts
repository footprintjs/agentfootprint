/**
 * recordingParts/packing — each part packed on its own, with the recording codec.
 *
 * `packRecording` and `unpackRecording` are typed to a whole recording, but
 * the codec never reads a recording's own fields: it pools repeated values in
 * any JSON value and expands them within `maxBytes`. A part is not a whole
 * recording, so these two adapters only widen the type, in one place, rather
 * than restating the codec. One value table per part is what lets any part be
 * read without the others.
 */

import type { Recording } from '../recordRun.js';
import { packRecording, unpackRecording, type PackedRecording } from '../recordingPack.js';

/** Pack one part's payload. */
export function packPart(payload: unknown): PackedRecording {
  return packRecording(payload as Recording);
}

/**
 * Expand one packed part, refusing before expansion when its plain form is over
 * `maxBytes` (`PackedRecordingTooLargeError`).
 */
export function unpackPart(packed: unknown, maxBytes: number): unknown {
  return unpackRecording(packed, { maxBytes }) as unknown;
}
