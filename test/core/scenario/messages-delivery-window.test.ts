/**
 * A delivered injection is part of the window, so the window governs it —
 * and the cache marker that names it names the right message.
 *
 * ── Why these two live together ──────────────────────────────────────
 * They are the same claim from two directions. The whole design of delivery
 * is that a delivered message is a message: nothing about it is special, no
 * component gets a different past because of it. The window strategy proves
 * that from the removal side (it can drop one exactly as it drops a turn, and
 * the pair law still holds around it), and the cache marker proves it from the
 * indexing side (its `boundaryIndex` is a position in the array the provider
 * is handed, not a count of injections).
 *
 * The marker half is the fix D4 called mandatory. Before it, a
 * `CacheMarker{field:'messages'}` counted entries in a per-slot list of
 * injections and handed that count to providers who read it as a message
 * position — two index spaces under one name. It could not be caught because
 * it could not fire; delivery makes it reachable, so it has to be right.
 *
 * Test types (Convention 3): integration (delivery × window strategy ×
 * cache decision) / regression (the marker index mismatch) / functional.
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool, slidingWindow } from '../../../src/index.js';
import { defineFact } from '../../../src/injection-engine.js';
import { computeCacheMarkers } from '../../../src/cache/CacheDecisionSubflow.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';
import type { ActiveInjection } from '../../../src/lib/injection-engine/types.js';

function scriptedProvider(replies: readonly Partial<LLMResponse>[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  let i = 0;
  const provider: LLMProvider = {
    name: 'capture',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const next = replies[Math.min(i, replies.length - 1)] ?? {};
      i++;
      return Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
        ...next,
      } as LLMResponse);
    },
  };
  return { provider, requests };
}

const weather = defineTool({
  name: 'weather',
  description: 'Look up the weather.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => Promise.resolve('sunny'),
});

/**
 * Long enough that dropping it is worth the drop-notice that replaces it —
 * `slidingWindow` refuses a head removal whose notice would not be smaller
 * than the span, so a two-word note can never leave the front of a window.
 */
const LONG_NOTE = `Account tier: gold. ${'Prior context that is worth its own turn. '.repeat(12)}`;

describe('a delivered injection folds under the window like any other turn', () => {
  it('leaves the window when the strategy trims, and the pair law holds around it', async () => {
    // Four tool round-trips against a 1-turn window: the early turns — the
    // delivered note among them — get dropped.
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: '', toolCalls: [{ id: 'c2', name: 'weather', args: {} }] },
      { content: '', toolCalls: [{ id: 'c3', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 6 })
      .system('bot')
      .tool(weather)
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .fact(defineFact({ id: 'note', data: LONG_NOTE, slot: 'messages', role: 'assistant' }))
      .build();

    const evicted: Array<{ contentHash: string }> = [];
    agent.on('agentfootprint.context.evicted', (e) =>
      evicted.push(e.payload as unknown as { contentHash: string }),
    );

    expect(await agent.run({ message: 'is it raining?' })).toBe('done');

    // It was delivered…
    expect(requests[0]!.messages.some((m) => m.content === LONG_NOTE)).toBe(true);
    // …and it eventually left, exactly like a conversation turn would.
    const last = requests[requests.length - 1]!.messages;
    expect(last.some((m) => m.content === LONG_NOTE)).toBe(false);
    expect(evicted.length).toBeGreaterThan(0);

    // The pair law survives the combination: in every request, an assistant
    // turn carrying tool calls is still immediately followed by its result.
    for (const req of requests) {
      req.messages.forEach((m, i) => {
        if ((m.toolCalls?.length ?? 0) > 0) {
          expect(req.messages[i + 1]?.role, 'a tool pair was split').toBe('tool');
        }
      });
    }
  });

  it('is not resurrected after the window drops it', async () => {
    // The strategy decided it should go. Re-delivering next boundary would be
    // the library overruling that decision every iteration, forever.
    const { provider, requests } = scriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'weather', args: {} }] },
      { content: '', toolCalls: [{ id: 'c2', name: 'weather', args: {} }] },
      { content: '', toolCalls: [{ id: 'c3', name: 'weather', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 6 })
      .system('bot')
      .tool(weather)
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .fact(defineFact({ id: 'note', data: LONG_NOTE, slot: 'messages', role: 'assistant' }))
      .build();

    await agent.run({ message: 'is it raining?' });

    // Once it has left, it never comes back — and it was never in twice.
    let seenGone = false;
    for (const req of requests) {
      const present = req.messages.filter((m) => m.content === LONG_NOTE);
      expect(present.length).toBeLessThanOrEqual(1);
      if (present.length === 0) seenGone = true;
      else expect(seenGone, 'a dropped delivery came back').toBe(false);
    }
  });
});

