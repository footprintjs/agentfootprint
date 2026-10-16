/**
 * abort — the ONE owner of how the library honours a cancellation.
 *
 * Pattern: Small pure helpers over `AbortSignal`. No state between calls.
 * Role:    Leaf. Every provider adapter, the provider decorators and the
 *          agent's own provider calls stop through these, so "the caller
 *          cancelled" means the same thing at every layer. Two adapters
 *          (Ollama, Foundry Local) each kept a private copy of the first
 *          three helpers and the classifier kept a third; most adapters kept
 *          none, and an aborted run left their remote calls running — and
 *          billing. `test/architecture/abortOwner.test.ts` refuses a fourth.
 * Emits:   N/A.
 *
 * ── THE LAW ──────────────────────────────────────────────────────────────
 * Once a request's signal has fired:
 *   1. nothing more is SENT — `throwIfAborted` before every dispatch, because
 *      an already-aborted signal never dispatches another 'abort' event, so a
 *      listener alone cannot see it;
 *   2. nothing more is WAITED FOR — `untilAborted` races every wait (the
 *      response, a body read, a stream's next chunk) against the signal, so a
 *      transport that ignores its signal still cannot hold the call open;
 *   3. nothing more is READ — `abortableIterable` closes the source (its
 *      iterator's `return()`, plus the caller's own `close`, e.g. an SDK
 *      stream's `abort()`), so the socket is released and the server stops
 *      generating for nobody;
 *   4. nothing that arrives LATE counts — a response or chunk that lands after
 *      the abort is refused with the abort, never returned as a success, so it
 *      cannot be recorded as an answer or billed into a run's usage. "After"
 *      means after the abort was SEEN: a read that settled a moment before the
 *      abort, but whose reader had not yet run, is refused too — the signal is
 *      checked again after every wait, not only raced during it.
 *
 * And a CLOSE is a wait like any other: a consumer that stops early waits for
 * the transport to finish closing while the signal is live; once it fires,
 * that wait ends with the abort (never as a clean finish — the stream did not
 * close) and the caller's own close runs, so the transport is shut either way.
 *
 * ── WHAT AN ABORT REACHES THE CALLER AS ──────────────────────────────────
 * The signal's own `reason` when it is an `Error` — what every runtime
 * supplies (a `DOMException` named 'AbortError', or 'TimeoutError' for
 * `AbortSignal.timeout`), and what a caller who passed their own reason
 * expects back. Anything else becomes an `Error` named 'AbortError' that keeps
 * the reason as `cause`. An abort is the caller's word: it is never dressed up
 * as a provider failure, never retried, never fallen back from.
 */

/**
 * The error an aborted wait rejects with. See the module notes.
 *
 * Never throws. A reason that cannot even be classified (a revoked `Proxy`,
 * one whose `getPrototypeOf` throws) becomes a plain `AbortError` WITHOUT it:
 * this runs inside abort listeners, where a throw would escape as an uncaught
 * exception and leave the wait it should end unsettled.
 */
export function abortErrorOf(signal: AbortSignal): Error {
  let reason: unknown;
  try {
    reason = signal.reason;
    if (reason instanceof Error) return reason;
  } catch {
    return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  }
  return Object.assign(new Error('This operation was aborted'), {
    name: 'AbortError',
    ...(reason !== undefined && { cause: reason }),
  });
}

/** Stop right here when `signal` has already fired. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortErrorOf(signal);
}

/**
 * `pending`, except that an abort ends the wait at once — with the abort,
 * whatever `pending` later does. The abandoned promise's own rejection is
 * swallowed, so the work given up on never surfaces as an unhandled rejection.
 * With no signal, `pending` itself.
 */
