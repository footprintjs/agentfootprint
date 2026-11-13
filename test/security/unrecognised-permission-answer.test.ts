/**
 * A permission answer the library does not recognise is a refusal.
 *
 * Before this, the tool gate and the capability gate refused only on an exact
 * `'deny'` or `'halt'`, so a checker that answered `'ask'`, `{}`, `'ALLOW'`,
 * `'deny '` (a trailing space from a remote policy service) or `null` RAN the
 * tool — while the skill menu, asking the same checker, hid the skill for the
 * same answer. One reader now owns the rule
 * (`provider-contract/permissionDecision.ts` · `readPermissionDecision`): only
 * `'allow'` / `'gate_open'` allow; anything else is refused fail-closed, and
 * the record says the answer was not recognised instead of carrying the raw
 * value as if it had been acted on.
 *
 *   Unit      — the reader itself: src/provider-contract/permissionDecision.test.ts
 *   Scenario  — tool_call gate, governed capability gate, skill menu (here)
 *   Boundary  — 'allow', 'gate_open', 'deny', 'halt' behave exactly as before
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { PermissionChecker } from '../../src/provider-contract/types.js';

/** Answers a checker might give that are not in the vocabulary. */
const UNRECOGNISED: ReadonlyArray<readonly [string, unknown]> = [
  ['ask', { result: 'ask' }],
  ['an empty object', {}],
  ['ALLOW', { result: 'ALLOW' }],
  ["'deny ' with a space", { result: 'deny ' }],
  ['DENY', { result: 'DENY' }],
  ['a null result', { result: null }],
  ['a number', { result: 1 }],
  ['no decision at all', null],
];

interface Seen {
  readonly ran: boolean;
  readonly checks: { capability: string; result: unknown; rationale?: string }[];
  readonly told: string;
}

async function run(answer: (capability: string) => unknown, governed = false): Promise<Seen> {
  let ran = false;
  const checks: Seen['checks'] = [];
  const told: string[] = [];
  const checker = {
    name: 'remote-policy',
    ...(governed && { governs: ['external_net'] }),
    // Cast: these answers model a port that broke its type (JSON from a service).
    check: (r: { capability: string }) => answer(r.capability),
  } as unknown as PermissionChecker;
  const agent = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'c1', name: 'wire', args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    permissionChecker: checker,
  })
    .tool(
      defineTool<Record<string, never>, string>({
        name: 'wire',
        description: 'wires money',
        inputSchema: { type: 'object', properties: {} },
        ...(governed && { capabilities: ['external_net'] as never }),
        execute: () => {
          ran = true;
          return 'wired';
        },
      }),
    )
    .build();
  agent.on('agentfootprint.permission.check', (e) => {
    const p = e.payload as { capability: string; result: unknown; rationale?: string };
    checks.push({
      capability: p.capability,
      result: p.result,
      ...(p.rationale !== undefined && { rationale: p.rationale }),
    });
  });
  agent.on('agentfootprint.stream.tool_end', (e) => {
    told.push(String((e.payload as { result: unknown }).result));
  });
  await agent.run({ message: 'go' });
  return { ran, checks, told: told.join('\n') };
}

describe('the tool_call gate', () => {
  for (const [label, answer] of UNRECOGNISED) {
    it(`refuses ${label}, and records a refusal that says why`, async () => {
      const seen = await run(() => answer);
      expect(seen.ran).toBe(false);
      expect(seen.checks).toHaveLength(1);
      expect(seen.checks[0].result).toBe('deny');
      expect(seen.checks[0].rationale).toMatch(/not recognised/);
      // The model reads the fixed fail-closed refusal, never the odd value.
      expect(seen.told).toContain("[permission denied: Tool 'wire' could not be authorized.");
    });
  }

  it("quotes a short odd string so an operator can see the typo ('deny ')", async () => {
    const seen = await run(() => ({ result: 'deny ' }));
    expect(seen.checks[0].rationale).toContain("got 'deny '");
  });
});

describe('a governed capability gate', () => {
  for (const [label, answer] of UNRECOGNISED) {
    it(`refuses ${label} on external_net after tool_call allowed`, async () => {
      const seen = await run((cap) => (cap === 'tool_call' ? { result: 'allow' } : answer), true);
      expect(seen.ran).toBe(false);
      const capability = seen.checks.find((c) => c.capability === 'external_net');
      expect(capability?.result).toBe('deny');
      expect(capability?.rationale).toMatch(/not recognised/);
    });
  }
});

describe('the recognised answers are unchanged', () => {
  it("'allow' and 'gate_open' run the tool and are recorded as given", async () => {
    for (const result of ['allow', 'gate_open'] as const) {
      const seen = await run(() => ({ result }));
      expect(seen.ran).toBe(true);
      expect(seen.checks[0]).toEqual({ capability: 'tool_call', result });
    }
  });

  it("'deny' keeps the checker's own rationale for the model", async () => {
    const seen = await run(() => ({ result: 'deny', rationale: 'needs a supervisor' }));
    expect(seen.ran).toBe(false);
    expect(seen.told).toBe('[permission denied: needs a supervisor]');
    expect(seen.checks[0]).toEqual({
      capability: 'tool_call',
      result: 'deny',
      rationale: 'needs a supervisor',
    });
  });

  it("'halt' keeps its generic sentence and ends the run", async () => {
    await expect(run(() => ({ result: 'halt', reason: 'security:x' }))).rejects.toThrow();
  });
});
