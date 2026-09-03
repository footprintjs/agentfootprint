/**
 * A rule author can tell what a PERSON said from what the LIBRARY wrote
 * (9.84.0).
 *
 * THE HOLE. `InjectionContext.history` is the list a `rule` trigger and a
 * skill-graph entry rule read to judge what the conversation is about. FIVE
 * of its `role: 'user'` messages are not from anybody: a compaction frame, a
 * drop notice, a schema-check correction, an evidence-check correction, and a
 * message an Injection delivered. The window layer has always refused to
 * anchor on those — `isSaidByPerson` is its rule — but the rule lived where
 * the routing layer cannot import it (the skill-graph fence), the four
 * prefixes were split across two layers, and the context type hid the
 * delivery marker outright. So a predicate could exclude some of the classes
 * and not the rest, and nothing warned it.
 *
 * WHY IT BITES. The drop notice NAMES TOOLS: *"Tool results are among them
 * (lookup_order) — call the tool again…"*. A rule watching history for
 * `lookup_order` therefore fired on the notice about that tool's result
 * LEAVING — which only appears on long sessions, so the rule pinned the wrong
 * skill exactly where the session was already in trouble. That is the test
 * below with the two predicates side by side.
 *
 * Nothing here hand-authors the library's own messages: the compaction frame,
 * the drop notice and the two corrections come from the real writers, and the
 * delivered message is stamped by the real `deliver` stage. A test that typed
 * those strings out would keep passing after the writers changed.
 *
 * Test types (Convention 3): unit (the predicate over one window) · functional
 * (the real evaluator, two predicates, one history) · integration (the real
 * deliver stage stamps the delivered class) · contract (the two readers are one
 * rule; the marker is on the type) · regression (the naive predicate's match
 * is pinned, so the hole cannot quietly re-open).
 */

import { describe, expect, it } from 'vitest';

import { isSaidByPerson } from '../../../src/index.js';
import { evaluateInjections, saidByPerson } from '../../../src/injection-engine.js';
import type { Injection, InjectionContext } from '../../../src/injection-engine.js';
import type { LLMMessage, LLMProvider } from '../../../src/adapters/types.js';
import { buildDropNotice } from '../../../src/core/agent/window/notice.js';
import { buildCorrectiveTurn } from '../../../src/core/agent/outputEnforcement.js';
import { buildEvidenceCorrection } from '../../../src/core/agent/evidence/gate.js';
import { buildSummaryMessage } from '../../../src/core/agent/window/summarize.js';
import { currentRequestIndexOf } from '../../../src/core/agent/window/currentRequest.js';
import { buildDeliverStage } from '../../../src/core/agent/stages/deliver.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import type { TypedScope } from 'footprintjs';

/** The tool every message below is about — the word a rule would watch for. */
const TOOL = 'lookup_order';

const provider: LLMProvider = {
  name: 'test',
  complete: () => Promise.resolve({ content: '', toolCalls: [], stopReason: 'stop' }),
};

/**
 * One message an Injection DELIVERED, produced by the real `deliver` stage.
 *
 * The stage only reads and writes plain keys, so a plain object stands in for
 * the scope. What matters is that `injectedBy` is stamped by the code that
 * really stamps it — the marker's shape is the half of the rule this fix
 * exposes, and a hand-written one would still pass if the stage stopped
 * setting it.
 *
 * The window it lands on ends on an ASSISTANT turn, which is the only place a
 * `user`-role delivery is allowed to sit (see `delivery/rules.ts`).
 */
function deliveredUserMessage(): LLMMessage {
  const scope = {
    iteration: 2,
    history: [
      { role: 'user', content: 'where is my order?' },
      { role: 'assistant', content: 'Let me check.' },
    ] as LLMMessage[],
    activeInjections: [
      {
        id: 'premium-nudge',
        flavor: 'context',
        inject: {
          messages: [{ role: 'user', content: `PS: run ${TOOL} before you answer.` }],
        },
      },
    ],
  } as unknown as TypedScope<AgentState>;

  buildDeliverStage({ provider, memoryIds: [] })(scope);

  const history = (scope as unknown as { history: LLMMessage[] }).history;
  const delivered = history[history.length - 1]!;
  // If this ever fails the fixture is lying about what it is testing.
  expect(delivered.injectedBy?.injectionId).toBe('premium-nudge');
  return delivered;
}

