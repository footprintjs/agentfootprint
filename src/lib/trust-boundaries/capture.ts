import type { Unsubscribe } from '../../events/dispatcher.js';
import { projectTrustBoundary } from './project.js';
import type {
  TrustBoundaryCounters,
  TrustBoundaryFact,
  TrustBoundaryRecorder,
  TrustBoundaryRecorderOptions,
} from './types.js';

let recorderSequence = 0;
let captureSequence = 0;
interface CaptureEpoch {
  readonly id: string;
  readonly ring: Array<TrustBoundaryFact | undefined>;
  head: number;
  size: number;
  observed: number;
  evicted: number;
  invalid: number;
  oversized: number;
  pending: number;
}

function newEpoch(capacity: number): CaptureEpoch {
  return {
    id: `trust-capture-${Date.now()}-${++captureSequence}`,
    ring: new Array(capacity),
    head: 0,
    size: 0,
    observed: 0,
    evicted: 0,
    invalid: 0,
    oversized: 0,
    pending: 0,
  };
}

function counters(epoch: CaptureEpoch): TrustBoundaryCounters {
  return Object.freeze({
    observed: epoch.observed,
    retained: epoch.size,
    evicted: epoch.evicted,
    invalid: epoch.invalid,
    oversized: epoch.oversized,
    pending: epoch.pending,
  });
}

/** O(1) ordinary append; bounded owned-row insertion for reentrant completion. */
function retain(epoch: CaptureEpoch, fact: TrustBoundaryFact): void {
  const capacity = epoch.ring.length;
  const last = epoch.ring[(epoch.head + epoch.size - 1 + capacity) % capacity];
  if (epoch.size === 0 || (last !== undefined && last.seq < fact.seq)) {
    if (epoch.size === capacity) {
      epoch.ring[epoch.head] = fact;
      epoch.head = (epoch.head + 1) % capacity;
      epoch.evicted++;
    } else {
      epoch.ring[(epoch.head + epoch.size) % capacity] = fact;
      epoch.size++;
    }
    return;
  }
  // A metadata Proxy can synchronously dispatch a later observation before
  // this one completes. Retain by reserved ordinal, never completion order.
  if (epoch.size === capacity) {
    const first = epoch.ring[epoch.head];
    epoch.evicted++;
    if (first !== undefined && fact.seq < first.seq) return;
    epoch.head = (epoch.head + 1) % capacity;
    epoch.size--;
  }
  let index = epoch.size;
  while (index > 0) {
    const previous = epoch.ring[(epoch.head + index - 1) % capacity];
    if (previous === undefined || previous.seq < fact.seq) break;
    epoch.ring[(epoch.head + index) % capacity] = previous;
    index--;
  }
  epoch.ring[(epoch.head + index) % capacity] = fact;
  epoch.size++;
}

/**
 * Capture actual typed security facts in a bounded, metadata-only tail.
 * Subscribe before execution; this observer cannot reconstruct missed facts.
 */
export function trustBoundaryRecorder(
  options: TrustBoundaryRecorderOptions = {},
): TrustBoundaryRecorder {
  const maxFacts = options.maxFacts ?? 1000;
  if (!Number.isSafeInteger(maxFacts) || maxFacts < 1 || maxFacts > 10000) {
    throw new RangeError('trustBoundaryRecorder: maxFacts must be an integer from 1 to 10000');
  }
  const id = options.id ?? `trust-boundaries-${++recorderSequence}`;
  if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
    throw new TypeError('trustBoundaryRecorder: id must contain 1 to 512 characters');
  }
  let epoch = newEpoch(maxFacts);
  let active: object | undefined;
  return {
    id,
    get counters() {
      return counters(epoch);
    },
    subscribe(source): Unsubscribe {
      if (active !== undefined) throw new Error('trustBoundaryRecorder: already subscribed');
      const token = {};
      active = token;
      let off: Unsubscribe;
      try {
        off = source.on('*', (event) => {
          if (active !== token) return;
          const owner = epoch;
          let reserved = false;
          const result = projectTrustBoundary(event, () => {
            if (epoch !== owner || active !== token) return undefined;
            reserved = true;
            owner.pending++;
            return ++owner.observed;
          });
          if (!reserved) return;
          owner.pending--;
          // Reset creates a new owner; an old observation cannot enter it.
          if (epoch !== owner) return;
          if (result.status === 'invalid') owner.invalid++;
          else if (result.status === 'oversized') owner.oversized++;
          else if (result.status === 'fact') retain(owner, result.fact);
        });
        if (typeof off !== 'function')
          throw new TypeError('trustBoundaryRecorder: source.on must return unsubscribe');
      } catch (error) {
        if (active === token) active = undefined;
        throw error;
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        if (active === token) active = undefined;
        off();
      };
    },
    toSnapshot() {
      const facts: TrustBoundaryFact[] = [];
      for (let i = 0; i < epoch.size; i++) {
        const fact = epoch.ring[(epoch.head + i) % maxFacts];
        if (fact !== undefined) facts.push(fact);
      }
      return Object.freeze({
        name: 'TrustBoundaries' as const,
        description:
          'Observed middleware, permission and credential metadata; not proof of execution or complete coverage.',
        meta: Object.freeze({ version: 1 as const }),
        data: Object.freeze({
          captureId: epoch.id,
          facts: Object.freeze(facts),
          counters: counters(epoch),
          firstObservedSeq: epoch.observed ? 1 : null,
          lastObservedSeq: epoch.observed || null,
          firstRetainedSeq: facts[0]?.seq ?? null,
          lastRetainedSeq: facts[facts.length - 1]?.seq ?? null,
        }),
      });
    },
    resetCapture() {
      epoch = newEpoch(maxFacts);
    },
  };
}
