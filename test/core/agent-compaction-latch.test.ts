/**
 * A deterministic refusal is paid for ONCE (8.14.0).
 *
 * `replacement-not-smaller` means: the summary came back no smaller than the
 * span it would replace, so folding would have spent a call to make the window
 * BIGGER. The right thing to do is abandon the fold — and 8.13.0 did.
 *
 * What it also did was ask again. And again. Same span, same summarizer, same
 * verdict, a real billed call every iteration for the rest of the run. The
 * inputs had not changed, so neither had the answer; the only thing that
 * changed was the invoice.
 *
 * The latch is keyed by span CONTENT, which matters twice over: it survives
 * the index churn a window change causes, and it lets a span that has GROWN
 * be asked about again — a bigger span is a genuinely different question.
 *
 * Deliberately NOT latched: `summarizer-failed`. A 500 is transient and may
 * recover; a verdict about two string lengths will not.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { CompactionRecord } from '../../src/core/agent/window/types.js';

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => `RESULT ${'x'.repeat(300)}`,
} as never);

/**
 * A scripted main model. `reset()` rewinds the script so a second `run()` on
 * the SAME agent replays the same conversation — which is how a repeated span
 * is produced honestly, rather than by reaching into the strategy.
 */
function mainProvider(toolCallsUntil: number): { provider: LLMProvider; reset: () => void } {
  let call = 0;
  return {
    reset: () => {
      call = 0;
    },
    provider: {
      name: 'main',
      complete: async (): Promise<LLMResponse> => {
        call++;
        const wantsTool = call <= toolCallsUntil;
        return {
          content: wantsTool ? '' : 'FINAL',
          toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
          usage: { input: 5000, output: 10 },
          stopReason: 'end_turn',
        };
      },
    },
  };
}

/** A summarizer whose answer is always far LONGER than anything it is given. */
function fatSummarizer(): { provider: LLMProvider; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    provider: {
      name: 'fat',
      complete: async (): Promise<LLMResponse> => {
        calls.push(1);
        return {
          content: 'S'.repeat(5000),
          toolCalls: [],
          usage: { input: 7, output: 7 },
          stopReason: 'end_turn',
        };
      },
    },
  };
}

function recordsOf(agent: Agent): CompactionRecord[] {
  return ((agent.getLastSnapshot()?.sharedState as { compactions?: CompactionRecord[] })
    ?.compactions ?? []) as CompactionRecord[];
}

