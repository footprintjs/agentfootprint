/**
 * The drop notice is owed to the WIRE, not to politeness — and a courtesy
 * notice must never veto a legitimate drop.
 *
 * ## The defect (9.56.1)
 *
 * `drop.ts` authored its notice whenever the removal reached the front of what
 * may leave (`spanStart === 0 || keptRequestAtHead`), and abandoned the WHOLE
 * removal when that notice was not smaller than the span it replaced. The
 * obligation it was guarding is narrower than that test: the window must OPEN
 * ON A USER TURN (see notice.ts). When the message that would become the new
 * head is already a user turn, no notice is owed at all — and yet its 245–358
 * characters were still allowed to veto the drop.
 *
 * Two locally-correct rules composed into a livelock:
 *
 *   • the span is the longest CONTIGUOUS removable run (turns.ts), so a
 *     blocker one turn along caps it permanently at the same small span; and
 *   • that small span is smaller than the notice, so every boundary reaches
 *     the same verdict.
 *
 * Result: `removedMessageCount === 0` forever while the window grows without
 * bound. Reproduced by execution in two shapes that ordinary use produces —
 * a leftover drop notice at the head (the 9.55.0 anchor pins the request one
 * turn along), and a restored conversation whose older turns are short.
 *
 * ## The fix
 *
 * A three-rung ladder: rich notice → plain notice → NO notice. The drop is
 * abandoned under `replacement-not-smaller` only when the wire genuinely
 * needs a message in the head position and none of them fits.
 */

import { describe, expect, it } from 'vitest';

import { slidingWindow, tokenBudget, summarizeOldest } from '../../src/index.js';
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import {
  answeredCallIds,
  planRemoval,
  segmentTurns,
  type RemovalGuards,
} from '../../src/core/agent/window/turns.js';
import { currentRequestIndexOf } from '../../src/core/agent/window/currentRequest.js';
import { removalFacts } from '../../src/core/agent/window/removal.js';
import { buildDropNotice, isDropNotice } from '../../src/core/agent/window/notice.js';
import type { WindowStrategyInput } from '../../src/core/agent/window/strategy.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';

const TASK = 'Audit every deployment and tell me which one touched the payment path.';

/** Build the input a strategy is handed, exactly as the stage builds it. */
function inputFor(history: readonly LLMMessage[], iteration: number): WindowStrategyInput {
  const turns = segmentTurns(history);
  const requestIndex = currentRequestIndexOf(history, TASK);
  const guards: RemovalGuards = {
    answeredCallIds: answeredCallIds(history),
    ...(requestIndex >= 0 && { currentRequestIndex: requestIndex }),
  };
  const origins = history.map((_, i) => ({ stageId: `tool-calls#${i}`, bornAtMs: 0 }));
  return {
    history,
    turns,
    measured: { input: 999_999, output: 10 },
    iteration,
    runId: 'run-1',
    agentModel: 'm',
    providerName: 'mock',
    signal: undefined,
    now: () => 1_000,
    planRemoval: (keep, isExistingSummary) => planRemoval(turns, keep, guards, isExistingSummary),
    removalFacts: (indices, at) => removalFacts(origins, indices, at),
  };
}

/** One ReAct round: the assistant's call plus its answered result. */
function toolRound(n: number, chars = 400): LLMMessage[] {
  return [
    { role: 'assistant', content: '', toolCalls: [{ id: `c${n}`, name: 'look', args: {} }] },
    { role: 'tool', content: `RESULT ${'x'.repeat(chars)}`, toolCallId: `c${n}`, toolName: 'look' },
  ];
}

interface Boundary {
  readonly removed: number;
  readonly chars: number;
  readonly reasons: readonly string[];
  readonly length: number;
}

