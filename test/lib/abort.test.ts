/**
 * lib/abort — the one owner of how the library honours a cancellation.
 *
 *   A1 abortErrorOf     — the caller's own reason comes back; a non-Error
 *                         reason becomes an `AbortError` that keeps it
 *   A2 untilAborted     — an abort ends the wait at once; the abandoned work's
 *                         rejection never surfaces; no listener is left behind
 *   A3 eitherSignal     — fires when any source does, with that reason; the
 *                         same signal back when there is only one
 *   A4 linkedController / armDeadline — a run's or a call's links and deadline,
 *                         released when the work settles
 *   A5 withRequestSignal — the SAME request when there is nothing to add
 *   A6 callUnder        — laws 1, 2 and 4 for one call
 *   A7 abortableIterable — law 3: the source is closed, nothing late is handed on
 *   A8 bodyChunks       — the body is cancelled on every way out
 */

import { describe, expect, it, vi } from 'vitest';
import {
  abortErrorOf,
  abortableIterable,
  bodyChunks,
  armDeadline,
  callUnder,
  eitherSignal,
  linkedController,
  throwIfAborted,
  untilAborted,
  withRequestSignal,
} from '../../src/lib/abort.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

describe('A1 abortErrorOf', () => {
  it('hands back the caller’s own Error reason', () => {
    const reason = new Error('user left');
    const c = new AbortController();
    c.abort(reason);
    expect(abortErrorOf(c.signal)).toBe(reason);
  });

  it('turns a non-Error reason into an AbortError that keeps it as cause', () => {
    const c = new AbortController();
    c.abort('stop');
    const err = abortErrorOf(c.signal);
    expect(err.name).toBe('AbortError');
    expect((err as { cause?: unknown }).cause).toBe('stop');
  });

  it('never throws, even on a reason that cannot be inspected (a revoked Proxy)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const c = new AbortController();
    c.abort(proxy);
    const err = abortErrorOf(c.signal);
    expect(err.name).toBe('AbortError');
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });

  it('a wait aborted with such a reason still settles, as an AbortError', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const c = new AbortController();
    const pending = untilAborted(new Promise(() => undefined), c.signal);
    c.abort(proxy);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a bare abort() is the runtime’s AbortError', () => {
    const c = new AbortController();
    c.abort();
    expect(abortErrorOf(c.signal).name).toBe('AbortError');
  });

  it('throwIfAborted throws only once the signal has fired', () => {
    const c = new AbortController();
    expect(() => throwIfAborted(c.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    c.abort(new Error('x'));
    expect(() => throwIfAborted(c.signal)).toThrow('x');
  });
});

