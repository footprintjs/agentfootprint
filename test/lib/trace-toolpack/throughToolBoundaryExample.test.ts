/**
 * Integration test — runs the through-the-tool-boundary example end to end.
 *
 * `examples/features/50-through-the-tool-boundary.ts` is the flagship
 * demonstration of `keepRecord` + `inspect_tool_run`, and its prose makes
 * falsifiable claims: the descent happens, it cites an inner stage and an
 * exact field, and nothing inside the tool re-executes to produce the
 * explanation. The example PRINTS those claims rather than asserting them
 * (a demo that throws teaches nothing), so this file is what keeps them
 * honest — the same arrangement as `selfExplainExample.test.ts`.
 *
 * `AGENTFOOTPRINT_DEMO_OFFLINE=1` pins both halves: the scripted model AND
 * the fixture forecast, so CI never touches the network and a developer
 * machine with a key in the environment runs the path CI runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { run } from '../../../examples/features/50-through-the-tool-boundary.js';

let transcript: string;
const realLog = console.log;

beforeAll(async () => {
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    process.env.AGENTFOOTPRINT_DEMO_OFFLINE = '1';
    await run('Should I bike to work in Chicago tomorrow?');
  } finally {
    console.log = realLog;
  }
  transcript = lines.join('\n');
}, 30_000);

afterAll(() => {
  delete process.env.AGENTFOOTPRINT_DEMO_OFFLINE;
});

describe('example 50 — through the tool boundary', () => {
  it('runs offline by default: fixture forecast, scripted model, no network', () => {
    expect(transcript).toContain('forecast: fixture (no network)');
    expect(transcript).toContain('scripted mock');
  });

  it('turn 1 runs the chart ONCE inside one tool call', () => {
    expect(transcript).toContain('[turn 1] → weather_advice({"city":"Chicago"})');
    expect(transcript).toContain(
      'inner chart stage executions after turn 1: fetch 1 · validate 1 · decide 1 · advise 1',
    );
  });

  it('turn 2 shows the rung: inspect_tool_call teaches the descent', () => {
    expect(transcript).toContain('[turn 2] → inspect_tool_call');
    expect(transcript).toContain('inside: this tool kept its own record of the run');
    expect(transcript).toContain("Descend with inspect_tool_run({ toolCallId: 'c1' })");
    expect(transcript).not.toContain('⚠ boundary: what happened INSIDE the tool is not traced');
  });

  it('turn 2 descends and serves the INNER run — overview, why, then the field', () => {
    expect(transcript).toContain('[turn 2] → inspect_tool_run({"toolCallId":"c1"})');
    expect(transcript).toContain("INSIDE TOOL CALL c1 — 'weather_advice' ran a recorded flowchart");
    expect(transcript).toContain("SLICE for 'advice'");
    // The decision RULE rides the control edge — a live record can carry
    // what a serialized recording never can.
    expect(transcript).toContain('[control: Rain chance at or above the 60% bike threshold]');
    expect(transcript).toContain("VALUE of 'rainChancePct' as of validate-forecast#1");
  });

  it('every inner answer states that its ids belong to the INNER chart', () => {
    expect(transcript).toContain('⚠ the ids above are INNER ids');
    expect(transcript).toContain('trace_node / get_value / trace_slice do not accept them');
  });

  it('the answer cites the inner stage AND the exact field that drove it', () => {
    expect(transcript).toContain('validate-forecast wrote rainChancePct = 82');
    expect(transcript).toContain('weigh-the-rain then took the "rain" branch');
    expect(transcript).toContain('Rain chance at or above the 60% bike threshold');
  });

  it('proves zero re-execution INSIDE the tool — the chart counters are unchanged', () => {
    expect(transcript).toContain(
      'inner chart stage executions after turn 2: fetch 1 · validate 1 · decide 1 · advise 1',
    );
    expect(transcript).toContain('nothing re-executed inside the tool: YES');
    expect(transcript).toContain('the forecast was fetched 1× across BOTH turns');
  });

  it('closes by naming the bound, the id split, and the redaction contract', () => {
    expect(transcript).toContain('bounded to the last 10 invocations');
    expect(transcript).toContain('Without that option the boundary marker stands');
    expect(transcript).toContain('two id spaces must never be quietly mixed');
    expect(transcript).toContain('footprintjs scrubs at commit');
  });

  it('emits no over-budget noise — the tools slot is sized for the trace tools', () => {
    expect(transcript).not.toContain('tools slot over budget');
  });
});