export function untilAborted<T>(
  pending: T | PromiseLike<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return Promise.resolve(pending);
  if (signal.aborted) {
    Promise.resolve(pending).catch(() => undefined);
    return Promise.reject(abortErrorOf(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortErrorOf(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(pending).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * A signal that fires when ANY of `signals` does, with that signal's reason.
 * `undefined` when none is given, the one signal itself when only one is.
 *
 * `AbortSignal.any` where the runtime has it (Node 20.3+, every current
 * browser): it holds its sources weakly, so a long-lived signal combined into
 * every call does not collect a listener per call. The fallback (an older
 * browser) listens until the first source fires, so the library's hot paths do
 * not lean on it: a run's signal and a call's deadline are combined with
 * {@link linkedController}, whose links end with the run or the call.
 */
export function eitherSignal(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const sources = [...new Set(signals.filter((s): s is AbortSignal => s !== undefined))];
  if (sources.length === 0) return undefined;
  if (sources.length === 1) return sources[0];
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any.call(AbortSignal, sources);
  const controller = new AbortController();
  const fired = sources.find((s) => s.aborted);
  if (fired !== undefined) {
    controller.abort(fired.reason);
    return controller.signal;
  }
  const onAbort = (event: Event): void => {
    for (const s of sources) s.removeEventListener('abort', onAbort);
    controller.abort((event.target as AbortSignal).reason);
  };
  for (const s of sources) s.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/** The longest delay a platform timer holds; Node turns a longer one into 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * A controller of the caller's own, following `sources` until `unlink()` —
 * for work that must be cancellable by the caller's signals AND by itself (a
 * deadline), for exactly that work's lifetime. Aborted at once when a source
 * already has; aborted with a source's reason when one fires; `unlink()` takes
 * every listener off the sources, so nothing outlives the work on a
 * long-lived signal. Idempotent.
 */
export function linkedController(...sources: readonly (AbortSignal | undefined)[]): {
  readonly controller: AbortController;
  readonly unlink: () => void;
} {
  const controller = new AbortController();
  const linked = [...new Set(sources.filter((s): s is AbortSignal => s !== undefined))];
  const fired = linked.find((s) => s.aborted);
  if (fired !== undefined) {
    controller.abort(fired.reason);
    return { controller, unlink: () => undefined };
  }
  const unlink = (): void => {
    for (const s of linked) s.removeEventListener('abort', onAbort);
  };
  const onAbort = (event: Event): void => {
    unlink();
    controller.abort((event.target as AbortSignal).reason);
  };
  for (const s of linked) s.addEventListener('abort', onAbort, { once: true });
  return { controller, unlink };
}

/**
 * Abort `controller` with `reason()` once `ms` have passed — a DEADLINE, not a
 * wait (`sleep.ts` owns waits). Returns the disarm: a deadline is released
 * when the work it bounds settles, as the engine releases its own, so it never
 * fires on work that already finished. A delay past what a timer holds
 * (2^31 − 1 ms, about 24.8 days) is held at that maximum rather than firing at
 * once.
 *
 * The timer is NOT `unref`'d, exactly like the engine's: while the work it
 * bounds is pending it keeps the process alive, so a stage that hangs on work
 * holding no handle of its own still gets its timeout instead of a process
 * that exits with the run never settled. The disarm is what lets it go.
 */
export function armDeadline(
  controller: AbortController,
  ms: number,
  reason: () => unknown,
): () => void {
  const timer = setTimeout(
    () => controller.abort(reason()),
    Math.min(Math.max(ms, 0), MAX_TIMER_MS),
  );
  return () => clearTimeout(timer);
}

/**
 * `request` carrying `signal` as well as any signal it already carried — the
 * SAME object when there is nothing to add. Every place the library hands a
 * request to a provider stamps the run's signal through here.
 */
export function withRequestSignal<R extends { readonly signal?: AbortSignal }>(
  request: R,
  signal: AbortSignal | undefined,
): R {
  if (signal === undefined || request.signal === signal) return request;
  return { ...request, signal: eitherSignal(request.signal, signal) };
}

/**
 * One non-streaming call under `signal` — the four laws in one place, for the
 * library's own provider calls (the agent, `LLMCall`, the summarizers, the
 * extractors, the gates): refused before it is sent when the signal has
 * already fired, handed the request WITH the signal so the provider can cancel
 * its own request, raced so an adapter that ignores it cannot hold the caller,
 * and refused when its answer lands after the abort — so a late answer is
 * never recorded or billed as if the call had completed.
 */
export function callUnder<R extends { readonly signal?: AbortSignal }, T>(
  request: R,
  signal: AbortSignal | undefined,
  call: (request: R) => T | PromiseLike<T>,
): Promise<T> {
  return awaitUnder(signal, () => call(withRequestSignal(request, signal)));
}

/**
 * Laws 1, 2 and 4 for one piece of work that cannot be handed the signal (a
 * callback with no signal in its contract): not started when the signal has
 * already fired, not waited for once it fires, and refused when it lands after.
 */
export async function awaitUnder<T>(
  signal: AbortSignal | undefined,
  start: () => T | PromiseLike<T>,
): Promise<T> {
  throwIfAborted(signal);
  const answer = await untilAborted(start(), signal);
  throwIfAborted(signal);
  return answer;
}

/**
 * Iterate `source` under `signal` — laws 2, 3 and 4 for a stream. With no
 * signal, `source` itself.
 *
 * Each `next()` is raced against the signal; on abort the source is CLOSED —
 * `close()` first (an SDK stream's `abort()`, a body reader's `cancel()`),
 * then its iterator's `return()` — and the iteration rejects with the abort. A
 * step that lands after the abort is refused, never handed on. A consumer that
 * stops early (`break`, a throw) on a live signal closes the source as
 * `for await` does — its `return()` waited for, its errors propagated; an
 * abort during that wait ends it with the abort and runs `close()`, so the
 * transport is closed even when its `return()` never finishes.
 *
 * The source's `return()` is NOT awaited: a source suspended inside its own
 * await (a read the transport will never answer) cannot finish returning, and
 * waiting for it would re-create the hang this exists to end.
 */
export function abortableIterable<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
  close?: () => unknown,
): AsyncIterable<T> {
  if (signal === undefined) return source;
  const watched = signal;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const it = source[Symbol.asyncIterator]();
      let shut = false;
      const closeSource = (): void => {
        if (shut) return;
        shut = true;
        settleQuietly(() => close?.());
        settleQuietly(() => it.return?.());
      };
      const refuse = (): never => {
        closeSource();
        throw abortErrorOf(watched);
      };
      return {
        async next(): Promise<IteratorResult<T>> {
          if (watched.aborted) refuse();
          let step: IteratorResult<T>;
          try {
            step = await untilAborted(it.next(), watched);
          } catch (err) {
            if (watched.aborted) refuse();
            throw err;
          }
          if (watched.aborted) refuse();
          if (step.done) shut = true;
          return step;
        },
        async return(value?: unknown): Promise<IteratorResult<T>> {
          // A consumer that stops early on a live signal closes the source
          // the way `for await` always did: waited for, its errors its own.
          // Once the signal fires — before or DURING that wait — the close is
          // not waited for: the caller's `close()` shuts the transport (its
          // `return()` was already asked) and the abort is what comes back.
          if (!shut && !watched.aborted) {
            shut = true;
            try {
              await untilAborted(it.return?.(value), watched);
            } catch (err) {
              if (!watched.aborted) throw err;
            }
            if (watched.aborted) {
              settleQuietly(() => close?.());
              throw abortErrorOf(watched);
            }
            return { done: true, value: value as T };
          }
          closeSource();
          return { done: true, value: value as T };
        },
      };
    },
  };
}

/**
 * The chunks of a fetch body, read under `signal` — the raw-`fetch` adapters'
 * one reader. Each read is raced against the signal and the signal checked
 * again once it settles, so a chunk read a moment before the abort is never
 * handed on. The body is CANCELLED on every way out (the end, a consumer that
 * stops early, an error, an abort): an open body is a socket held and, on a
 * local model, a generation that keeps running for nobody. A cancel waited on
 * by a consumer that stopped early ends with the abort if one fires during it.
 */
export async function* bodyChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await untilAborted(reader.read(), signal);
      throwIfAborted(signal);
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    // Not waited for once aborted — before the cancel or during it: a reader
    // whose transport ignores the abort may never settle its cancel, and the
    // caller is owed the abort now.
    const cancelled = reader.cancel().catch(() => undefined);
    try {
      // Only an abort that lands DURING the wait is thrown here: one that
      // fired before it is already the error on its way out (or a consumer
      // that broke after aborting, which exits cleanly, as abortableIterable).
      if (!signal?.aborted) {
        await untilAborted(cancelled, signal);
        throwIfAborted(signal);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* a lock the runtime already dropped, or a read still pending */
      }
    }
  }
}

/** Run `fn`, swallowing a throw AND a rejected promise it returns. */
function settleQuietly(fn: () => unknown): void {
  try {
    const out = fn();
    if (out !== null && typeof out === 'object' && 'then' in out) {
      Promise.resolve(out as PromiseLike<unknown>).catch(() => undefined);
    }
  } catch {
    /* closing is best-effort: the abort is what the caller is owed */
  }
}
