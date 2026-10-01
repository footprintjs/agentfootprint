/**
 * G17 — the library's own late lines are never the person's words.
 *
 * THE BUG. Three `role: 'user'` lines are served on a REQUEST and never
 * written to `history`: the time layer's late line (`arguments/serve.ts` ·
 * `timeLine`, opened with `TIME_LINE_SOURCE`), the figures dial's conclusion
 * (`evidence/figures.ts` · `figuresConclusionLine`, the same opening) and the
 * staged-refs nudge (`stagedRefs.ts` · `stagedRefsNudgeLine`). None of their
 * openings was in `LIBRARY_AUTHORED_PREFIXES`, so `isSaidByPerson` returned
 * TRUE for each — and since 9.134.1 (G16) the time line is the LAST message of
 * EVERY request under `.time()`. Any reader that finds "this turn" as the last
 * user-role message of what the model was sent anchored on the library's line:
 * the window's `currentRequestIndexOf`, a host's own predicate, and the mock
 * provider's default echo, which answered with the library's note.
 *
 * WHO WAS NOT FOOLED, and why it is pinned anyway: every library reader that
 * picks the person's message off `scope.history` (the time reader's input,
 * the honesty layer's person words and the arguments layer's quote corpus,
 * the window, the answer assessment, the evidence index) never saw these
 * lines — they are request-only. The pins below keep that true: the reader
 * reads the person's words, and no late line reaches the conversation.
 *
 * SAME CLASS, IN THE ANSWER ACCOUNT. `answer-account/facts/checked.ts` ·
 * `readBeforePause` took the LAST `role: 'user'` entry of the recorded history
 * as "the current request", so a library frame written after a resumed leg's
 * pre-pause results (an evidence correction, a budget wrap-up) hid them. It
 * reads through the one rule now (`common.ts` · `isPersonEntry`), as does
 * `inView.ts`'s turn distance.
 *
 * Test types (Convention 3): unit (the predicate over each real writer's
 * output; the registry holds every opening) · functional (a real `.time()`
 * run: the request's last line is the library's, the person's words are
 * found) · integration (the mock provider's echo through a real agent; the
 * time reader through a real run) · regression (each fooled reader, failing
 * on 9.134.1) · contract (one copy of the opening, exported).
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isLibraryAuthoredFrame,
  isSaidByPerson,
  LIBRARY_AUTHORED_PREFIXES,
  LIBRARY_NOTE_OPENING,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { TIME_LINE_SOURCE } from '../../src/core/agent/arguments/serve.js';
import {
  figuresConclusionLine,
  LIBRARY_NOTE_OPENING as FIGURES_OPENING,
} from '../../src/core/agent/evidence/figures.js';
import { stagedRefsNudgeLine } from '../../src/core/agent/stagedRefs.js';
import { currentRequestIndexOf } from '../../src/core/agent/window/currentRequest.js';
import { readBeforePause } from '../../src/lib/answer-account/facts/checked.js';
import { isPersonEntry, type ReadContext } from '../../src/lib/answer-account/facts/common.js';
import { STAGED_DATA_FRAME_PREFIX } from '../../src/lib/saidByPerson.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const ASKED = 'any errors in the last 2 hours?';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'g17-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const searchLogs = () =>
  defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback' } as never,
    execute: () => 'no errors',
  });

/** A `.time()` run: one call, then the answer — two requests, each ending with the time line. */
async function timedRun(reader: boolean) {
  const s = scripted([
    { content: '', toolCalls: [{ id: 'c1', name: 'search_logs', args: {} }] },
    { content: 'No errors.' },
  ]);
  const agent = Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 4 })
    .tool(searchLogs())
    .time({ zone: LA, ...(reader && { reader: englishTimeReader() }) })
    .build();
  await agent.run({ message: ASKED, time: { now: NOW } });
  return { agent, requests: s.requests };
}

const lastOf = (req: LLMRequest): LLMMessage => req.messages[req.messages.length - 1]!;

// ─── the predicate over each request-only writer ─────────────────────

describe('isSaidByPerson — false for every line the library serves on a request', () => {
  it('the time line: the LAST message of a real `.time()` request is the library’s, not the person’s', async () => {
    const { requests } = await timedRun(false);
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      const last = lastOf(req);
      expect(last.role).toBe('user');
      expect(last.content.startsWith(TIME_LINE_SOURCE)).toBe(true);
      expect(isSaidByPerson(last)).toBe(false);
      expect(isLibraryAuthoredFrame(last)).toBe(true);
    }
  });

  it('the figures conclusion, the staged-refs nudge and a retry’s ephemeral feedback', () => {
    const conclusion = figuresConclusionLine([{ value: '53.2', shape: 'figure' } as never])!;
    const nudge = stagedRefsNudgeLine({
      refs: [{ ref: 'art_x', kind: 'dataset/rows' } as never],
      refsOmitted: 0,
      tools: ['compute'],
    });
    for (const content of [conclusion, nudge]) {
      expect(isSaidByPerson({ role: 'user', content })).toBe(false);
      expect(isLibraryAuthoredFrame({ role: 'user', content })).toBe(true);
    }
    // The reliability gate's retry line is the APP's text, on one attempt's request — never a
    // person's turn, whatever it says.
    expect(isSaidByPerson({ role: 'user', content: 'Return valid JSON.', ephemeral: true })).toBe(
      false,
    );
    // …and the person's own words still are.
    expect(isSaidByPerson({ role: 'user', content: ASKED })).toBe(true);
    expect(isSaidByPerson({ role: 'user', content: ASKED, ephemeral: false })).toBe(true);
  });
});

