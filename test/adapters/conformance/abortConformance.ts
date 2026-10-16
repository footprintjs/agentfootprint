/**
 * THE CANCELLATION CONFORMANCE — the one helper every LLM adapter must pass.
 *
 * The threat is cost and abuse: an aborted or timed-out call that keeps
 * generating keeps billing, and a late answer recorded as a success is billed
 * into the run as if it completed. `lib/abort.ts` states the law; this proves
 * each adapter keeps it, against a transport that IGNORES its signal — the
 * worst case, and the only one in which "the adapter stops" means anything.
 *
 * A rig builds one adapter over a mocked SDK client or `fetch` that:
 *   - records the signal it was handed (SDK request option, `fetch` init),
 *   - counts the requests that reached it,
 *   - for `complete()`, holds its answer until the test calls `release()`,
 *   - for `stream()`, sends one text chunk, then holds the rest until
 *     `release()`, and records whether anything CLOSED the stream (an SDK
 *     stream's own close, its iterator's `return()`, or the body's `cancel()`).
 *
 * A rig made with `{ hangingClose: true }` has a transport whose close (an
 * iterator's `return()`, a body's `cancel()`) never finishes — the case where
 * an abort lands while a consumer that stopped early is still waiting on it.
 *
 * Every case runs against every rig (`abort.conformance.test.ts`), and the
 * listing test there fails while a factory under `src/adapters/llm/` has none.
 * `abort.conformance.dist.test.ts` runs the same cases against the BUILT
 * package, ESM and CJS, so what ships is held to the same law as the source.
 */

import { expect, it } from 'vitest';
import type { LLMChunk, LLMProvider, LLMRequest } from '../../../src/provider-contract/types.js';

export type RigMode = 'complete' | 'stream';

export interface RigOptions {
  /**
   * The transport's close never finishes: an SDK iterator's `return()` and a
   * body's `cancel()` never settle. Where the SDK hands the adapter a close
   * handle of its own (a stream's `abort()`, a controller), only THAT counts
   * as closed — a `return()` still pending has closed nothing.
   */
  readonly hangingClose?: boolean;
}

/** One adapter instance over one mocked transport, for one call. */
export interface AbortRig {
  readonly provider: LLMProvider;
  /** The signal the transport was handed with the last request (undefined: none). */
  readonly signalSeen: () => AbortSignal | undefined;
  /** Requests that reached the transport. */
  readonly dispatched: () => number;
  /** Whether anything closed the transport's stream. */
  readonly closed: () => boolean;
  /**
   * Let the held answer (or the rest of the stream) arrive. `afterDelivery`
   * runs one microtask after the transport hands the rest of a stream over —
   * after the read that carries it has settled, before the adapter's own
   * continuation can run.
   */
  readonly release: (afterDelivery?: () => void) => void;
}

/** One listed adapter: its factory's exported name and how to rig it. */
export interface AdapterRig {
  /** The exported factory this rig builds (`anthropic`, `openai`, …). */
  readonly factory: string;
  /** A label when one factory has more than one rig (a door, an option). */
  readonly variant?: string;
  /** The model the request names. */
  readonly model: string;
  readonly make: (mode: RigMode, options?: RigOptions) => AbortRig;
  /**
   * `false` when the SDK gives the adapter no close handle besides the
   * iterator itself (Bedrock's event stream, Gemini's generator): there the
   * transport is closed by the signal the adapter forwarded to the request.
   */
  readonly closeHandle?: false;
  /**
   * `'none'` only for the mock, which has no wire: nothing can be handed a
   * signal or closed, and nothing arrives late. It proves the rest.
   */
  readonly transport?: 'none';
}

/** A promise the test opens, and the hook a transport calls once it delivered. */
export interface Gate {
  readonly promise: Promise<void>;
  readonly release: (afterDelivery?: () => void) => void;
  /** The transport handed the held data over: run `afterDelivery` one microtask later. */
  readonly delivered: () => void;
}

/** A promise the test opens. */
export function gate(): Gate {
  let open!: () => void;
  let after: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    promise,
    release: (afterDelivery) => {
      after = afterDelivery;
      open();
    },
    delivered: () => {
      const fn = after;
      after = undefined;
      if (fn !== undefined) queueMicrotask(fn);
    },
  };
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * A transport-side stream that sends `first`, then waits for `held` before
 * sending `rest` — ignoring every signal. A hand-written iterator, not a
 * generator, so `return()` lands even while a `next()` is pending. A real SDK
 * generator queues `return()` behind its pending read; there the stop comes
 * from the signal the adapter forwarded, which the cases check separately.
 *
 * The held step is RESOLVED first and `held.delivered()` called after it, so
 * a test's `afterDelivery` lands between the settled read and its reader.
 * With `hangReturn`, `return()` calls `onReturn` and never settles.
 */