describe('A2 untilAborted', () => {
  it('passes the value through when nothing aborts', async () => {
    const c = new AbortController();
    await expect(untilAborted(Promise.resolve(7), c.signal)).resolves.toBe(7);
    await expect(untilAborted(8, undefined)).resolves.toBe(8);
  });

  it('an abort ends a wait that would never end, with the reason', async () => {
    const c = new AbortController();
    const reason = new Error('gone');
    const pending = untilAborted(never(), c.signal);
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('an already-aborted signal rejects at once, and the abandoned work’s rejection is swallowed', async () => {
    const c = new AbortController();
    c.abort(new Error('before'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(untilAborted(Promise.reject(new Error('work')), c.signal)).rejects.toThrow(
        'before',
      );
      await tick();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a wait that settles takes its listener off the signal', async () => {
    const c = new AbortController();
    const add = vi.spyOn(c.signal, 'addEventListener');
    const remove = vi.spyOn(c.signal, 'removeEventListener');
    await untilAborted(Promise.resolve(1), c.signal);
    await untilAborted(Promise.reject(new Error('no')), c.signal).catch(() => undefined);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('A3 eitherSignal', () => {
  it('none → undefined; one (or the same one twice) → that very signal', () => {
    const c = new AbortController();
    expect(eitherSignal()).toBeUndefined();
    expect(eitherSignal(undefined, undefined)).toBeUndefined();
    expect(eitherSignal(c.signal)).toBe(c.signal);
    expect(eitherSignal(c.signal, undefined, c.signal)).toBe(c.signal);
  });

  it('fires when either source fires, with that source’s reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const both = eitherSignal(a.signal, b.signal)!;
    expect(both.aborted).toBe(false);
    const reason = new Error('b fired');
    b.abort(reason);
    expect(both.aborted).toBe(true);
    expect(both.reason).toBe(reason);
  });

  it('is already aborted when a source already is', () => {
    const a = new AbortController();
    const b = new AbortController();
    a.abort(new Error('first'));
    expect(eitherSignal(a.signal, b.signal)!.aborted).toBe(true);
  });

  it('works without AbortSignal.any (the fallback), and lets go of its sources once fired', () => {
    const any = (AbortSignal as { any?: unknown }).any;
    (AbortSignal as { any?: unknown }).any = undefined;
    try {
      const a = new AbortController();
      const b = new AbortController();
      const removeA = vi.spyOn(a.signal, 'removeEventListener');
      const both = eitherSignal(a.signal, b.signal)!;
      const reason = new Error('a fired');
      a.abort(reason);
      expect(both.reason).toBe(reason);
      expect(removeA).toHaveBeenCalled();
    } finally {
      (AbortSignal as { any?: unknown }).any = any;
    }
  });
});

describe('A4 linkedController + armDeadline', () => {
  it('the deadline aborts the controller with its reason after ms, and the disarm stops it', () => {
    vi.useFakeTimers();
    try {
      const reason = new Error('Execution timed out after 50ms');
      const fired = new AbortController();
      armDeadline(fired, 50, () => reason);
      vi.advanceTimersByTime(49);
      expect(fired.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(fired.signal.reason).toBe(reason);

      const released = new AbortController();
      const disarm = armDeadline(released, 50, () => reason);
      disarm();
      vi.advanceTimersByTime(1_000);
      expect(released.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a delay past what a timer holds is held at the maximum, never fired at once', () => {
    vi.useFakeTimers();
    try {
      const c = new AbortController();
      armDeadline(c, 2 ** 40, () => new Error('late'));
      vi.advanceTimersByTime(10);
      expect(c.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows its sources with their reason, and unlink() leaves no listener behind', () => {
    const a = new AbortController();
    const b = new AbortController();
    const add = vi.spyOn(a.signal, 'addEventListener');
    const remove = vi.spyOn(a.signal, 'removeEventListener');
    const { controller, unlink } = linkedController(a.signal, b.signal, undefined);
    const reason = new Error('b fired');
    b.abort(reason);
    expect(controller.signal.reason).toBe(reason);
    unlink();
    // Taken off when b fired (every source at once), and unlink() is idempotent.
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(1);

    const c = new AbortController();
    const removeC = vi.spyOn(c.signal, 'removeEventListener');
    const link = linkedController(c.signal);
    link.unlink();
    expect(removeC).toHaveBeenCalledTimes(1);
    c.abort(new Error('after unlink'));
    expect(link.controller.signal.aborted).toBe(false);
  });

  it('is aborted at once when a source already is', () => {
    const a = new AbortController();
    const reason = new Error('before');
    a.abort(reason);
    expect(linkedController(a.signal).controller.signal.reason).toBe(reason);
  });
});

describe('A5 withRequestSignal', () => {
  it('the SAME request when there is no signal, or it already carries this one', () => {
    const c = new AbortController();
    const bare = { model: 'm' };
    const carrying = { model: 'm', signal: c.signal };
    expect(withRequestSignal(bare, undefined)).toBe(bare);
    expect(withRequestSignal(carrying, c.signal)).toBe(carrying);
  });

  it('adds the signal, and keeps one the request already carried', () => {
    const run = new AbortController();
    const caller = new AbortController();
    const out = withRequestSignal({ model: 'm', signal: caller.signal }, run.signal);
    expect(out.signal!.aborted).toBe(false);
    run.abort(new Error('run'));
    expect(out.signal!.aborted).toBe(true);
    const out2 = withRequestSignal(
      { model: 'm', signal: caller.signal },
      new AbortController().signal,
    );
    caller.abort(new Error('caller'));
    expect(out2.signal!.aborted).toBe(true);
  });
});

describe('A6 callUnder', () => {
  it('hands the call the request WITH the signal', async () => {
    const c = new AbortController();
    const seen: unknown[] = [];
    await callUnder({ model: 'm' }, c.signal, (req) => {
      seen.push(req.signal);
      return 'ok';
    });
    expect(seen).toEqual([c.signal]);
  });

  it('sends nothing on an already-aborted signal', async () => {
    const c = new AbortController();
    const reason = new Error('before');
    c.abort(reason);
    const call = vi.fn();
    await expect(callUnder({ model: 'm' }, c.signal, call)).rejects.toBe(reason);
    expect(call).not.toHaveBeenCalled();
  });

  it('an abort ends a call that ignores its signal', async () => {
    const c = new AbortController();
    const reason = new Error('mid');
    const pending = callUnder({ model: 'm' }, c.signal, () => never<string>());
    await tick();
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('an answer that lands after the abort is refused', async () => {
    const c = new AbortController();
    const reason = new Error('late');
    let answer!: (v: string) => void;
    const pending = callUnder(
      { model: 'm' },
      c.signal,
      () => new Promise<string>((resolve) => (answer = resolve)),
    );
    await tick();
    answer('too late');
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

/** A hand-written source: `return()` lands while a `next()` is pending, as a real SDK stream's does. */
function source(first: readonly number[]) {
  const state = { returned: false, i: 0 };
  const iterable: AsyncIterable<number> = {
    [Symbol.asyncIterator]: () => ({
      next: async () =>
        state.i < first.length
          ? { done: false, value: first[state.i++]! }
          : never<IteratorResult<number>>(),
      return: async () => {
        state.returned = true;
        return { done: true, value: undefined };
      },
    }),
  };
  return { iterable, state };
}

describe('A7 abortableIterable', () => {
  it('no signal → the source itself', () => {
    const { iterable } = source([1]);
    expect(abortableIterable(iterable, undefined)).toBe(iterable);
  });

  it('an abort while a read is pending rejects with the reason and closes the source', async () => {
    const { iterable, state } = source([1]);
    const c = new AbortController();
    const close = vi.fn();
    const it = abortableIterable(iterable, c.signal, close)[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ done: false, value: 1 });
    const pending = it.next();
    const reason = new Error('stop');
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(close).toHaveBeenCalledTimes(1);
    expect(state.returned).toBe(true);
  });

  it('a step that lands after the abort is refused', async () => {
    let deliver!: (v: IteratorResult<number>) => void;
    const iterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<number>>((resolve) => (deliver = resolve)),
      }),
    };
    const c = new AbortController();
    const it = abortableIterable(iterable, c.signal)[Symbol.asyncIterator]();
    const pending = it.next();
    deliver({ done: false, value: 9 });
    const reason = new Error('late');
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('a consumer that stops early closes the source', async () => {
    const { iterable, state } = source([1, 2, 3]);
    const c = new AbortController();
    for await (const n of abortableIterable(iterable, c.signal)) {
      if (n === 1) break;
    }
    expect(state.returned).toBe(true);
  });

  it('an already-aborted signal reads nothing', async () => {
    const { iterable, state } = source([1]);
    const c = new AbortController();
    c.abort(new Error('before'));
    await expect(
      abortableIterable(iterable, c.signal)[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('before');
    expect(state.i).toBe(0);
  });
});

describe('A8 bodyChunks', () => {
  function body(chunks: readonly string[], hold: boolean) {
    const state = { cancelled: false };
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        if (!hold) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { stream, state };
  }

  it('reads every chunk to the end', async () => {
    const { stream } = body(['a', 'b'], false);
    const dec = new TextDecoder();
    let text = '';
    for await (const v of bodyChunks(stream, undefined)) text += dec.decode(v);
    expect(text).toBe('ab');
  });

  it('an abort while the body is open rejects with the reason and cancels the body', async () => {
    const { stream, state } = body(['a'], true);
    const c = new AbortController();
    const it = bodyChunks(stream, c.signal);
    await it.next();
    const pending = it.next();
    const reason = new Error('stop');
    c.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await tick();
    expect(state.cancelled).toBe(true);
  });

  it('a consumer that stops early cancels the body', async () => {
    const { stream, state } = body(['a', 'b'], true);
    for await (const _ of bodyChunks(stream, undefined)) break;
    expect(state.cancelled).toBe(true);
  });
});