/** A window holding all five library-written classes plus one real request. */
function windowWithAllFive(): {
  compacted: LLMMessage;
  notice: LLMMessage;
  delivered: LLMMessage;
  schemaCheck: LLMMessage;
  evidenceCheck: LLMMessage;
  said: LLMMessage;
  history: LLMMessage[];
} {
  const compacted = buildSummaryMessage(
    `The customer asked about a refund; ${TOOL} returned order A-1.`,
    { foldedMessageCount: 6, iteration: 3, model: 'test-summarizer', retain: 'conversation' },
  );
  const notice = buildDropNotice({
    droppedMessageCount: 4,
    iteration: 5,
    strategy: 'slidingWindow',
    toolNames: [TOOL],
  });
  const delivered = deliveredUserMessage();
  // The two in-loop corrections. Both QUOTE untrusted text after their frame —
  // a validator's error, and the model's own flagged values — which is why a
  // rule matching on prose is at its most wrong here.
  const schemaCheck = buildCorrectiveTurn(
    '{ oops',
    { stage: 'schema-validate', error: `expected an object with an ${TOOL} id` },
    { attempt: 1, totalAttempts: 2 },
  )[1];
  const evidenceCheck: LLMMessage = buildEvidenceCorrection('order A-9 ships tuesday', [
    { value: 'A-9', shape: 'identifier' },
  ])[1];
  const said: LLMMessage = { role: 'user', content: 'can you tell me the delivery date?' };
  return {
    compacted,
    notice,
    delivered,
    schemaCheck,
    evidenceCheck,
    said,
    history: [
      compacted,
      { role: 'assistant', content: 'Checking.' },
      notice,
      { role: 'assistant', content: 'One moment.' },
      delivered,
      { role: 'assistant', content: 'Still checking.' },
      schemaCheck,
      { role: 'assistant', content: 'Sorry — again.' },
      evidenceCheck,
      { role: 'assistant', content: 'Let me re-read the results.' },
      said,
    ],
  };
}

function contextOver(history: readonly LLMMessage[], userMessage: string): InjectionContext {
  return {
    iteration: 6,
    userMessage,
    history: history as InjectionContext['history'],
    activatedInjectionIds: [],
  };
}

/** The rule an author writes today, and the one they should write. */
const naiveRule: Injection = {
  id: 'naive',
  flavor: 'skill',
  trigger: {
    kind: 'rule',
    activeWhen: (ctx) => ctx.history.some((m) => m.role === 'user' && m.content.includes(TOOL)),
  },
  inject: { systemPrompt: 'order-lookup skill' },
};

const fixedRule: Injection = {
  id: 'fixed',
  flavor: 'skill',
  trigger: {
    kind: 'rule',
    activeWhen: (ctx) => saidByPerson(ctx).some((m) => m.content.includes(TOOL)),
  },
  inject: { systemPrompt: 'order-lookup skill' },
};

// ── Unit ─────────────────────────────────────────────────────────────

describe('saidByPerson — the predicate over one window', () => {
  it('returns the person’s messages, in order, and nothing else', () => {
    const w = windowWithAllFive();
    expect(saidByPerson(contextOver(w.history, w.said.content))).toEqual([w.said]);
  });

  it.each([
    ['a compaction frame', (w: ReturnType<typeof windowWithAllFive>) => w.compacted],
    ['a drop notice', (w: ReturnType<typeof windowWithAllFive>) => w.notice],
    ['an injection-delivered message', (w: ReturnType<typeof windowWithAllFive>) => w.delivered],
    ['a schema-check correction', (w: ReturnType<typeof windowWithAllFive>) => w.schemaCheck],
    ['an evidence-check correction', (w: ReturnType<typeof windowWithAllFive>) => w.evidenceCheck],
  ])('excludes %s, which carries role `user` like the real one', (_name, pick) => {
    const w = windowWithAllFive();
    const msg = pick(w);
    // Each really does look like a person's turn from the outside.
    expect(msg.role).toBe('user');
    expect(isSaidByPerson(msg)).toBe(false);
    expect(isSaidByPerson(w.said)).toBe(true);
  });

  it('an empty window, and a window of only our own frames, are both "nobody said anything"', () => {
    const w = windowWithAllFive();
    expect(saidByPerson(contextOver([], 'hi'))).toEqual([]);
    expect(
      saidByPerson(
        contextOver([w.compacted, w.notice, w.delivered, w.schemaCheck, w.evidenceCheck], 'hi'),
      ),
    ).toEqual([]);
  });
});

