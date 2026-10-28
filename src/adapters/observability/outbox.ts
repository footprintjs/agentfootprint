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
 *     or reordered either. This keeps ONE sink's deliveries from interleaving;
 *     it does not make a delivery atomic (a disk that fails partway through an
 *     append can still leave part of it behind).
 *   - **Oldest first, within the receiver's limits.** A delivery takes the
 *     oldest waiting items, so items leave in the order they were accepted.
 *     When a receiving service limits one request (`maxItemsPerDelivery`,
 *     `maxBytesPerDelivery` — CloudWatch's PutLogEvents), a delivery takes
 *     only the oldest items that fit, and the rest go in the next delivery,
 *     right after. That matters BECAUSE of the queue: a slow delivery lets a
 *     backlog build behind it, which one request may not be allowed to carry.
 *     Each part settles on its own — shipped, or dropped and reported.
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
  /** Size trigger: deliver once `waiting >= maxItems`. Compared as given —
   *  the meaning each sink's option had before the outbox, so no value that
   *  worked is refused: `0` or a negative number triggers on every item,
   *  `2.5` on the third, `NaN` or `Infinity` never (then only the byte
   *  trigger, the timer and `drain()` deliver). It never limits what a
   *  delivery takes. */
  readonly maxItems: number;
  /** Size trigger: deliver once `waitingBytes >= maxBytes`, compared as
   *  given. Omitted → no byte trigger. */
  readonly maxBytes?: number;
  /** Most items one delivery takes: a positive whole number — a sink maps its
   *  own option to one first, and refuses by its own name what cannot map.
   *  Omitted → everything waiting. */
  readonly maxItemsPerDelivery?: number;
  /** Most bytes one delivery may carry, as the receiving service counts them:
   *  for each item, the `bytes` it was added with plus `overheadBytesPerItem`.
   *  A delivery always takes at least one item, so an item too large for any
   *  delivery still goes — alone — and the service's answer decides it.
   *  Omitted → no byte limit. */
  readonly maxBytesPerDelivery?: number;
  /** Bytes the receiving service adds to each item it counts (CloudWatch
   *  Logs: 26 per event). Default 0. */
  readonly overheadBytesPerItem?: number;
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

/** Build the outbox one sink owns. A per-delivery cap that could take
 *  nothing is refused: such a delivery could never finish a drain. */
export function createOutbox<T>(opts: OutboxOptions<T>): Outbox<T> {
  if (opts.maxItemsPerDelivery !== undefined) {
    requireDeliveryCap(opts.name, opts.maxItemsPerDelivery);
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
    const { batch, leftBehind } = takeOldest();
    if (batch.length === 0) return;
    try {
      await opts.deliver(batch);
    } catch (cause) {
      reportDropped(batch, cause);
    }
    // Settled exactly once, whatever happened to the deliveries around it.
    settled += batch.length;
    // Items a per-delivery limit left behind were already due when this
    // delivery started — deliver them now rather than on the next timer.
    if (leftBehind) queueDelivery();
  }

  /** Take the oldest waiting items one delivery may carry. `leftBehind` says
   *  a per-delivery limit stopped the take with items still waiting. */
  function takeOldest(): { readonly batch: T[]; readonly leftBehind: boolean } {
    const entries = waiting.splice(0, countForOneDelivery());
    for (const entry of entries) waitingBytes -= entry.bytes;
    if (waiting.length === 0) waitingBytes = 0;
    taken += entries.length;
    return { batch: entries.map((entry) => entry.item), leftBehind: waiting.length > 0 };
  }

  /** How many of the oldest waiting items fit one delivery: at least one,
   *  then as many as the item and byte limits allow, in order. */
  function countForOneDelivery(): number {
    const most = Math.min(waiting.length, opts.maxItemsPerDelivery ?? waiting.length);
    const byteLimit = opts.maxBytesPerDelivery;
    if (byteLimit === undefined) return most;
    const overhead = opts.overheadBytesPerItem ?? 0;
    let count = 0;
    let bytes = 0;
    while (count < most) {
      const entry = waiting[count];
      if (entry === undefined) break;
      const cost = entry.bytes + overhead;
      if (count > 0 && bytes + cost > byteLimit) break;
      bytes += cost;
      count++;
    }
    return count;
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
      // A pass that settled nothing would repeat forever. With the cap
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

/** The sink-to-outbox contract: a cap is a whole number above zero. Sinks
 *  map and refuse their own options first (X-Ray: `segmentsPerPut`), so this
 *  guards the contract rather than a caller's input. */
function requireDeliveryCap(name: string, cap: number): void {
  if (Number.isInteger(cap) && cap > 0) return;
  throw new TypeError(
    `[${name}Observability] the outbox was given a per-delivery cap of ${String(cap)}; ` +
      `a delivery that may take no items could never finish a drain.`,
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
