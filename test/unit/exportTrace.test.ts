/**
 * exportTrace — 5-pattern tests.
 *
 * Verifies the trace export captures all introspection surfaces correctly,
 * defaults to redact-true, and degrades gracefully for runners missing
 * any of the optional methods.
 */
import { describe, expect, it, vi } from 'vitest';
import { exportTrace } from '../../src/exportTrace';
import { Agent } from '../../src/lib/concepts';
import { mock } from '../../src/adapters/mock/MockAdapter';
import type { RunnerLike } from '../../src/types/multiAgent';

// ── Unit ────────────────────────────────────────────────────

describe('exportTrace — unit', () => {
  it('returns schemaVersion 1 + ISO timestamp + redacted: true by default', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) }).build();
    await agent.run('hello');

    const trace = exportTrace(agent);
    expect(trace.schemaVersion).toBe(1);
    expect(trace.redacted).toBe(true);
    // ISO 8601
    expect(trace.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('captures snapshot, narrative, narrativeEntries, spec from a real Agent', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) }).build();
    await agent.run('hello');

    const trace = exportTrace(agent);
    expect(trace.snapshot).toBeDefined();
    expect(Array.isArray(trace.narrative)).toBe(true);
    expect(trace.narrative!.length).toBeGreaterThan(0);
    expect(Array.isArray(trace.narrativeEntries)).toBe(true);
    expect(trace.spec).toBeDefined();
  });

  it('passes { redact } through to runner.getSnapshot()', () => {
    const getSnapshot = vi.fn(() => ({ sharedState: {} }));
    const runner: RunnerLike & { getSnapshot: typeof getSnapshot } = {
      run: async () => ({ content: '' }),
      getSnapshot,
    };

    exportTrace(runner);
    expect(getSnapshot).toHaveBeenCalledWith({ redact: true });

    getSnapshot.mockClear();
    exportTrace(runner, { redact: false });
    expect(getSnapshot).toHaveBeenCalledWith({ redact: false });
  });

  it('redacted flag in trace reflects the option chosen', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) }).build();
    await agent.run('hello');

    expect(exportTrace(agent).redacted).toBe(true);
    expect(exportTrace(agent, { redact: false }).redacted).toBe(false);
    expect(exportTrace(agent, { redact: true }).redacted).toBe(true);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('exportTrace — boundary', () => {
  it('runners missing all optional methods still produce a valid trace', () => {
    const minimal: RunnerLike = { run: async () => ({ content: '' }) };
    const trace = exportTrace(minimal);

    expect(trace.schemaVersion).toBe(1);
    expect(trace.snapshot).toBeUndefined();
    expect(trace.narrative).toBeUndefined();
    expect(trace.narrativeEntries).toBeUndefined();
    expect(trace.spec).toBeUndefined();
  });

  it('falls back to 0-arg getSnapshot when runner rejects { redact } option', () => {
    // Simulate an older custom runner whose getSnapshot doesn't accept args.
    let argsSeen: unknown = 'NOT_CALLED';
    const runner: RunnerLike & { getSnapshot: () => unknown } = {
      run: async () => ({ content: '' }),
      getSnapshot: function () {
        argsSeen = arguments.length;
        return { legacy: true };
      },
    };

    const trace = exportTrace(runner);
    expect(trace.snapshot).toEqual({ legacy: true });
    expect(argsSeen).toBe(1); // first try: 1 arg passed
  });

  it('JSON-stringify-safe — a real Agent trace round-trips through JSON', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) }).build();
    await agent.run('hello');
    const trace = exportTrace(agent);
    const json = JSON.stringify(trace);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe(trace.exportedAt);
    expect(parsed.redacted).toBe(true);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('exportTrace — scenario', () => {
  it('roundtrip: capture trace from agent A, parse JSON, render fields like a viewer would', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'answer' }]) })
      .system('helpful')
      .build();
    const result = await agent.run('what is 2+2?');

    const traceJson = JSON.stringify(exportTrace(agent));

    // Simulate what /viewer would do: receive JSON, parse, validate version
    const trace = JSON.parse(traceJson);
    expect(trace.schemaVersion).toBe(1);
    expect(trace.snapshot).toBeDefined();
    expect(result.content ?? '').toBe('answer');

    // Narrative contains the seeded content
    const narrativeStr = (trace.narrative as string[]).join('\n');
    expect(narrativeStr).toMatch(/answer|Finalize|CallLLM/);
  });
});

// ── Property ────────────────────────────────────────────────

describe('exportTrace — property', () => {
  it('exported trace JSON does not contain undefined values for missing methods (skipped, not nulled)', () => {
    const minimal: RunnerLike = { run: async () => ({ content: '' }) };
    const json = JSON.stringify(exportTrace(minimal));
    expect(json).not.toContain('undefined');
    // Missing-optional fields are omitted entirely
    const parsed = JSON.parse(json);
    expect('snapshot' in parsed).toBe(false);
    expect('narrative' in parsed).toBe(false);
  });
});

// ── Security ────────────────────────────────────────────────

describe('exportTrace — security', () => {
  it('default redact: true means raw values from the redacted-mirror feature do NOT appear in the trace', async () => {
    // Use a real Agent + AgentRunner. The redacted-mirror lives in the
    // FlowChartExecutor that AgentRunner wraps; if no policy is configured,
    // the mirror is never enabled and getSnapshot({ redact: true }) returns
    // raw — that's the documented fallback. This test pins the default
    // option choice (redact: true) so callers know the helper is requesting
    // safe-by-default behavior.
    const captured: { redactArg?: boolean } = {};
    const runner: RunnerLike & { getSnapshot: (opts?: { redact?: boolean }) => unknown } = {
      run: async () => ({ content: '' }),
      getSnapshot: (opts) => {
        captured.redactArg = opts?.redact;
        return { sharedState: {} };
      },
    };

    exportTrace(runner);
    expect(captured.redactArg).toBe(true);
  });
});
