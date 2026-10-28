/**
 * outbox — the one owner of buffered, timed, serialized delivery for the
 * batching sinks in this folder: `file`, `cloudwatch` (and `agentcore`, which
 * is built on it) and `xray`.
 *
 * A sink accepts items on its hot path (sync, no I/O) and hands them here. The
 * outbox decides WHEN a batch leaves and makes sure only one leaves at a time:
 *
 *   - **One queue, every trigger.** The size trigger, the timer and `drain()`
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
 *   - **`drain()` is bounded.** It resolves once every item accepted BEFORE
 *     the call has settled (delivered, or dropped and reported), one the timer
 *     already had in flight included — then makes one sweep of what arrived
 *     while it waited. It never chases a producer that keeps emitting: under
 *     steady traffic it ends after about two deliveries.
 *   - **A failed batch is dropped and reported once**, then the next batch
 *     goes. It is never requeued, so a full disk or an outage cannot grow the
 *     outbox. The queue never rejects: a failure report that itself throws is
 *     said on the console instead of becoming an unhandled rejection.
 *
 * What it does NOT do: bound a delivery that never settles. A hung disk holds
 * the queue, and `drain()` with it; nothing can cancel an in-flight write.
 *
 * Role: leaf helper for `adapters/observability/*`. Composed as a field,
 * never inherited.
 */

import { rateLimitedConsoleSink } from './deliveryErrors.js';

/** What a sink tells its outbox. */
export interface OutboxOptions<T> {
  /** The sink's name: it prefixes a refused option and the console line when
   *  a failure report throws. */
  readonly name: string;
  /** Size trigger: deliver once this many items wait. A positive integer. */
  readonly maxItems: number;
  /** Size trigger: deliver once this many bytes wait. Omitted → no byte
   *  trigger. */
  readonly maxBytes?: number;
  /** Most items one delivery takes. A positive integer; omitted → everything
   *  waiting. */
  readonly maxItemsPerDelivery?: number;
  /** What the sink's caller calls those two counts, so a refusal names the
   *  option they actually wrote (`maxBufferEvents`, not `maxItems`). */
  readonly optionNames?: {
    readonly maxItems?: string;
    readonly maxItemsPerDelivery?: string;
  };
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
  /** Settle everything accepted before this call — behind whatever is in
   *  flight — then sweep once what arrived meanwhile. Never rejects. */
  drain(): Promise<void>;
  /** Cancel the timer and arm no new one. Discards nothing: `drain()`
   *  afterwards still delivers what was accepted. */
  stop(): void;
}

interface Waiting<T> {
  readonly item: T;
  readonly bytes: number;
}

/** Build the outbox one sink owns. Refuses, by the sink's name, a count that
 *  is not a positive integer: a delivery that may take zero items can never
 *  finish a drain. */
export function createOutbox<T>(opts: OutboxOptions<T>): Outbox<T> {
  const names = opts.optionNames;
  requirePositiveInteger(opts.name, names?.maxItems ?? 'maxItems', opts.maxItems);
  if (opts.maxItemsPerDelivery !== undefined) {
    requirePositiveInteger(
      opts.name,
      names?.maxItemsPerDelivery ?? 'maxItemsPerDelivery',
      opts.maxItemsPerDelivery,
    );
  }

  const waiting: Waiting<T>[] = [];
  let waitingBytes = 0;
  // Running counts. Deliveries take the oldest items, one delivery at a time,
  // so once `settled` reaches n the first n accepted items are done.
  let accepted = 0; // handed to `add`
  let taken = 0; // taken by a delivery (in flight or settled)
  let settled = 0; // delivered, or dropped and reported
  // The ONE queue. Every delivery is chained here; `deliverNext` never
  // rejects, so the chain never does either.
  let queue: Promise<void> = Promise.resolve();
  // A delivery is queued and has not started yet. It will take everything
  // waiting when it starts, so another trigger meanwhile has nothing to add —
  // and the chain cannot grow while a delivery hangs.
  let deliveryQueued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const consoleFallback = rateLimitedConsoleSink(opts.name);

  function add(item: T, bytes = 0): void {
    waiting.push({ item, bytes });
    waitingBytes += bytes;
    accepted++;
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
    settled += batch.length;
    // Items the per-delivery cap left behind were already due when this
    // delivery started — deliver them now rather than on the next timer.
    if (waiting.length > 0 && batch.length === opts.maxItemsPerDelivery) queueDelivery();
  }

  function takeOldest(): T[] {
    const count = Math.min(waiting.length, opts.maxItemsPerDelivery ?? waiting.length);
    const batch = waiting.splice(0, count);
    for (const entry of batch) waitingBytes -= entry.bytes;
    if (waiting.length === 0) waitingBytes = 0;
    taken += batch.length;
    return batch.map((entry) => entry.item);
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
    // Everything accepted before this call, in flight or waiting…
    await settleThrough(accepted);
    // …then ONE sweep of what arrived while it waited, so a `stop()` right
    // after `flush()` strands nothing that was already here. The target is
    // fixed when the sweep starts, so steady traffic cannot keep it going.
    await settleThrough(accepted);
  }

  /** Wait until the first `target` accepted items have settled. */
  async function settleThrough(target: number): Promise<void> {
    while (settled < target) {
      const before = settled;
      // Some of them still wait: make sure a delivery will take them.
      if (taken < target) queueDelivery();
      await queue;
      // A pass that settled nothing would repeat forever. With the counts
      // refused above it cannot happen; if it ever does, end — never spin.
      if (settled === before) return;
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

/** A count that decides how much a delivery takes must be a whole number
 *  above zero. Refused at construction, where the caller still reads it. */
function requirePositiveInteger(name: string, option: string, value: number): void {
  if (Number.isInteger(value) && value > 0) return;
  const got = String(value);
  throw new TypeError(
    `[${name}Observability] \`${option}\` must be a positive whole number (got ${got}). ` +
      'Use 1 to deliver every item as soon as it arrives.',
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
