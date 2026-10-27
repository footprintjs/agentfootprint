import { captureOwn } from './causeCapture.js';
import { storedCauseCancelled, storedCauseOptions } from './storedCauseOptions.js';
import type {
  ReadStoredCauseOptions,
  StoredCauseResult,
  StoredCauseUnknown,
} from './storedCauseTypes.js';

const unknown = (reason: StoredCauseUnknown): StoredCauseResult => ({ status: 'unknown', reason });

/**
 * Admit one host-authorized saved root through the producer's public reader, without a runtime snapshot.
 * Storage acknowledgement is not producer authentication. Missing source ownership remains unknown.
 * Graph projection is capped at 4,096 nodes/commits and uses the producer's 256-level data depth.
 * Cannot preempt a blocking host iterator; cancellation is checked before and after asynchronous admission.
 */
export async function readStoredCauseArtifacts(
  entries: Iterable<unknown>,
  options: ReadStoredCauseOptions,
): Promise<StoredCauseResult> {
  let configured: ReturnType<typeof storedCauseOptions>;
  try {
    configured = storedCauseOptions(options);
    if (storedCauseCancelled(configured.signal)) return unknown('cancelled');
  } catch {
    return unknown('invalid-data');
  }
  if (!globalThis.crypto?.subtle) return unknown('unavailable');
  let reader: typeof import('./storedCauseReader.js')['readStoredCapture'];
  try {
    ({ readStoredCapture: reader } = await import('./storedCauseReader.js'));
  } catch {
    return unknown('unsupported');
  }
  if (storedCauseCancelled(configured.signal)) return unknown('cancelled');
  if (typeof reader !== 'function') return unknown('unsupported');
  try {
    const result = await reader(entries, {
      runId: configured.runId,
      maxBytes: configured.maxBytes,
      ...(configured.readerLimits === undefined ? {} : { limits: configured.readerLimits }),
    });
    if (storedCauseCancelled(configured.signal)) return unknown('cancelled');
    if (captureOwn(result, 'status') !== 'acknowledged') {
      const reason = captureOwn(result, 'reason');
      return unknown(
        reason === 'reader-limit' || reason === 'history-too-large'
          ? 'reader-limit'
          : 'stored-admission',
      );
    }
    const history = captureOwn(result, 'history');
    const { projectStoredCause } = await import('./storedCauseProjection.js');
    if (storedCauseCancelled(configured.signal)) return unknown('cancelled');
    const projected = projectStoredCause(history, configured.runId, configured.maxBytes);
    return storedCauseCancelled(configured.signal) ? unknown('cancelled') : projected;
  } catch {
    return unknown(storedCauseCancelled(configured.signal) ? 'cancelled' : 'unavailable');
  }
}
