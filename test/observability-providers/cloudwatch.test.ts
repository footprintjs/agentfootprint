/**
 * cloudwatchObservability — 7-pattern tests.
 *
 *   P1 Unit         — strategy.name is `'cloudwatch'` (distinct from agentcore)
 *   P2 Boundary     — flush() drains buffer to putLogEvents
 *   P3 Scenario     — typed events round-trip as JSON in CWL message
 *   P4 Property     — same buffering semantics as agentcore (size + bytes)
 *   P5 Security     — missing logGroupName + missing SDK paths
 *   P6 Performance  — sync exportEvent at 10k/op
 *   P7 ROI          — capabilities + parity guarantee with agentcoreObservability
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloudwatchObservability,
  type CloudWatchLikeClient,
  type CloudwatchObservabilityOptions,
} from '../../src/adapters/observability/cloudwatch.js';
import { agentcoreObservability } from '../../src/adapters/observability/agentcore.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { expectScalesLinearly } from '../helpers/perf.js';

// ── Test client ──────────────────────────────────────────────────────

interface CapturedBatch {
  readonly logGroupName: string;
  readonly logStreamName: string;
  readonly logEvents: ReadonlyArray<{ timestamp: number; message: string }>;
}

function makeMockClient(): {
  client: CloudwatchObservabilityOptions['_client'];
  batches: CapturedBatch[];
} {
  const batches: CapturedBatch[] = [];
  return {
    batches,
    client: {
      async putLogEvents(input) {
        batches.push(input as CapturedBatch);
      },
    },
  };
}

/** AWS's shape for "that stream isn't there" — what a real put rejects with. */
function missingStreamError(): Error {
  return Object.assign(new Error('The specified log stream does not exist.'), {
    name: 'ResourceNotFoundException',
  });
}

/** Lost a create race with another process. */
function alreadyExistsError(): Error {
  return Object.assign(new Error('The specified log stream already exists'), {
    name: 'ResourceAlreadyExistsException',
  });
}

/**
 * A client that enforces CloudWatch's REAL precondition: a put into a stream
 * that does not exist is rejected. The pre-8.11.0 mock accepted every put,
 * which is exactly why the defect passed its tests.
 */
function makeStreamAwareClient(existing: Set<string>): {
  client: CloudwatchObservabilityOptions['_client'];
  batches: CapturedBatch[];
  createCalls(): ReadonlyArray<{ logGroupName: string; logStreamName: string }>;
} {
  const batches: CapturedBatch[] = [];
  const creates: Array<{ logGroupName: string; logStreamName: string }> = [];
  return {
    batches,
    createCalls: () => creates,
    client: {
      putLogEvents(input) {
        const key = `${input.logGroupName}::${input.logStreamName}`;
        if (!existing.has(key)) return Promise.reject(missingStreamError());
        batches.push(input as CapturedBatch);
        return Promise.resolve();
      },
      createLogStream(input) {
        creates.push({ ...input });
        existing.add(`${input.logGroupName}::${input.logStreamName}`);
        return Promise.resolve();
      },
    },
  };
}

const fakeEvent: AgentfootprintEvent = {
  type: 'agentfootprint.agent.start' as never,
  payload: { runId: 'r-cw' },
  timestamp: Date.now(),
} as unknown as AgentfootprintEvent;

