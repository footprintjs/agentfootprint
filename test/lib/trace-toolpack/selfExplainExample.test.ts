/**
 * Integration test — runs the self-explaining-agent example end to end.
 *
 * `examples/features/49-self-explain-live.ts` is the flagship demonstration
 * of `.selfExplain()`, and its prose makes four falsifiable claims. Those
 * claims are printed by the example rather than asserted inside it (a demo
 * that throws teaches nothing), so THIS file is what keeps them honest —
 * the same arrangement as `resilience-visibility-example.test.ts`.
 *
 * `npm run test:examples` runs the file; it does not check what it says.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { run } from '../../../examples/features/49-self-explain-live.js';

/** Capture the example's console output — the transcript IS the artifact. */
let transcript: string;
const realLog = console.log;

beforeAll(async () => {
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    // No key, no live call: the example resolves the scripted mock. Set
    // explicitly so a developer machine with a key in the environment runs
    // the same deterministic path CI does.
    process.env.AGENTFOOTPRINT_DEMO_OFFLINE = '1';
    await run('Order 7712 arrived damaged — replace or refund it.');
  } finally {
    console.log = realLog;
  }
  transcript = lines.join('\n');
}, 30_000);

afterAll(() => {
  delete process.env.AGENTFOOTPRINT_DEMO_OFFLINE;
});

describe('example 49 — the self-explaining agent', () => {
  it('turn 1 does real work and SKIPS the refund (in stock + in warranty → replacement)', () => {
    expect(transcript).toContain('→ lookup_order');
    expect(transcript).toContain('→ check_inventory');
    expect(transcript).toContain(
      'tool executions after turn 1: lookup_order 1 · check_inventory 1 · issue_refund 0',
    );
    expect(transcript).not.toContain('→ issue_refund');
  });

  it('turn 2 answers the why-question through VISIBLE trace-tool calls', () => {
    expect(transcript).toContain('[turn 2] → read_skill');
    expect(transcript).toContain('[turn 2] → find_in_trace');
    expect(transcript).toContain('[turn 2] → inspect_tool_call');
    expect(transcript).toContain('[turn 2] → run_overview');
  });

  it('proves zero re-execution: the counters are identical either side of the explanation', () => {
    expect(transcript).toContain('nothing re-executed: YES');
    expect(transcript).toContain(
      'tool executions after turn 2: lookup_order 1 · check_inventory 1 · issue_refund 0',
    );
  });

  it('proves no business tool ran in turn 2 — every call was a read-only trace tool', () => {
    expect(transcript).toContain('business tools in turn 2: none');
    expect(transcript).toContain('issue_refund executions, both turns: 0');
  });

  it('prints the total spend against the budget', () => {
    expect(transcript).toMatch(/total spend across both turns: ~\$\d+\.\d{6} \(budget \$2\.00\)/);
  });

  it('closes with the honest-claims line — recorded evidence, not introspection', () => {
    expect(transcript).toContain('assembled from RECORDED evidence');
    expect(transcript).toContain('not the model');
    expect(transcript).toContain('introspecting its own reasoning');
    expect(transcript).toContain('not a second run of the work');
    // …and it names what the record cannot show.
    expect(transcript).toContain('run input (args)');
    expect(transcript).toContain('INSIDE a tool');
  });

  it('the answer cites the evidence it actually fetched', () => {
    expect(transcript).toContain('inspect_tool_call(c2) → check_inventory ran with');
    expect(transcript).toContain('12 units available');
    expect(transcript).toContain('issue_refund was never called');
  });

  it('emits no over-budget noise — the tools slot is sized for the trace tools', () => {
    expect(transcript).not.toContain('tools slot over budget');
  });
});