// ── Functional + regression: the two predicates, one history ─────────

describe('a rule that reads history', () => {
  it('matches our own bookkeeping when it scans history raw — the hole, pinned', () => {
    const w = windowWithAllFive();
    const ctx = contextOver(w.history, w.said.content);
    // Nobody in this conversation typed the tool's name. Three of our own
    // messages did.
    expect(w.said.content).not.toContain(TOOL);
    const { active } = evaluateInjections([naiveRule], ctx);
    expect(active.map((i) => i.id)).toEqual(['naive']);
  });

  it('ignores every library-written class when it reads through saidByPerson', () => {
    const w = windowWithAllFive();
    const { active, skipped } = evaluateInjections(
      [fixedRule],
      contextOver(w.history, w.said.content),
    );
    expect(active).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('still sees the real thing — the fix is a filter, not a mute', () => {
    const w = windowWithAllFive();
    const said: LLMMessage = { role: 'user', content: `please run ${TOOL} for A-1` };
    const ctx = contextOver([...w.history, said], said.content);
    expect(evaluateInjections([fixedRule], ctx).active.map((i) => i.id)).toEqual(['fixed']);
    expect(saidByPerson(ctx).map((m) => m.content)).toEqual([w.said.content, said.content]);
  });
});

// ── Contract ─────────────────────────────────────────────────────────

describe('the marker a predicate needs is on the context type', () => {
  it('an LLMMessage is assignable to a history entry, marker and all', () => {
    const w = windowWithAllFive();
    // Type-level: this line is the mirror check. `npx tsc --noEmit` fails here
    // if `InjectionContext.history` and `LLMMessage.injectedBy` drift apart.
    const entry: InjectionContext['history'][number] = w.delivered;
    expect(entry.injectedBy?.injectionId).toBe('premium-nudge');
    expect(entry.injectedBy?.flavor).toBe('context');
  });

  it('lets a predicate filter delivered messages itself, without saidByPerson', () => {
    const w = windowWithAllFive();
    const ctx = contextOver(w.history, w.said.content);
    expect(ctx.history.filter((m) => m.injectedBy !== undefined)).toHaveLength(1);
  });
});

describe('one rule, two readers', () => {
  it('the window anchors on exactly the last message saidByPerson returns', () => {
    const w = windowWithAllFive();
    const ctx = contextOver(w.history, w.said.content);
    const said = saidByPerson(ctx);
    const anchor = currentRequestIndexOf(w.history, w.said.content);
    // The refusal engine and the routing layer call the same function, so the
    // message the window will not drop is the last one a rule can see.
    expect(w.history[anchor]).toBe(said[said.length - 1]);
  });

  it('does not let the window pin its anchor on a correction frame (9.84.0)', () => {
    const w = windowWithAllFive();
    // The run's own request has already left this window. What is left wearing
    // `role: 'user'` is our own bookkeeping — so there is nothing to protect,
    // and the fallback says so instead of pinning the last correction we wrote.
    // Before the frames were one registry, the window knew two of the five and
    // would have anchored on the evidence-check turn.
    const withoutTheRequest = w.history.filter((m) => m !== w.said);
    expect(currentRequestIndexOf(withoutTheRequest, w.said.content)).toBe(-1);
  });

  it('agrees with the window on a window that has no request at all', () => {
    const w = windowWithAllFive();
    const ours = [w.compacted, w.notice, w.delivered, w.schemaCheck, w.evidenceCheck];
    expect(currentRequestIndexOf(ours)).toBe(-1);
    expect(saidByPerson(contextOver(ours, 'hi'))).toEqual([]);
  });
});