describe('summarizeOldest — the refusal latch (8.14.0)', () => {
  it('a span it has already been refused on is NOT asked about again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sum = fatSummarizer();
    // ONE agent, so ONE strategy instance, so one latch — and two runs whose
    // opening turns are identical. The second run reaches a span the first was
    // already refused on: same messages, same summarizer, same model, so the
    // verdict is already known and the call is not made.
    const main = mainProvider(3);
    const agent = Agent.create({ provider: main.provider, model: 'm' })
      .tool(looker as never)
      .compaction({
        thresholdTokens: 30,
        keepRecentTurns: 1,
        summarizer: sum.provider,
        model: 'cheap',
      })
      .maxIterations(6)
      .build();

    await agent.run({ message: 'hi' });
    const afterFirst = sum.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    main.reset();
    await agent.run({ message: 'hi' });
    const secondRunRecords = recordsOf(agent);

    // The second run files its records exactly as before — it is still over
    // budget and still not folding, and that has to keep being said.
    expect(secondRunRecords.length).toBeGreaterThan(0);
    // It just does not pay to be told again.
    expect(sum.calls.length).toBeLessThan(afterFirst * 2);
    expect(secondRunRecords.some((r) => r.summarizerSkipped === true)).toBe(true);
  });

  it('the skip is RECORDED — a call not made is evidence, not silence', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sum = fatSummarizer();
    const main = mainProvider(3);
    const agent = Agent.create({ provider: main.provider, model: 'm' })
      .tool(looker as never)
      .compaction({
        thresholdTokens: 30,
        keepRecentTurns: 1,
        summarizer: sum.provider,
        model: 'cheap',
      })
      .maxIterations(6)
      .build();
    await agent.run({ message: 'hi' });
    main.reset();
    await agent.run({ message: 'hi' });

    const records = recordsOf(agent);
    const skipped = records.filter((r) => r.summarizerSkipped === true);
    expect(skipped.length).toBeGreaterThan(0);

    // A skipped visit still files a full record naming the same refusal — the
    // window is still over budget and still not being folded, which is the
    // fact a person debugging it needs at every boundary, not just the first.
    for (const r of skipped) {
      expect(r.refusals.some((x) => x.reason === 'replacement-not-smaller')).toBe(true);
      expect(r.overBudget).toBe(true);
      // Nothing ran, so nothing is claimed to have been counted or produced.
      expect(r.summarizerTokens).toBeUndefined();
      expect(r.summaryChars).toBe(0);
    }
  });

  it('a span that has GROWN is asked about again — it is a different question', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sum = fatSummarizer();
    const main = mainProvider(5);
    const agent = Agent.create({ provider: main.provider, model: 'm' })
      .tool(looker as never)
      .compaction({
        thresholdTokens: 30,
        keepRecentTurns: 1,
        summarizer: sum.provider,
        model: 'cheap',
      })
      .maxIterations(9)
      .build();
    await agent.run({ message: 'hi' });

    // Soundness, not savings. The check is `summaryChars >= windowChars(span)`,
    // and a LARGER span makes that inequality less likely to hold — so a fold
    // that was refused at four turns can genuinely succeed at six. Latching on
    // the span's content (rather than on "this strategy was refused once")
    // is what keeps the library from giving up on a fold that would now work.
    const records = recordsOf(agent);
    const withinRun = records.filter((r) => r.summarizerSkipped === true);
    expect(withinRun).toHaveLength(0);
    // One call per record that reached the summarizer at all. A boundary
    // whose only foldable turn is the CURRENT REQUEST files its record and
    // makes no call (9.55.0) — a decision not to spend is still recorded.
    const asked = records.filter((r) => r.summarizerTokens !== undefined);
    expect(sum.calls.length).toBe(asked.length);
  });

  it('the FIRST refusal still bills — that call really happened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sum = fatSummarizer();
    const ticks: unknown[] = [];
    const agent = Agent.create({
      provider: mainProvider(5).provider,
      model: 'm',
      pricingTable: { name: 'p', pricePerToken: () => 0.001 },
    })
      .tool(looker as never)
      .compaction({
        thresholdTokens: 30,
        keepRecentTurns: 1,
        summarizer: sum.provider,
        model: 'cheap',
      })
      .maxIterations(9)
      .build();
    agent.on('agentfootprint.cost.tick', (e) => {
      if (e.payload.tokensInput === 7) ticks.push(e.payload);
    });
    await agent.run({ message: 'hi' });

    // One summarizer call, one summarizer cost tick. The latch removes the
    // REPEAT, never the record of the call that was actually made.
    expect(sum.calls.length).toBe(ticks.length);
  });

  it('the summarizer bill is filed under the SUMMARIZER, not the agent', async () => {
    // The whole point of a compactor is that it runs somewhere cheaper. A tick
    // that named the agent's provider would put the cheap vendor's spend on the
    // expensive vendor's line — the exact breakdown a reader came for, inverted.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sum = fatSummarizer();
    const ticks: { provider?: string; model?: string; tokensInput: number }[] = [];
    const agent = Agent.create({
      provider: mainProvider(5).provider,
      model: 'm',
      pricingTable: { name: 'p', pricePerToken: () => 0.001 },
    })
      .tool(looker as never)
      .compaction({
        thresholdTokens: 30,
        keepRecentTurns: 1,
        summarizer: sum.provider,
        model: 'cheap',
      })
      .maxIterations(9)
      .build();
    agent.on('agentfootprint.cost.tick', (e) => ticks.push(e.payload as never));
    await agent.run({ message: 'hi' });

    // The summarizer's calls are the ones reporting its usage (7 in, 7 out).
    const summarizerTicks = ticks.filter((t) => t.tokensInput === 7);
    const mainTicks = ticks.filter((t) => t.tokensInput === 5000);
    expect(summarizerTicks.length).toBeGreaterThan(0);
    expect(mainTicks.length).toBeGreaterThan(0);

    for (const t of summarizerTicks) {
      expect(t.provider).toBe('fat');
      expect(t.model).toBe('cheap');
    }
    for (const t of mainTicks) {
      expect(t.provider).toBe('main');
      expect(t.model).toBe('m');
    }
  });

  it('a summarizer that THROWS is retried — that failure is not deterministic', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let attempts = 0;
    const broken: LLMProvider = {
      name: 'broken',
      complete: async () => {
        attempts++;
        throw new Error('summarizer 500');
      },
    };
    const main = mainProvider(5);
    const agent = Agent.create({ provider: main.provider, model: 'm' })
      .tool(looker as never)
      .compaction({ thresholdTokens: 30, keepRecentTurns: 1, summarizer: broken, model: 'cheap' })
      .maxIterations(9)
      .build();
    await agent.run({ message: 'hi' });

    const records = recordsOf(agent);
    expect(records.some((r) => r.refusals.some((x) => x.reason === 'summarizer-failed'))).toBe(
      true,
    );
    // The outage may end mid-run; a length comparison will not change its mind.
    expect(attempts).toBeGreaterThan(1);
    expect(records.every((r) => r.summarizerSkipped === undefined)).toBe(true);
  });

  it('a healthy fold is untouched — the latch only ever fires on a refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const good: LLMProvider = {
      name: 'good',
      complete: async (): Promise<LLMResponse> => {
        calls++;
        return {
          content: 'brief summary',
          toolCalls: [],
          usage: { input: 40, output: 4 },
          stopReason: 'end_turn',
        };
      },
    };
    const main = mainProvider(5);
    const agent = Agent.create({ provider: main.provider, model: 'm' })
      .tool(looker as never)
      .compaction({ thresholdTokens: 30, keepRecentTurns: 1, summarizer: good, model: 'cheap' })
      .maxIterations(9)
      .build();
    await agent.run({ message: 'hi' });

    const records = recordsOf(agent);
    expect(calls).toBeGreaterThan(0);
    expect(records.some((r) => r.removedMessageCount > 0)).toBe(true);
    expect(records.every((r) => r.summarizerSkipped === undefined)).toBe(true);
  });
});
