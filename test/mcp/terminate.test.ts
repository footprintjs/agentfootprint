/**
 * The ending procedure (`terminate.ts`) when the LOCAL close hangs: the
 * caller's answer stays bounded by the deadline, and the close is reported
 * apart — `settled` resolves only once it has really finished, so a pool keeps
 * the ending charged until then.
 *
 * The three hanging-close cases — after a confirmed `DELETE`, after the remote
 * deadline, and with no session at all — and the normal close as the control.
 * The helper's own deadline is shortened to 20 ms (its supported parameter);
 * the public default stays `TOOL_TEARDOWN_TIMEOUT_MS`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mcpClient } from '../../src/tool-providers/index.js';
import { DeleteWatch, endSession, type Ending } from '../../src/mcp/terminate.js';
import type { McpConnection } from '../../src/mcp/types.js';
import { TOOL_TEARDOWN_TIMEOUT_MS } from '../../src/tools/toolSessions.js';

afterEach(() => {
  vi.useRealTimers();
});

const DEADLINE_MS = 20;

/** A close that waits until released. */
function hangingClose() {
  let release!: () => void;
  let started = false;
  const done = new Promise<void>((resolve) => (release = resolve));
  return {
    close: async () => {
      started = true;
      await done;
    },
    release: () => release(),
    get started() {
      return started;
    },
  };
}

/** Whether `promise` has settled, without waiting for it. */
function watchSettled(promise: Promise<unknown>): { readonly done: boolean } {
  const state = { done: false };
  void promise.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  return state;
}

type Remote = 'confirmed-delete' | 'remote-deadline' | 'no-session';

/** An ending of a transport that answers its DELETE with 204, never answers it, or holds no session. */
function endingOf(
  remote: Remote,
  close: () => Promise<void>,
): {
  readonly ending: Ending;
  releaseRemote(): void;
} {
  let releaseRemote!: () => void;
  const stalled = new Promise<void>((resolve) => (releaseRemote = resolve));
  const watch = new DeleteWatch();
  const transport = {
    ...(remote !== 'no-session' && { sessionId: 'session-1' }),
    async terminateSession(): Promise<void> {
      if (remote === 'remote-deadline') return stalled;
      await watch.fetch(async () => new Response(null, { status: 204 }))(
        'https://orders.example.test/mcp',
        { method: 'DELETE' },
      );
    },
  };
  return {
    ending: endSession(transport, watch, close, Date.now, DEADLINE_MS),
    releaseRemote: () => releaseRemote(),
  };
}

describe('a hanging local close never holds the caller past the deadline', () => {
  it.each([
    ['confirmed-delete', 'terminated', true],
    ['remote-deadline', 'timed-out', false],
    ['no-session', 'no-session', true],
  ] as const)(
    '%s: the caller hears %s by the deadline; settled waits for the close itself',
    async (remote, expected, resolved) => {
      vi.useFakeTimers();
      const hanging = hangingClose();
      const { ending, releaseRemote } = endingOf(remote, hanging.close);
      const answered = watchSettled(ending.outcome);
      const settled = watchSettled(ending.settled);
      await vi.advanceTimersByTimeAsync(DEADLINE_MS);
      expect(answered.done).toBe(true);
      expect(hanging.started).toBe(true);
      expect(await ending.outcome).toMatchObject({ remote: expected, resolved });
      // The close is still running: the ending has not settled.
      await vi.advanceTimersByTimeAsync(10 * DEADLINE_MS);
      expect(settled.done).toBe(false);
      hanging.release();
      releaseRemote();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled.done).toBe(true);
    },
  );

  it('the control — a close that finishes: the caller is answered as soon as it has, not at the deadline', async () => {
    vi.useFakeTimers();
    const { ending } = endingOf('confirmed-delete', async () => undefined);
    const answered = watchSettled(ending.outcome);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered.done).toBe(true);
    expect(await ending.outcome).toMatchObject({
      remote: 'terminated',
      resolved: true,
      status: 204,
    });
    await ending.settled;
  });

  it("a client built on `connection` whose close hangs: terminate() answers 'unavailable' by the public deadline", async () => {
    const hanging = hangingClose();
    const connection = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: hanging.close,
    } as unknown as McpConnection;
    const client = await mcpClient({ name: 'orders', connection });
    vi.useFakeTimers();
    const outcome = client.terminate!();
    const answered = watchSettled(outcome);
    await vi.advanceTimersByTimeAsync(TOOL_TEARDOWN_TIMEOUT_MS);
    expect(answered.done).toBe(true);
    expect(await outcome).toMatchObject({ remote: 'unavailable', resolved: false });
    hanging.release();
  });
});
