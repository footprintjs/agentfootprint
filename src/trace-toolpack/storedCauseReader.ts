import type { readStoredCapture as DeclaredReader } from 'footprintjs/trace';

// Older supported producers lack this optional reader. A named value import would
// break browser linking even when unused; the named type still checks ownership.
// The architecture test pins this exception to this one reader and public door.
// eslint-disable-next-line no-restricted-syntax -- Optional reader; test/architecture/storedCauseReader.test.ts guards this single boundary.
import * as producer from 'footprintjs/trace';

const candidate: unknown = Reflect.get(producer, 'readStoredCapture');

/** The public reader when present; absent exports stay unsupported without a linking failure. */
export const readStoredCapture: typeof DeclaredReader | undefined =
  typeof candidate === 'function' ? (candidate as typeof DeclaredReader) : undefined;
