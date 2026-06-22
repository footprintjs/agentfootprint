/**
 * enable.localObservability — Tier-3 retain handle: live onLive + offline
 * getTrace()/onRecorded over a real agent run.
 *
 * Convention-3 types here:
 *   - Integration: onLive fires live during the run; onRecorded fires once at
 *     exit with a finalized Trace; getTrace() works after the run.
 *   - Functional:  the Trace timeline carries llm.start/llm.end + run boundary.
 *   - Security:    redactContent scrubs content so the Trace carries no secret.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { redactContent, traceToStepGraph } from '../../../src/recorders/observability/trace.js';
import type { Trace } from '../../../src/recorders/observability/trace.js';

function buildAgent(reply: string) {
  return Agent.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('You are a helpful assistant.')
    .build();
}

describe('enable.localObservability — integration', () => {
  it('fires onLive during the run and onRecorded once at exit', async () => {
    const runner = buildAgent('done');
    let liveTicks = 0;
    const recorded: Trace[] = [];
    runner.enable.localObservability({
      onLive: () => {
        liveTicks += 1;
      },
      onRecorded: (trace) => recorded.push(trace),
    });

    await runner.run({ message: 'hi' });

    expect(liveTicks).toBeGreaterThan(0); // live ticks during the run
    expect(recorded).toHaveLength(1); // exactly once, at run exit
    expect(recorded[0].version).toBe(1);
    expect(recorded[0].events.some((e) => e.type === 'run.exit')).toBe(true);
  });

  it('getTrace() returns a JSON-lossless, graph-free Trace after the run', async () => {
    const runner = buildAgent('done');
    const handle = runner.enable.localObservability();

    await runner.run({ message: 'hi' });

    const trace = handle.getTrace();
    expect(trace.version).toBe(1);
    expect(trace.events.length).toBeGreaterThan(0);
    expect('finalGraph' in trace).toBe(false); // graph derived at render, not stored
    expect(trace.capturedAtMs).toBeTypeOf('number');
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });
});

describe('enable.localObservability — functional', () => {
  it('the Trace timeline carries the LLM bracket + run boundary', async () => {
    const runner = buildAgent('the answer');
    const handle = runner.enable.localObservability();

    await runner.run({ message: 'hi' });

    const types = handle.getTrace().events.map((e) => e.type);
    expect(types).toContain('run.entry');
    expect(types).toContain('llm.start');
    expect(types).toContain('llm.end');
    expect(types).toContain('run.exit');
  });
});

describe('enable.localObservability — security', () => {
  it('redactContent scrubs content so the Trace carries no secret (incl. run/subflow payloads)', async () => {
    const SECRET = 'patient SSN 123-45-6789';
    const runner = buildAgent(SECRET); // the model echoes the secret into content + exit payloads
    const recorded: Trace[] = [];
    const handle = runner.enable.localObservability({
      redact: redactContent,
      onRecorded: (t) => recorded.push(t),
    });

    await runner.run({ message: 'hi' });

    // both the auto onRecorded trace and a manual getTrace() are fully scrubbed
    expect(JSON.stringify(recorded[0])).not.toContain(SECRET);
    expect(JSON.stringify(handle.getTrace())).not.toContain(SECRET);
    expect(recorded[0].redaction).toBe('pii');
  });
});

describe('enable.localObservability — offline replay (traceToStepGraph)', () => {
  it('rebuilds the SAME graph offline that the live handle shows (round-trip fidelity)', async () => {
    const runner = buildAgent('done');
    const handle = runner.enable.localObservability();

    await runner.run({ message: 'hi' });

    const live = handle.getSnapshot(); // the live StepGraph (enable.flowchart machinery)
    const rebuilt = traceToStepGraph(handle.getTrace()); // rebuilt from the offline Trace's events
    expect(rebuilt).toEqual(live); // identical — replay reconstructs the graph exactly
  });

  it('captures the static chart structure for <Replay> (Option A) and stays JSON-lossless', async () => {
    const runner = buildAgent('done');
    const handle = runner.enable.localObservability();

    await runner.run({ message: 'hi' });

    const trace = handle.getTrace();
    // structure = the serialized buildTimeStructure (stage tree), so Replay can
    // rebuild the flowchart and overlay events — matching the live <Lens>.
    expect(trace.structure).toBeDefined();
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace); // still JSON-lossless
  });

  it('redaction reaches the DERIVED graph (the whole reason finalGraph is not stored)', async () => {
    const SECRET = 'patient SSN 123-45-6789';
    const runner = buildAgent(SECRET);
    const handle = runner.enable.localObservability({ redact: redactContent });

    await runner.run({ message: 'hi' });

    // The graph is rebuilt from already-redacted events → it carries no secret,
    // with no separate graph-redaction step. Closes the finalGraph leak end-to-end.
    const rebuilt = traceToStepGraph(handle.getTrace());
    expect(JSON.stringify(rebuilt)).not.toContain(SECRET);
  });
});