afterEach(() => {
  // Per-it() strategy ownership — nothing global to reset.
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('cloudwatchObservability — P1 unit', () => {
  it('P1 strategy.name is `cloudwatch` (distinct from agentcore)', () => {
    const { client } = makeMockClient();
    const strat = cloudwatchObservability({ logGroupName: '/g', _client: client });
    expect(strat.name).toBe('cloudwatch');
    expect(strat.capabilities.events).toBe(true);
    expect(strat.capabilities.logs).toBe(true);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('cloudwatchObservability — P2 boundary', () => {
  it('P2 flush() drains buffer with putLogEvents', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/cw/group',
      logStreamName: 'cw-stream',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(fakeEvent);
    strat.exportEvent(fakeEvent);
    await strat.flush?.();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.logGroupName).toBe('/cw/group');
    expect(batches[0]?.logStreamName).toBe('cw-stream');
    expect(batches[0]?.logEvents).toHaveLength(2);
  });

  // ── 8.11.0: create the log stream on first delivery ────────────────
  //
  // Before 8.11.0 this adapter called PutLogEvents directly. CloudWatch
  // rejects a put into a stream that does not exist, so ANY stream name that
  // was not pre-created dropped every event, forever, in silence — and the
  // convention the docs themselves recommended (`<host>/<Date.now()>`) can
  // never pre-exist, so following the documentation guaranteed the bug.

  it('P2 a missing stream is created once, then the SAME batch is delivered', async () => {
    const { client, batches, createCalls } = makeStreamAwareClient(new Set());
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      logStreamName: 'host-a/1754500000000',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(fakeEvent);
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(createCalls()).toEqual([{ logGroupName: '/g', logStreamName: 'host-a/1754500000000' }]);
    expect(batches).toHaveLength(1);
    // No event is lost to the failed first put — the batch is re-sent whole.
    expect(batches[0]?.logEvents).toHaveLength(2);
  });

  it('P2 a stream the operator already made costs no CreateLogStream call', async () => {
    const { client, batches, createCalls } = makeStreamAwareClient(new Set(['/g::pre-made']));
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      logStreamName: 'pre-made',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(createCalls()).toHaveLength(0);
    expect(batches).toHaveLength(1);
  });

  it('P2 an injected client without createLogStream reports instead of crashing', async () => {
    // Back-compat: `_client` doubles written before 8.11.0 only implement
    // putLogEvents. They must still type-check and must fail loudly, not hard.
    const errors: string[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      onError: (e) => errors.push(e.message),
      _client: {
        putLogEvents: () => Promise.reject(missingStreamError()),
      },
    });
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/has no `createLogStream`/);
  });
});

// ─── P3 Scenario — JSON round-trip ───────────────────────────────────

describe('cloudwatchObservability — P3 scenario', () => {
  it('P3 typed event payload survives JSON round-trip in CWL message', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent({
      ...fakeEvent,
      payload: { runId: 'r-cw', extra: { nested: true, count: 42 } },
    } as AgentfootprintEvent);
    await strat.flush?.();
    const message = batches[0]?.logEvents[0]?.message;
    expect(message).toBeDefined();
    const parsed = JSON.parse(message!);
    expect(parsed.payload.extra.nested).toBe(true);
    expect(parsed.payload.extra.count).toBe(42);
    expect(parsed.payload.runId).toBe('r-cw');
  });
});

// ─── P4 Property — buffering semantics shared with agentcore ─────────

describe('cloudwatchObservability — P4 property', () => {
  it('P4 hitting maxBatchEvents triggers a flush WITHOUT explicit flush() call', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      maxBatchEvents: 4,
      flushIntervalMs: 0,
      _client: client,
    });
    for (let i = 0; i < 4; i++) strat.exportEvent(fakeEvent);
    // Yield once so the size-triggered chained doFlush microtask runs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(batches).toHaveLength(1);
    const totalShipped = batches.reduce((acc, b) => acc + b.logEvents.length, 0);
    expect(totalShipped).toBe(4);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('cloudwatchObservability — P5 security', () => {
  it('P5 missing logGroupName throws TypeError at factory time', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cloudwatchObservability({ logGroupName: '' as any }),
    ).toThrow(TypeError);
  });

  // ── 8.11.0: a delivery failure must reach SOMEBODY ─────────────────
  //
  // The test this replaces reassigned `strat._onError` — the very code under
  // test — and then guarded its only assertion with `if (captured)`. It could
  // not fail, which is how a silent-delivery defect shipped. These four assert
  // unconditionally, and each covers a different door.

  it('P5 with nothing wired, a delivery failure still reaches the console', async () => {
    const said: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      said.push(a.map(String).join(' '));
    });
    try {
      const strat = cloudwatchObservability({
        logGroupName: '/g',
        flushIntervalMs: 0,
        _client: { putLogEvents: () => Promise.reject(new Error('AccessDeniedException')) },
      });
      strat.exportEvent(fakeEvent);
      await strat.flush?.();
    } finally {
      spy.mockRestore();
    }
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/cloudwatchObservability/);
    expect(said[0]).toMatch(/AccessDeniedException/);
    // Says how much was lost, not just that something went wrong.
    expect(said[0]).toMatch(/1 event\(s\) dropped/);
  });

  it('P5 the `onError` option receives delivery failures', async () => {
    const errors: Error[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      onError: (e) => errors.push(e),
      _client: { putLogEvents: () => Promise.reject(new Error('ThrottlingException')) },
    });
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/ThrottlingException/);
  });

  it('P5 an assigned `_onError` receives delivery failures too', async () => {
    // The regression guard for the original defect: the hook used to be
    // captured at construction, so assigning `_onError` had no effect on the
    // delivery path and every failed put vanished.
    const errors: Error[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      _client: { putLogEvents: () => Promise.reject(new Error('ServiceUnavailable')) },
    });
    strat._onError = (e) => errors.push(e);
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/ServiceUnavailable/);
  });

  it('P5 repeated failures are rate-limited and carry the running count', async () => {
    // An outage must not become a second outage. 20 failures, logarithmic
    // lines — and the count is in the text so the log says it is ongoing.
    const said: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      said.push(a.map(String).join(' '));
    });
    try {
      const strat = cloudwatchObservability({
        logGroupName: '/g',
        flushIntervalMs: 0,
        _client: { putLogEvents: () => Promise.reject(new Error('down')) },
      });
      for (let i = 0; i < 20; i++) {
        strat.exportEvent(fakeEvent);
        await strat.flush?.();
      }
    } finally {
      spy.mockRestore();
    }
    expect(said.length).toBeGreaterThan(0);
    expect(said.length).toBeLessThan(10);
    expect(said[said.length - 1]).toMatch(/delivery failure #\d+/);
  });

  it('P5 a consumer sink is NOT rate-limited — they asked for every failure', async () => {
    const errors: Error[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      onError: (e) => errors.push(e),
      _client: { putLogEvents: () => Promise.reject(new Error('down')) },
    });
    for (let i = 0; i < 20; i++) {
      strat.exportEvent(fakeEvent);
      await strat.flush?.();
    }
    expect(errors).toHaveLength(20);
  });

  it('P5 missing SDK + no _client → flush() routes through _onError with install hint', async () => {
    const errors: Error[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      onError: (e) => errors.push(e),
    });
    strat.exportEvent(fakeEvent);
    await strat.flush?.();
    // Unconditional now: the peer-dep failure is a delivery failure like any
    // other and MUST surface through the same door.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/aws-sdk|cloudwatch|peer dependency/i);
  });
});

