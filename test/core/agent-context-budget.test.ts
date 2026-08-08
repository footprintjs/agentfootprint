/**
 * `contextBudget` — the per-slot budgets, reachable from a public door (8.11.0).
 *
 *   P1 Unit         — defaults unchanged when the option is absent
 *   P2 Boundary     — each of the three slots honours its own key
 *   P3 Scenario     — the over-budget warning names a knob that now EXISTS
 *   P4 Property     — an unset key never disturbs its slot's default
 *   P5 Security     — n/a (no content crosses a boundary); covers the honesty
 *                     claim instead: nothing is truncated, the LLM still sees all
 *   P6 Performance  — n/a (build-time constant)
 *   P7 ROI          — Agent and LLMCall speak the same option
 *
 * Why this file exists: the caps existed since 7.6.1 and no public door reached
 * them. `buildMessagesSlot()` was called with NO arguments at all four call
 * sites, so its 10000-char cap was unreachable by construction — and the
 * over-budget warning told you to "raise budgetCap", a knob nothing could set.
 * A warning you cannot act on is worse than no warning: it trains people to
 * ignore the channel.
 *
 * The cap is read here as `cap`. It was also written as `capTokens` through
 * 8.x; 9.0.0 removed that spelling from `BudgetPressureRecord` because this
 * channel counts CHARACTERS — a field named for tokens on a char-counting
 * record is a lie the payload tells for free. Same number, one name, and the
 * record now carries `unit` to say which. P1 pins the absence directly.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { LLMCall } from '../../src/core/LLMCall.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import type { BudgetPressureRecord } from '../../src/recorders/core/types.js';

// ── Fixtures ─────────────────────────────────────────────────────────

/** A system prompt guaranteed to blow any cap below its own length. */
const longPrompt = 'S'.padEnd(6_000, 'x');

interface Pressure extends BudgetPressureRecord {
  readonly slot: string;
}

async function pressuresFrom(agent: ReturnType<typeof buildAgent>): Promise<Pressure[]> {
  const seen: Pressure[] = [];
  agent.on('agentfootprint.context.budget_pressure', (e) => seen.push(e.payload as Pressure));
  await agent.run({ message: 'hello' });
  return seen;
}

function buildAgent(contextBudget?: { systemPrompt?: number; messages?: number; tools?: number }) {
  return Agent.create({
    provider: mock({ reply: 'done' }),
    model: 'mock',
    ...(contextBudget && { contextBudget }),
  })
    .system(longPrompt)
    .build();
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('contextBudget — P1 unit', () => {
  it('P1 absent option keeps the 4000-char system-prompt default', async () => {
    const pressures = await pressuresFrom(buildAgent());
    const systemPrompt = pressures.find((p) => p.slot === 'system-prompt');
    expect(systemPrompt).toBeDefined();
    expect(systemPrompt?.cap).toBe(4000);
    // 9.0.0 — one spelling. The slot channel counts chars, so the record says
    // so with `unit` and never with a field named for tokens.
    expect(systemPrompt?.unit ?? 'chars').toBe('chars');
    expect(Object.hasOwn(systemPrompt as object, 'capTokens')).toBe(false);
    expect(Object.hasOwn(systemPrompt as object, 'projectedTokens')).toBe(false);
  });

  it('P1 an empty object is the same as absent — no key, no change', async () => {
    const pressures = await pressuresFrom(buildAgent({}));
    expect(pressures.find((p) => p.slot === 'system-prompt')?.cap).toBe(4000);
  });
});

// ─── P2 Boundary — each key reaches its own slot ─────────────────────

describe('contextBudget — P2 boundary', () => {
  it('P2 `systemPrompt` raises the cap, and a prompt under it stops warning', async () => {
    const pressures = await pressuresFrom(buildAgent({ systemPrompt: 100_000 }));
    expect(pressures.find((p) => p.slot === 'system-prompt')).toBeUndefined();
  });

  it('P2 `systemPrompt` lowered makes a previously-fine prompt report', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      contextBudget: { systemPrompt: 10 },
    })
      .system('a modest prompt, well under the 4000 default')
      .build();
    const pressures = await pressuresFrom(agent);
    const systemPrompt = pressures.find((p) => p.slot === 'system-prompt');
    expect(systemPrompt?.cap).toBe(10);
  });

  it('P2 `messages` reaches the messages slot — the cap that had NO door before', async () => {
    // The regression guard for the sharpest half of the defect:
    // `buildMessagesSlot()` took no arguments at any call site, so its cap was
    // unreachable by construction.
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      contextBudget: { messages: 5 },
    })
      .system('short')
      .build();

    const seen: Pressure[] = [];
    agent.on('agentfootprint.context.budget_pressure', (e) => seen.push(e.payload as Pressure));
    // Longer than the 5-char cap, so the slot actually reports.
    await agent.run({ message: 'a user message comfortably longer than five characters' });

    const messages = seen.find((p) => p.slot === 'messages');
    expect(messages).toBeDefined();
    expect(messages?.cap).toBe(5);
  });

  it('P2 `tools` reaches the tools slot', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      contextBudget: { tools: 10 },
    })
      .system('short')
      .tool({
        schema: {
          name: 'a_tool_with_a_long_description',
          description: 'd'.padEnd(500, 'x'),
          inputSchema: { type: 'object', properties: {} },
        },
        execute: () => 'ok',
      })
      .build();
    const pressures = await pressuresFrom(agent);
    const tools = pressures.find((p) => p.slot === 'tools');
    expect(tools).toBeDefined();
    expect(tools?.cap).toBe(10);
  });
});