/** Drive a strategy through N iteration boundaries, appending a round each time. */
async function drive(
  strategy: { plan: (i: WindowStrategyInput) => Promise<unknown> },
  seed: readonly LLMMessage[],
  boundaries: number,
): Promise<{ readonly log: readonly Boundary[]; readonly window: readonly LLMMessage[] }> {
  let history: LLMMessage[] = [...seed];
  const log: Boundary[] = [];
  for (let i = 0; i < boundaries; i++) {
    const iteration = i + 4;
    const res = (await strategy.plan(inputFor(history, iteration))) as
      | { window?: readonly LLMMessage[]; record: WindowRecord }
      | undefined;
    if (res !== undefined) {
      if (res.window !== undefined) history = [...res.window];
      log.push({
        removed: res.record.removedMessageCount,
        chars: res.record.windowCharsAfter,
        reasons: res.record.refusals.map((r) => r.reason),
        length: history.length,
      });
    }
    history = [...history, ...toolRound(100 + i)];
  }
  return { log, window: history };
}

// ─────────────────────────────────────────────────────────────────
// Scenario — the two wedge shapes, driven to livelock
// ─────────────────────────────────────────────────────────────────

describe('a courtesy notice can no longer veto a drop', () => {
  it('[shape 1] a leftover drop notice at the head does not wedge slidingWindow', async () => {
    const seed: LLMMessage[] = [
      buildDropNotice({ droppedMessageCount: 2, iteration: 3, strategy: 'sliding-window' }),
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const { log, window } = await drive(slidingWindow({ keepRecentTurns: 2 }), seed, 10);

    // It engaged at every boundary…
    expect(log).toHaveLength(10);
    // …and it actually removed things, rather than filing ten identical
    // `replacement-not-smaller` refusals.
    expect(log.filter((b) => b.removed > 0).length).toBeGreaterThanOrEqual(8);
    expect(log.flatMap((b) => b.reasons)).not.toContain('replacement-not-smaller');
    // The window is BOUNDED: after boundary 4 it never exceeds its
    // boundary-4 size by more than the one round each boundary appends.
    // (Pre-fix it climbed by a round every boundary, for ever.)
    const settled = log.slice(4);
    for (const b of settled) {
      expect(b.chars).toBeLessThanOrEqual(settled[0]!.chars + 420);
    }
    // Pre-fix this reached 28 messages and kept climbing.
    expect(window.length).toBeLessThanOrEqual(12);
  });

  it('[shape 2] a restored conversation with short older turns does not wedge', async () => {
    const seed: LLMMessage[] = [
      { role: 'user', content: 'what changed in the payment path?' },
      { role: 'assistant', content: 'A few things — ask me again.' },
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const { log, window } = await drive(slidingWindow({ keepRecentTurns: 2 }), seed, 8);

    expect(log.filter((b) => b.removed > 0).length).toBeGreaterThanOrEqual(6);
    expect(log.flatMap((b) => b.reasons)).not.toContain('replacement-not-smaller');
    expect(window.length).toBeLessThanOrEqual(12);
  });

  it('[shape 2, tokenBudget] the fix is in the SHARED mechanic, not one strategy', async () => {
    const seed: LLMMessage[] = [
      { role: 'user', content: 'what changed in the payment path?' },
      { role: 'assistant', content: 'A few things — ask me again.' },
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const { log } = await drive(tokenBudget({ thresholdTokens: 10, keepRecentTurns: 2 }), seed, 8);
    expect(log.filter((b) => b.removed > 0).length).toBeGreaterThanOrEqual(6);
    expect(log.flatMap((b) => b.reasons)).not.toContain('replacement-not-smaller');
  });
});

// ─────────────────────────────────────────────────────────────────
// Unit — the three rungs of the ladder
// ─────────────────────────────────────────────────────────────────

describe('the ladder: rich → plain → none', () => {
  it('(b) the new head is already a user turn and nothing fits → dropped with NO notice', async () => {
    // The oldest removable turn is the leftover notice (245 chars); the next
    // candidate is the request, which refuses. Span < notice, so pre-fix this
    // was `replacement-not-smaller` forever.
    const seed: LLMMessage[] = [
      buildDropNotice({ droppedMessageCount: 2, iteration: 3, strategy: 'sliding-window' }),
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const res = await slidingWindow({ keepRecentTurns: 2 }).plan(inputFor(seed, 4));
    expect(res).toBeDefined();
    expect(res!.record.removedMessageCount).toBeGreaterThan(0);
    expect(res!.record.refusals.map((r) => r.reason)).not.toContain('replacement-not-smaller');
    // Nothing was inserted: the request itself is the new head.
    expect(res!.window![0]!.content).toBe(TASK);
    expect(res!.window!.some((m) => isDropNotice(m))).toBe(false);
  });

  it('(c) a big span takes the notice, as it always did', async () => {
    const seed: LLMMessage[] = [
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const res = await slidingWindow({ keepRecentTurns: 2 }).plan(inputFor(seed, 4));
    expect(res!.record.removedMessageCount).toBeGreaterThan(0);
    // The request was at the head and refused, so the notice takes index 1.
    expect(res!.window![0]!.content).toBe(TASK);
    expect(isDropNotice(res!.window![1]!)).toBe(true);
    expect(res!.window![1]!.content).toContain('Your current request is kept');
  });

  it('the WIRE refusal survives: an assistant would head the window and nothing fits', async () => {
    // No user message anywhere, so no anchor. The oldest turn is a tiny
    // answered tool round; removing it would leave an ASSISTANT at the head,
    // which is the request shape Anthropic rejects. The notice is owed, does
    // not fit, and the drop is correctly abandoned.
    const seed: LLMMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'look', args: {} }] },
      { role: 'tool', content: 'ok', toolCallId: 'a1', toolName: 'look' },
      { role: 'assistant', content: 'thinking' },
      { role: 'assistant', content: 'more' },
      { role: 'assistant', content: 'latest' },
    ];
    const res = await slidingWindow({ keepRecentTurns: 2 }).plan(inputFor(seed, 4));
    expect(res).toBeDefined();
    expect(res!.record.removedMessageCount).toBe(0);
    expect(res!.record.refusals.map((r) => r.reason)).toContain('replacement-not-smaller');
  });
});

// ─────────────────────────────────────────────────────────────────
// Integration — a real agent, and 9.55.0 still holds
// ─────────────────────────────────────────────────────────────────

describe('9.55.0 is preserved', () => {
  function scripted(toolRounds: number): { provider: LLMProvider; requests: LLMRequest[] } {
    const requests: LLMRequest[] = [];
    let call = 0;
    return {
      requests,
      provider: {
        name: 'mock',
        complete: async (req: LLMRequest): Promise<LLMResponse> => {
          requests.push(JSON.parse(JSON.stringify({ messages: req.messages })) as LLMRequest);
          call++;
          const wantsTool = call <= toolRounds;
          return {
            content: wantsTool ? '' : 'final answer',
            toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
            usage: { input: 5000, output: 10 },
            stopReason: 'end_turn',
          };
        },
      },
    };
  }

  it('the summarizeOldest path is untouched by the ladder', async () => {
    // `summarizeOldest` authors its own frame and never calls `dropOldestSpan`.
    const seed: LLMMessage[] = [
      { role: 'user', content: TASK },
      ...toolRound(1),
      ...toolRound(2),
      ...toolRound(3),
    ];
    const res = await summarizeOldest({
      thresholdTokens: 10,
      keepRecentTurns: 2,
      summarizer: {
        name: 'sum',
        complete: async (): Promise<LLMResponse> => ({
          content: 'EARLIER: lookups ran.',
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'end_turn',
        }),
      },
      model: 'cheap',
    }).plan(inputFor(seed, 4));
    expect(res!.record.removedMessageCount).toBeGreaterThan(0);
  });

  it('the scripted provider still sees the request on every call', async () => {
    const { provider, requests } = scripted(9);
    const { Agent } = await import('../../src/index.js');
    const { defineTool } = await import('../../src/core/tools.js');
    const looker = defineTool({
      name: 'look',
      description: 'look one thing up',
      inputSchema: { type: 'object', properties: {} },
      execute: () => `LOG ENTRY ${'x'.repeat(300)}`,
    } as never);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 14 })
      .tool(looker as never)
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    await agent.run({ message: TASK });
    expect(requests.length).toBeGreaterThanOrEqual(6);
    requests.forEach((req, i) => {
      expect(
        req.messages.some((m) => m.role === 'user' && m.content === TASK),
        `call ${i + 1} lost the request`,
      ).toBe(true);
    });
  });
});