export function heldIterable<T>(
  first: readonly T[],
  rest: readonly T[],
  held: Gate,
  onReturn: () => void,
  hangReturn = false,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let i = 0;
      const all = [...first, ...rest];
      const step = (): IteratorResult<T> =>
        i < all.length ? { done: false, value: all[i++] as T } : { done: true, value: undefined };
      return {
        next(): Promise<IteratorResult<T>> {
          if (i < first.length) return Promise.resolve(step());
          return new Promise<IteratorResult<T>>((resolve) => {
            void held.promise.then(() => {
              resolve(step());
              held.delivered();
            });
          });
        },
        return(): Promise<IteratorResult<T>> {
          onReturn();
          if (hangReturn) return never();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

/**
 * A `fetch` double. `complete` mode: the response is held until `release()`.
 * `stream` mode: the response arrives at once with a body that sends `first`
 * and holds `rest`; its `cancel()` is what `closed()` reports.
 */
export function heldFetch(
  mode: RigMode,
  options: RigOptions,
  wire: {
    readonly completeBody: string;
    readonly streamFirst: string;
    readonly streamRest: string;
    readonly streamContentType: string;
  },
): {
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly rig: Omit<AbortRig, 'provider'>;
} {
  const held = gate();
  let signal: AbortSignal | undefined;
  let dispatched = 0;
  let closed = false;
  const encoder = new TextEncoder();
  const fetchDouble = async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    dispatched++;
    signal = init?.signal ?? undefined;
    if (mode === 'complete') {
      await held.promise;
      return new Response(wire.completeBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    let sentRest = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(wire.streamFirst));
      },
      async pull(controller) {
        if (sentRest) return;
        await held.promise;
        if (closed) return;
        sentRest = true;
        controller.enqueue(encoder.encode(wire.streamRest));
        held.delivered();
        controller.close();
      },
      cancel() {
        closed = true;
        if (options.hangingClose === true) return never<void>();
        return undefined;
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': wire.streamContentType },
    });
  };
  return {
    fetch: fetchDouble,
    rig: {
      signalSeen: () => signal,
      dispatched: () => dispatched,
      closed: () => closed,
      release: held.release,
    },
  };
}

/** Let pending promises and macrotasks run until `ready()` holds. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A settled-state probe: has `promise` settled yet? */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  return settled;
}

function requestFor(rig: AdapterRig, signal?: AbortSignal): LLMRequest {
  return {
    model: rig.model,
    messages: [{ role: 'user', content: 'Say hello.' }],
    ...(signal !== undefined && { signal }),
  };
}

/** Pull the first chunk that carries text, so the stream is known to be open. */
async function firstText(iterator: AsyncIterator<LLMChunk>): Promise<LLMChunk> {
  for (;;) {
    const step = await iterator.next();
    if (step.done) throw new Error('the stream ended before its first token');
    if (step.value.content.length > 0) return step.value;
  }
}

/**
 * Register the conformance cases for one adapter rig. Call inside a
 * `describe` named after the adapter.
 */