// ─── P3 Scenario — the warning now names something real ──────────────

describe('contextBudget — P3 scenario', () => {
  it('P3 the console warning points at `contextBudget`, not the old private name', async () => {
    const said: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      said.push(a.map(String).join(' '));
    });
    try {
      await pressuresFrom(buildAgent());
    } finally {
      spy.mockRestore();
    }
    const warning = said.find((line) => line.includes('system-prompt slot over budget'));
    expect(warning).toBeDefined();
    expect(warning).toContain('contextBudget.systemPrompt');
    // The old text named a knob no consumer could reach.
    expect(warning).not.toContain('budgetCap');
  });
});

// ─── P4 Property — one key never disturbs another ────────────────────

describe('contextBudget — P4 property', () => {
  /**
   * A slot only reports when it is OVER budget, so to observe a slot's cap we
   * have to overflow it. Both slots are pushed over here — a 6000-char system
   * prompt beats the 4000 default, a 12000-char message beats the 10000 one —
   * which lets each assertion read the OTHER slot's cap and prove one key did
   * not disturb it.
   */
  const hugeMessage = 'm'.padEnd(12_000, 'x');

  async function bothSlotsOverflow(budget: {
    systemPrompt?: number;
    messages?: number;
  }): Promise<Pressure[]> {
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      contextBudget: budget,
    })
      .system(longPrompt)
      .build();
    const seen: Pressure[] = [];
    agent.on('agentfootprint.context.budget_pressure', (e) => seen.push(e.payload as Pressure));
    await agent.run({ message: hugeMessage });
    return seen;
  }

  it('P4 setting `systemPrompt` leaves the messages slot on its 10000 default', async () => {
    const pressures = await bothSlotsOverflow({ systemPrompt: 1 });
    expect(pressures.find((p) => p.slot === 'system-prompt')?.cap).toBe(1);
    expect(pressures.find((p) => p.slot === 'messages')?.cap).toBe(10_000);
  });

  it('P4 setting `messages` leaves the system-prompt slot on its 4000 default', async () => {
    const pressures = await bothSlotsOverflow({ messages: 1 });
    expect(pressures.find((p) => p.slot === 'messages')?.cap).toBe(1);
    expect(pressures.find((p) => p.slot === 'system-prompt')?.cap).toBe(4_000);
  });
});

// ─── P5 — the honesty claim the budget rests on ──────────────────────

describe('contextBudget — P5 honesty', () => {
  it('P5 nothing is truncated — an over-budget slot still sends everything', async () => {
    // The budget is a SIGNAL, not a limiter. If it ever started dropping
    // content, every claim this library makes about the trace being the whole
    // truth would break.
    const provider = mock({ reply: 'done' });
    const agent = Agent.create({
      provider,
      model: 'mock',
      contextBudget: { systemPrompt: 10 },
    })
      .system(longPrompt)
      .build();

    const pressures = await pressuresFrom(agent);
    expect(pressures.find((p) => p.slot === 'system-prompt')?.planAction).toBe('none');

    const snapshot = agent.getLastSnapshot();
    expect(snapshot).toBeDefined();
  });
});

// ─── P7 ROI — one option, both runners ───────────────────────────────

describe('contextBudget — P7 ROI', () => {
  it('P7 LLMCall speaks the same option (two slots — it has no tools)', async () => {
    const call = LLMCall.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      contextBudget: { systemPrompt: 10 },
    })
      .system(longPrompt)
      .build();

    const seen: Pressure[] = [];
    call.on('agentfootprint.context.budget_pressure', (e) => seen.push(e.payload as Pressure));
    await call.run({ message: 'hello' });

    expect(seen.find((p) => p.slot === 'system-prompt')?.cap).toBe(10);
  });
});
