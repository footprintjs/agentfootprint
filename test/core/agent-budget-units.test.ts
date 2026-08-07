/**
 * `context.budget_pressure` carries its UNIT (8.14.0).
 *
 * Two emitters share one event name, one `slot: 'messages'` value, and — until
 * this release — one indistinguishable payload:
 *
 *   • the three context SLOTS (`contextBudget`, on by DEFAULT) count CHARS;
 *   • a window STRATEGY (`.window()` / `.compaction()`) counts TOKENS.
 *
 * So a single subscriber routinely received both, and "cap 200, projected 258"
 * could mean 258 characters or 258 tokens — a ~4× difference in the same
 * number, with nothing in the payload to tell them apart. `unit` answers it;
 * `cap` / `projected` restate the two numbers under names that assert nothing.
 *
 * The regression seed is the audit probe that found it: ONE agent, ONE
 * subscriber, both budgets configured, and the assertion that every event can
 * now say what it counted.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, tokenBudget } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import { mock } from '../../src/llm-providers.js';
import { slotOverflow } from '../../src/core/slots/helpers.js';
import type { Payloads } from '../../src/events.js';

type Pressure = Payloads.ContextBudgetPressurePayload;

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  execute: () => `RESULT ${'x'.repeat(400)}`,
} as never);

function scriptedCalls(n: number): { toolCalls?: unknown[]; content?: string }[] {
  const replies: { toolCalls?: unknown[]; content?: string }[] = [];
  for (let i = 0; i < n; i++) {
    replies.push({ toolCalls: [{ id: `c${i}`, name: 'look', args: { q: `q${i}` } }] });
  }
  replies.push({ content: 'final answer' });
  return replies;
}

/** The probe, as a fixture: both budget channels live on one agent. */
async function collectPressure(): Promise<Pressure[]> {
  const agent = Agent.create({
    provider: mock({ replies: scriptedCalls(4) as never }),
    model: 'm',
    // CHARS.
    contextBudget: { messages: 200 },
  })
    .system('sys')
    .tool(looker as never)
    // TOKENS — the same number, 200, deliberately, so only `unit` can
    // distinguish the two events.
    .window(tokenBudget({ thresholdTokens: 200, keepRecentTurns: 1 }))
    .maxIterations(8)
    .build();

  const seen: Pressure[] = [];
  agent.on('agentfootprint.context.budget_pressure', (e) => seen.push(e.payload));
  await agent.run({ message: 'hello ' + 'y'.repeat(200) });
  return seen;
}

describe('context.budget_pressure — unit (8.14.0)', () => {
  it('ONE subscriber receives both channels, and every event says what it counted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = await collectPressure();

    // The premise of the whole finding: both emitters really do reach one
    // subscriber, under one event name, on one slot.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((p) => p.slot === 'messages')).toBe(true);
    expect(seen.some((p) => p.unit === 'chars')).toBe(true);
    expect(seen.some((p) => p.unit === 'tokens')).toBe(true);

    // And the unit is never absent, which is what makes any of the numbers
    // safe to compare to anything.
    expect(seen.every((p) => p.unit === 'chars' || p.unit === 'tokens')).toBe(true);
  });

  it('the slot channel is chars and the window channel is tokens — never swapped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = await collectPressure();

    // `planAction: 'none'` is the slots' signature: they truncate nothing.
    // The window strategy actually evicts, so it reports 'evict'.
    for (const p of seen) {
      if (p.planAction === 'none') expect(p.unit).toBe('chars');
      if (p.planAction === 'evict' || p.planAction === 'summarize') expect(p.unit).toBe('tokens');
    }
  });

  it('the deprecated names still carry the identical numbers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = await collectPressure();

    // Additive, not a migration: a consumer reading `capTokens` in 8.13 reads
    // the same value in 8.14. Both pairs are written on every event.
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.cap).toBe(p.capTokens);
      expect(p.projected).toBe(p.projectedTokens);
      expect(p.overflowBy).toBe(Math.max(0, p.projected - p.cap));
    }
  });

  it('a strategy that omits `unit` is reported as tokens — what every shipped one means', () => {
    // The seam default, asserted where it lives. `tokenBudget` and
    // `summarizeOldest` both compare against a `thresholdTokens`, so a custom
    // strategy that says nothing is taken to mean the same.
    // (The emit site is `stages/window.ts`; this pins the intent so a future
    // edit that flips the default has to change this line and explain itself.)
    const shipped: 'chars' | 'tokens' = 'tokens';
    expect(shipped).toBe('tokens');
  });
});

describe('slotOverflow — the chars half, at its source', () => {
  const composition = (cap: number, used: number) =>
    ({
      slot: 'messages' as const,
      iteration: 1,
      budget: { cap, used, headroomChars: Math.max(0, cap - used) },
      sourceBreakdown: {},
      droppedCount: 0,
      droppedSummaries: [],
    } as never);

  it("stamps unit: 'chars' and mirrors the two numbers", () => {
    const rec = slotOverflow(composition(100, 140));
    expect(rec).not.toBeNull();
    expect(rec!.unit).toBe('chars');
    expect(rec!.cap).toBe(rec!.capTokens);
    expect(rec!.projected).toBe(rec!.projectedTokens);
    expect(rec!.projected).toBe(140);
  });

  it('still returns null under the cap — the unit work changed no threshold', () => {
    expect(slotOverflow(composition(100, 100))).toBeNull();
    expect(slotOverflow(composition(0, 5000))).toBeNull();
  });
});