describe('cache marker truth — the index names the message it claims', () => {
  const cacheable: ActiveInjection = {
    id: 'tier',
    flavor: 'fact',
    cache: 'always',
    inject: { messages: [{ role: 'assistant', content: 'Account tier: gold' }] },
  };
  const volatile_: ActiveInjection = {
    id: 'clock',
    flavor: 'fact',
    cache: 'never',
    inject: { messages: [{ role: 'assistant', content: 'Now: noon' }] },
  };

  const baseState = {
    iteration: 1,
    maxIterations: 5,
    userMessage: 'hi',
    cumulativeInputTokens: 0,
    systemPromptCachePolicy: 'never' as const,
    cachingDisabled: false,
  };

  function windowWith(...marks: Array<{ id: string; content: string } | string>): LLMMessage[] {
    return [
      { role: 'user', content: 'hi' },
      ...marks.map((m) =>
        typeof m === 'string'
          ? ({ role: 'assistant', content: m } as LLMMessage)
          : ({
              role: 'assistant',
              content: m.content,
              injectedBy: { injectionId: m.id, flavor: 'fact', iteration: 1 },
            } as LLMMessage),
      ),
    ];
  }

  it('points at the delivered message, at its position in the wire array', () => {
    const history = windowWith({ id: 'tier', content: 'Account tier: gold' });
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [cacheable] as never,
      history,
    });
    const messages = markers.find((m) => m.field === 'messages');
    expect(messages).toBeDefined();
    // Index 1, because that is where the message IS — not index 0, which is
    // what a count of injections would have said.
    expect(messages!.boundaryIndex).toBe(1);
    expect(history[messages!.boundaryIndex]!.content).toBe('Account tier: gold');
    expect(messages!.reason).toContain('wire index 1');
  });

  it('stops the prefix at the first delivered message that is not cacheable', () => {
    const history = windowWith(
      { id: 'tier', content: 'Account tier: gold' },
      { id: 'clock', content: 'Now: noon' },
    );
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [cacheable, volatile_] as never,
      history,
    });
    const messages = markers.find((m) => m.field === 'messages');
    // The volatile one must be OUTSIDE the cached prefix, so the boundary is
    // the last cacheable message before it.
    expect(messages!.boundaryIndex).toBe(1);
    expect(history[messages!.boundaryIndex]!.content).toBe('Account tier: gold');
  });

  it('emits no messages marker when nothing was delivered', () => {
    // The conversation declares no cache policy of its own, and this decision
    // does not invent one for it.
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [] as never,
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(markers.find((m) => m.field === 'messages')).toBeUndefined();
  });

  it('emits no messages marker when the first delivered message is volatile', () => {
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [volatile_] as never,
      history: windowWith({ id: 'clock', content: 'Now: noon' }),
    });
    expect(markers.find((m) => m.field === 'messages')).toBeUndefined();
  });

  it('treats a message whose injection is no longer active as not cacheable', () => {
    // Delivered three iterations ago, trigger has since gone quiet. There is
    // no policy to evaluate this iteration, so it is not claimed as cached —
    // fail-closed, like every other unknown in the cache decision.
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [] as never,
      history: windowWith({ id: 'tier', content: 'Account tier: gold' }),
    });
    expect(markers.find((m) => m.field === 'messages')).toBeUndefined();
  });

  it('carries the declared policy across the ActiveInjection projection', () => {
    // The projection used to drop `metadata`, so `computeCacheMarkers` read
    // `undefined` for every injection and defaulted to "never cacheable" — a
    // declared `cache: 'always'` did nothing in any real run.
    const markers = computeCacheMarkers({
      ...baseState,
      activeInjections: [cacheable] as never,
      history: windowWith({ id: 'tier', content: 'Account tier: gold' }),
    });
    expect(markers.some((m) => m.field === 'messages')).toBe(true);
  });
});