export function abortConformance(rig: AdapterRig): void {
  const wired = rig.transport !== 'none';

  if (wired) {
    it('complete(): answers when nothing aborts (the rig is a working wire)', async () => {
      const r = rig.make('complete');
      const pending = r.provider.complete(requestFor(rig));
      await until(() => r.dispatched() === 1, 'the request');
      r.release();
      const response = await pending;
      expect(response.content.length).toBeGreaterThan(0);
    });
  }

  it('complete(): an abort ends the call at once with the caller’s reason, though the transport ignores it', async () => {
    const r = rig.make('complete');
    const controller = new AbortController();
    const reason = new Error('caller stopped');
    const pending = r.provider.complete(requestFor(rig, controller.signal));
    pending.catch(() => undefined);
    if (wired) {
      await until(() => r.dispatched() === 1, 'the request');
      // THE SIGNAL REACHES THE REQUEST: the transport was handed a signal,
      // and it fires when the caller's does (the caller's own, or one linked
      // to it and the adapter's deadline).
      const seen = r.signalSeen();
      expect(seen, 'the transport was handed no signal').toBeDefined();
      expect(seen!.aborted).toBe(false);
      controller.abort(reason);
      expect(seen!.aborted).toBe(true);
    } else {
      await new Promise<void>((resolve) => setImmediate(resolve));
      controller.abort(reason);
    }
    // Rejected BEFORE the transport answers — the held answer is never released here.
    expect(await hasSettled(pending)).toBe(true);
    await expect(pending).rejects.toBe(reason);
  });

  if (wired) {
    it('complete(): an answer that lands after the abort is refused, never returned', async () => {
      const r = rig.make('complete');
      const controller = new AbortController();
      const reason = new Error('caller stopped');
      const pending = r.provider.complete(requestFor(rig, controller.signal));
      pending.catch(() => undefined);
      await until(() => r.dispatched() === 1, 'the request');
      // The answer is released first, then the abort fires in the same tick —
      // before any continuation of the adapter could run.
      r.release();
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  }

  it('complete(): an already-aborted signal sends nothing', async () => {
    const r = rig.make('complete');
    const controller = new AbortController();
    const reason = new Error('cancelled before the call');
    controller.abort(reason);
    await expect(r.provider.complete(requestFor(rig, controller.signal))).rejects.toBe(reason);
    expect(r.dispatched()).toBe(0);
  });

  if (wired) {
    it('stream(): streams to its terminal chunk when nothing aborts (the rig is a working wire)', async () => {
      const r = rig.make('stream');
      const chunks: LLMChunk[] = [];
      const iterator = r.provider.stream!(requestFor(rig))[Symbol.asyncIterator]();
      chunks.push(await firstText(iterator));
      r.release();
      for (;;) {
        const step = await iterator.next();
        if (step.done) break;
        chunks.push(step.value);
      }
      const last = chunks[chunks.length - 1]!;
      expect(last.done).toBe(true);
      expect(last.response?.content.length).toBeGreaterThan(0);
    });
  }

  it('stream(): an abort mid-stream ends it at once with the caller’s reason and closes the stream', async () => {
    const r = rig.make('stream');
    const controller = new AbortController();
    const reason = new Error('caller stopped');
    const iterator = r.provider.stream!(requestFor(rig, controller.signal))[Symbol.asyncIterator]();
    await firstText(iterator);
    if (wired) {
      const seen = r.signalSeen();
      expect(seen, 'the transport was handed no signal').toBeDefined();
      expect(seen!.aborted).toBe(false);
    }
    const next = iterator.next();
    next.catch(() => undefined);
    controller.abort(reason);
    if (wired) expect(r.signalSeen()!.aborted).toBe(true);
    // Rejected BEFORE the transport sends the rest — it is never released here.
    expect(await hasSettled(next)).toBe(true);
    await expect(next).rejects.toBe(reason);
    if (wired) expect(r.closed(), 'the transport stream was left open').toBe(true);
    // Nothing more comes out, even once the transport would have sent it.
    r.release();
    const after = await iterator.next().then(
      (step) => step,
      () => ({ done: true, value: undefined } as IteratorResult<LLMChunk>),
    );
    expect(after.done).toBe(true);
  });

  if (wired) {
    it('stream(): a chunk that lands after the abort is refused, never handed on', async () => {
      const r = rig.make('stream');
      const controller = new AbortController();
      const reason = new Error('caller stopped');
      const iterator = r.provider.stream!(requestFor(rig, controller.signal))[
        Symbol.asyncIterator
      ]();
      await firstText(iterator);
      const next = iterator.next();
      next.catch(() => undefined);
      // The rest is released first, then the abort fires in the same tick.
      r.release();
      controller.abort(reason);
      await expect(next).rejects.toBe(reason);
    });
  }

  if (wired) {
    it('stream(): a chunk whose read settled just before the abort is refused, never handed on or billed', async () => {
      const r = rig.make('stream');
      const controller = new AbortController();
      const reason = new Error('caller stopped');
      const iterator = r.provider.stream!(requestFor(rig, controller.signal))[
        Symbol.asyncIterator
      ]();
      await firstText(iterator);
      const next = iterator.next();
      next.catch(() => undefined);
      // The transport's read SETTLES with the rest (its text and the usage);
      // the abort fires one microtask later — after the read, before whoever
      // awaited it has run. What the read carried arrived after the caller
      // stopped: it must not come out.
      r.release(() => controller.abort(reason));
      await expect(next).rejects.toBe(reason);
    });

    it('stream(): an abort while a consumer that stopped early waits on the close rejects with the caller’s reason and closes the transport', async () => {
      const r = rig.make('stream', { hangingClose: true });
      const controller = new AbortController();
      const reason = new Error('caller stopped');
      const iterator = r.provider.stream!(requestFor(rig, controller.signal))[
        Symbol.asyncIterator
      ]();
      await firstText(iterator);
      // The consumer stops early on a live signal: its `return()` waits for
      // the transport's close, as `for await` does — and this transport's
      // close never finishes.
      const closing = iterator.return!();
      closing.catch(() => undefined);
      expect(await hasSettled(closing)).toBe(false);
      controller.abort(reason);
      // The wait ends at once, as the abort — never as a clean finish, which
      // would tell the caller the stream closed when it did not.
      expect(await hasSettled(closing)).toBe(true);
      await expect(closing).rejects.toBe(reason);
      if (rig.closeHandle === false) {
        expect(r.signalSeen()!.aborted, 'the transport’s signal never fired').toBe(true);
      } else {
        expect(r.closed(), 'the transport stream was left open').toBe(true);
      }
    });
  }

  it('stream(): an already-aborted signal sends nothing', async () => {
    const r = rig.make('stream');
    const controller = new AbortController();
    const reason = new Error('cancelled before the call');
    controller.abort(reason);
    const iterator = r.provider.stream!(requestFor(rig, controller.signal))[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(reason);
    expect(r.dispatched()).toBe(0);
  });
}