// ─── P5b Security — the create path cannot loop or hide ──────────────

describe('cloudwatchObservability — P5 security (stream creation)', () => {
  it('P5 a create race with another process is swallowed — the stream exists', async () => {
    const batches: CapturedBatch[] = [];
    let putAttempts = 0;
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      _client: {
        putLogEvents(input) {
          putAttempts++;
          if (putAttempts === 1) return Promise.reject(missingStreamError());
          batches.push(input as CapturedBatch);
          return Promise.resolve();
        },
        // Somebody else won the race between our put and our create.
        createLogStream: () => Promise.reject(alreadyExistsError()),
      },
    });
    strat.exportEvent(fakeEvent);
    await strat.flush?.();

    expect(batches).toHaveLength(1);
  });

  it('P5 a create denied by IAM is attempted ONCE and never loops', async () => {
    const errors: string[] = [];
    let createAttempts = 0;
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      onError: (e) => errors.push(e.message),
      _client: {
        putLogEvents: () => Promise.reject(missingStreamError()),
        createLogStream: () => {
          createAttempts++;
          return Promise.reject(
            Object.assign(new Error('not authorized: logs:CreateLogStream'), {
              name: 'AccessDeniedException',
            }),
          );
        },
      },
    });
    for (let i = 0; i < 5; i++) {
      strat.exportEvent(fakeEvent);
      await strat.flush?.();
    }

    // Latched off after the first non-recoverable failure.
    expect(createAttempts).toBe(1);
    // But every dropped batch is still reported — the latch silences the
    // retrying, never the reporting.
    expect(errors).toHaveLength(5);
    expect(errors[0]).toMatch(/log GROUP exists/);
    expect(errors[0]).toMatch(/logs:CreateLogStream/);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('cloudwatchObservability — P6 performance', () => {
  it(
    'P6 10k exportEvent calls cost ten times what 1k cost — buffering only',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Buffering must be an append: O(1) per event regardless of how many are
      // already in the batch. Ten times the events, ten times the work. A
      // re-serialisation of the whole batch per event would be quadratic and
      // land nowhere near this ceiling. Fresh strategy per run so neither
      // measurement inherits the other's batch.
      const exportEvents = (count: number): void => {
        const { client } = makeMockClient();
        const strat = cloudwatchObservability({
          logGroupName: '/g',
          maxBatchEvents: 1_000_000, // never trigger size-flush
          flushIntervalMs: 0,
          _client: client,
        });
        for (let i = 0; i < count; i++) strat.exportEvent(fakeEvent);
      };
      await expectScalesLinearly({
        small: () => exportEvents(1_000),
        large: () => exportEvents(10_000),
        scale: 10,
        why: 'exportEvent must append to the batch, not rebuild it',
      });
    },
  );
});

