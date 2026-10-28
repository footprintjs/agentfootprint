/**
 * outbox — the one owner of buffered, timed, serialized delivery for the
 * batching sinks in this folder: `file`, `cloudwatch` (and `agentcore`, which
 * is built on it) and `xray`.
 *
 * A sink accepts items on its hot path (sync, no I/O) and hands them here. The
 * outbox decides WHEN a batch leaves and makes sure only one leaves at a time:
 *
 *   - **One queue, every trigger.** The size trigger, the timer, `drain()`
 *     (the sink's `flush()`, and so every shutdown) all queue a delivery on
 *     the same promise chain. Nothing calls `deliver` any other way.
 *   - **One delivery in flight.** A delivery starts only after the previous
 *     one settled. A large `fs.promises.appendFile` is several `write()`s; two
 *     of them interleaved tear NDJSON lines (reported in #223, where the timer
 *     bypassed the chain). Whatever a sink does around its write — the file
 *     sink's rotation — runs inside its delivery, so it can never be skipped
 *     or reordered either.
 *   - **Oldest first.** A delivery takes the oldest waiting items, so items
 *     leave in the order they were accepted.
 *   - **`drain()` means drained.** It resolves only when nothing is waiting
 *     AND nothing is in flight. An item accepted while it waits is delivered
 *     by that drain, never left behind it.
 *   - **A failed batch is dropped and reported once**, then the next batch
 *     goes. It is never requeued, so a full disk or an outage cannot grow the
 *     outbox. The queue never rejects: a failure report that itself throws is
 *     said on the console instead of becoming an unhandled rejection.
 *
 * What it does NOT do: bound a delivery that never settles. A hung disk holds
 * the queue, and `drain()` with it. The deadline belongs to the one caller
 * that must finish — `RunnerBase · shutdown` — which stops waiting and names
 * the stuck sink.
 *
 * Role: leaf helper for `adapters/observability/*`. Composed as a field,
 * never inherited.
 */

import { rateLimitedConsoleSink } from './deliveryErrors.js';

/** What a sink tells its outbox. */
export interface OutboxOptions<T> {
  /** The sink's name, for the console line when a failure report throws. */
  readonly name: string;
  /** Size trigger: deliver once this many items wait. */
  readonly maxItems: number;
  /** Size trigger: deliver once this many bytes wait. Omitted → no byte
   *  trigger. */
  readonly maxBytes?: number;
  /** Most items one delivery takes. Omitted → everything waiting. */
  readonly maxItemsPerDelivery?: number;
  /** Timer trigger for sparse traffic, in ms. `0` disables it: only the size
   *  trigger and `drain()` deliver. */
  readonly flushIntervalMs: number;
  /** Does an armed timer keep the process alive? Each sink decides: the file
   *  sink says no (a local write is never worth holding a process open for),
   *  the network sinks say yes (an un-stopped one lingers up to
   *  `flushIntervalMs` so its timer can still ship the tail). */
  readonly timerHoldsProcess: boolean;
  /** Ship one batch. Never called while another call is still in flight. */
  readonly deliver: (batch: readonly T[]) => Promise<void>;
  /** Describe a batch `deliver` failed to ship — the report it is dropped
   *  with. */
  readonly dropped: (batch: readonly T[], cause: unknown) => Error;
  /** Where that report goes. Read at call time by the sink, so a consumer
   *  who assigns `_onError` after construction still receives it. */
  readonly report: (error: Error) => void;
}

/** The three things a sink does with its outbox. */
export interface Outbox<T> {
  /** Accept one item. Sync, never throws, never does I/O. `bytes` counts
   *  toward the byte trigger. Accepting is the SINK's decision — the outbox
   *  takes what it is given, including after `stop()`. */
  add(item: T, bytes?: number): void;
  /** Deliver everything waiting, behind whatever is in flight. Resolves when
   *  nothing waits and nothing is in flight. Never rejects. */
  drain(): Promise<void>;
  /** Cancel the timer and arm no new one. Discards nothing: `drain()`
   *  afterwards still delivers what was accepted. */
  stop(): void;
}

interface Waiting<T> {
  readonly item: T;
  readonly bytes: number;
}

/** Build the outbox one sink owns. */
export function createOutbox<T>(opts: OutboxOptions<T>): Outbox<T> {
  const waiting: Waiting<T>[] = [];
  let waitingBytes = 0;
  // The ONE queue. Every delivery is chained here; `deliverNext` never
  // rejects, so the chain never does either.
  let queue: Promise<void> = Promise.resolve();
  // A delivery is queued and has not started yet. It will take everything
  // waiting when it starts, so another trigger meanwhile has nothing to add.
  let deliveryQueued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const consoleFallback = rateLimitedConsoleSink(opts.name);

  function add(item: T, bytes = 0): void {
    waiting.push({ item, bytes });
    waitingBytes += bytes;
    if (atSizeTrigger()) queueDelivery();
    else armTimer();
  }

  function atSizeTrigger(): boolean {
    if (waiting.length >= opts.maxItems) return true;
    return opts.maxBytes !== undefined && waitingBytes >= opts.maxBytes;
  }

  function armTimer(): void {
    if (timer !== undefined || stopped || opts.flushIntervalMs <= 0) return;
    timer = setTimeout(onTimer, opts.flushIntervalMs);
    // `unref` exists on Node's Timeout and not on a browser's number, so it
    // is feature-detected.
    if (!opts.timerHoldsProcess) (timer as { unref?: () => void }).unref?.();
  }

  function onTimer(): void {
    timer = undefined;
    queueDelivery();
  }

  function queueDelivery(): void {
    if (deliveryQueued) return;
    deliveryQueued = true;
    queue = queue.then(deliverNext);
  }

  async function deliverNext(): Promise<void> {
    deliveryQueued = false;
    const batch = takeOldest();
    if (batch.length === 0) return;
    try {
      await opts.deliver(batch);
    } catch (cause) {
      reportDropped(batch, cause);
    }
    // Items the per-delivery cap left behind were already due when this
    // delivery started — deliver them now rather than on the next timer.
    if (waiting.length > 0 && batch.length === opts.maxItemsPerDelivery) queueDelivery();
  }

  function takeOldest(): T[] {
    const count = Math.min(waiting.length, opts.maxItemsPerDelivery ?? waiting.length);
    const taken = waiting.splice(0, count);
    for (const entry of taken) waitingBytes -= entry.bytes;
    if (waiting.length === 0) waitingBytes = 0;
    return taken.map((entry) => entry.item);
  }

  function reportDropped(batch: readonly T[], cause: unknown): void {
    let error: Error;
    try {
      error = opts.dropped(batch, cause);
    } catch {
      error = new Error(`${batch.length} item(s) dropped: ${messageOf(cause)}`);
    }
    try {
      opts.report(error);
    } catch (hookError) {
      // The consumer's own `onError` threw. Say both things on the console
      // rather than letting the queue reject (an unhandled rejection, which
      // ends a Node process by default).
      consoleFallback(
        new Error(`${error.message} — and the onError hook threw: ${messageOf(hookError)}`),
      );
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const observed = queue;
      await observed;
      // A delivery was queued while we waited: wait for that one too.
      if (observed !== queue) continue;
      // The queue is idle. Done only if nothing is waiting either.
      if (waiting.length === 0) return;
      queueDelivery();
    }
  }

  function stop(): void {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return { add, drain, stop };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