// ─── the registry ────────────────────────────────────────────────────

describe('one owner of the opening', () => {
  it('the registry holds the late lines’ openings, and the writers emit the registry’s copy', () => {
    expect(LIBRARY_AUTHORED_PREFIXES).toContain(LIBRARY_NOTE_OPENING);
    expect(LIBRARY_AUTHORED_PREFIXES).toContain(STAGED_DATA_FRAME_PREFIX);
    expect(TIME_LINE_SOURCE).toBe(LIBRARY_NOTE_OPENING);
    expect(FIGURES_OPENING).toBe(LIBRARY_NOTE_OPENING);
    // The bytes the model reads did not move.
    expect(LIBRARY_NOTE_OPENING).toBe(
      '[A note from the library that runs the tools — not from the person, and not a correction ' +
        'from them: when you answer, answer the person directly, as you would from the tool ' +
        'results alone.]',
    );
  });
});

// ─── the readers it fooled ───────────────────────────────────────────

describe('a reader that finds "this turn" in what the model was sent', () => {
  it('the window’s current request is the person’s message, not the library’s line', async () => {
    const { requests } = await timedRun(false);
    for (const req of requests) {
      const at = currentRequestIndexOf(req.messages);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(req.messages[at]!.content).toBe(ASKED);
    }
  });

  it('a host’s "last message the person said" over the request is the person’s words', async () => {
    const { requests } = await timedRun(false);
    for (const req of requests) {
      const said = [...req.messages].reverse().find((m) => isSaidByPerson(m));
      expect(said?.content).toBe(ASKED);
    }
  });

  it('the mock provider’s default echo answers the person, not the library’s note', async () => {
    const agent = Agent.create({ provider: mock(), model: 'mock', maxIterations: 2 })
      .time({ zone: LA })
      .build();
    const result = await agent.run({ message: ASKED, time: { now: NOW } });
    expect(result).toBe(`echo: ${ASKED}`);
  });
});

// ─── the readers it did not fool (pinned) ────────────────────────────

describe('the readers of the conversation never see a late line', () => {
  it('the time reader reads the person’s words; no late line reaches history', async () => {
    const { agent } = await timedRun(true);
    const readings = ((agent.findings() as { kind: string; quote?: string }[]) ?? []).filter(
      (r) => r.kind === 'time-reading',
    );
    expect(readings.length).toBeGreaterThan(0);
    for (const r of readings) {
      expect(ASKED).toContain(r.quote);
      expect(LIBRARY_NOTE_OPENING).not.toContain(r.quote);
    }
    const history = (agent.getSnapshot()?.sharedState as { history?: LLMMessage[] }).history ?? [];
    expect(history.some((m) => m.role === 'user' && m.content === ASKED)).toBe(true);
    expect(history.some((m) => m.content.startsWith(LIBRARY_NOTE_OPENING))).toBe(false);
  });
});

// ─── the same class in the answer account ────────────────────────────

describe('the answer account’s "current request" is the person’s', () => {
  /** A resumed leg's recorded history: two calls answered before the pause, then a frame. */
  const history = [
    { role: 'user', content: 'check both arrays' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'p1', name: 'array_a', args: {} },
        { id: 'p2', name: 'array_b', args: {} },
      ],
    },
    { role: 'tool', content: '{}', toolCallId: 'p1', toolName: 'array_a' },
    { role: 'tool', content: '{}', toolCallId: 'p2', toolName: 'array_b' },
    { role: 'assistant', content: 'Array A holds 53.2 TB.' },
    // The evidence gate's correction — a library frame in the user role, AFTER the results.
    { role: 'user', content: '[evidence check — these values appear in no tool result: 53.2]' },
    { role: 'assistant', content: 'Both arrays answered.' },
  ];
  const ctx = { resumedLeg: true, view: { state: { history } } } as unknown as ReadContext;

  it('names the calls answered before the pause even when a library frame follows them', () => {
    const before = readBeforePause(ctx, { ids: new Set<string>() } as never);
    expect(before.map((c) => c.toolCallId)).toEqual(['p1', 'p2']);
  });

  it('isPersonEntry: the one rule, read off a record', () => {
    expect(isPersonEntry(history[0])).toBe(true);
    expect(isPersonEntry(history[5])).toBe(false);
    expect(isPersonEntry({ role: 'user', content: `${TIME_LINE_SOURCE} x` })).toBe(false);
    expect(isPersonEntry({ role: 'user', content: 'hi', ephemeral: true })).toBe(false);
    expect(isPersonEntry({ role: 'user', content: 'hi', injectedBy: { injectionId: 'i' } })).toBe(
      false,
    );
    expect(isPersonEntry({ role: 'tool', content: 'hi' })).toBe(false);
    expect(isPersonEntry('hi')).toBe(false);
  });
});
