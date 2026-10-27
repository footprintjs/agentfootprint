import { ownData } from '../lib/boundedJson.js';
import type { ReadStoredCauseOptions } from './storedCauseTypes.js';

const DEFAULT_READER_LIMITS = Object.freeze({
  entries: 16_384,
  missingCommits: 4096,
  drillDepth: 64,
  addressLength: 2048,
});
const READER_CEILINGS = { ...DEFAULT_READER_LIMITS, entries: 65_536 };
const LIMIT_KEYS = Object.keys(DEFAULT_READER_LIMITS) as (keyof typeof DEFAULT_READER_LIMITS)[];

/** Only the declared host settings; no coercion, getters, inherited overrides or mutable options bag. */
export function storedCauseOptions(
  value: ReadStoredCauseOptions,
): Required<Pick<ReadStoredCauseOptions, 'runId' | 'maxBytes' | 'readerLimits'>> &
  Pick<ReadStoredCauseOptions, 'signal'> {
  const data = ownData(value, ['runId', 'readerLimits', 'maxBytes', 'signal']);
  if (typeof data.runId !== 'string' || data.runId.length === 0 || data.runId.length > 128)
    throw Error('Invalid stored cause options.');
  const maxBytes = data.maxBytes === undefined ? 1024 * 1024 : data.maxBytes;
  if (
    !Number.isSafeInteger(maxBytes) ||
    (maxBytes as number) < 1 ||
    (maxBytes as number) > 8 * 1024 * 1024
  )
    throw Error('Invalid stored cause options.');
  const provided = data.readerLimits === undefined ? {} : ownData(data.readerLimits, LIMIT_KEYS);
  for (const key of LIMIT_KEYS) {
    const limit = provided[key];
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) ||
        (limit as number) < 0 ||
        (limit as number) > READER_CEILINGS[key])
    )
      throw Error('Invalid stored cause options.');
  }
  // Bound the upstream reader before it can allocate gap rows or iterate its very large defaults.
  const limits = {
    ...DEFAULT_READER_LIMITS,
    ...Object.fromEntries(Object.entries(provided).filter(([, limit]) => limit !== undefined)),
  };
  const signal = data.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw Error('Invalid stored cause options.');
  return {
    runId: data.runId,
    maxBytes: maxBytes as number,
    readerLimits: limits,
    ...(signal !== undefined && { signal: signal as AbortSignal }),
  };
}

/** Call the platform getter itself, so a host subclass cannot replace this observation with code. */
export function storedCauseCancelled(signal?: AbortSignal): boolean {
  if (!signal) return false;
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  if (!getter) throw Error('Abort signal observation is unavailable.');
  return getter.call(signal) as boolean;
}