// ─── P7 ROI — parity with agentcore ──────────────────────────────────

describe('cloudwatchObservability — P7 ROI', () => {
  it('P7 cloudwatch + agentcore share the same put-shape — parity guarantee', async () => {
    const cw = makeMockClient();
    const ac = makeMockClient();

    const cwStrat = cloudwatchObservability({
      logGroupName: '/cw/g',
      flushIntervalMs: 0,
      _client: cw.client,
    });
    const acStrat = agentcoreObservability({
      logGroupName: '/ac/g',
      flushIntervalMs: 0,
      _client: ac.client,
    });

    cwStrat.exportEvent(fakeEvent);
    acStrat.exportEvent(fakeEvent);

    await Promise.all([cwStrat.flush?.(), acStrat.flush?.()]);

    // Same put shape — only logGroupName differs (per consumer config).
    expect(cw.batches[0]?.logEvents).toHaveLength(1);
    expect(ac.batches[0]?.logEvents).toHaveLength(1);
    expect(cw.batches[0]?.logEvents[0]?.message).toBe(ac.batches[0]?.logEvents[0]?.message);

    // But strategy names differ — registry-lookup distinguishes them.
    expect(cwStrat.name).toBe('cloudwatch');
    expect(acStrat.name).toBe('agentcore');
  });

  it('P7 _client is the same shape regardless of which factory built it', async () => {
    // Type-level check: feeding the same _client into both factories
    // type-checks. (If this test compiles, the parity contract holds.)
    const sharedClient: CloudWatchLikeClient = {
      async putLogEvents() {
        /* no-op */
      },
    };
    const cw = cloudwatchObservability({ logGroupName: '/g', _client: sharedClient });
    const ac = agentcoreObservability({ logGroupName: '/g', _client: sharedClient });
    expect(cw.name).toBe('cloudwatch');
    expect(ac.name).toBe('agentcore');
  });
});
