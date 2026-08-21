/**
 * The repeated-call nudge (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The measured failure this addresses: a traced production run in which a model
 * called one tool three times with byte-identical arguments and got a
 * byte-identical result each time, because the arguments named a filter the
 * backend silently ignored. Nothing inside the conversation could see it.
 *
 * The truth table being pinned:
 *   same tool + same args + same result, 1st time  → no note
 *   same tool + same args + same result, 2nd time  → NOTE, once
 *   same tool + same args + same result, 3rd time  → no second note
 *   same tool + DIFFERENT args                     → no note
 *   same tool + same args + DIFFERENT result       → no note (that is progress)
 *   different tool + same args + same result       → no note
 *   key order differs but args are equal           → still a repeat
 *
 * …plus: the note is a NOTE (the call still ran, nothing was refused), the
 * event carries fingerprints and never values, and `repeatedCallNudge: false`
 * is byte-identical to every earlier release.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import {
  noteRepeatedCall,
  repeatedCallLedgers,
  REPEATED_CALL_THRESHOLD,
} from '../../src/core/agent/repeatedCall.js';
import type { RepeatedCallLedger } from '../../src/core/agent/repeatedCall.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** The last tool message the model would have read. */
function toolMessages(events: readonly AgentfootprintEvent[]): string[] {
  return events
    .filter((e) => e.type === 'agentfootprint.stream.tool_end')
    .map((e) => String((e as { payload?: { result?: unknown } }).payload?.result ?? ''));
}

/**
 * An agent whose one tool answers from a script, driven by the model calling it
 * N times with the given arguments and then finishing.
 */
function agentCalling(
  calls: readonly { name: string; args: Record<string, unknown> }[],
  results: (name: string, args: Record<string, unknown>, nth: number) => string,
  options: { readonly nudge?: boolean } = {},
): { agent: Agent; history: () => string[] } {
  const seen = new Map<string, number>();
  const history: string[] = [];
  const make = (name: string) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' }, n: { type: 'number' } },
      },
      execute: (args: Record<string, unknown>) => {
        const nth = (seen.get(name) ?? 0) + 1;
        seen.set(name, nth);
        return Promise.resolve(results(name, args, nth));
      },
    });
  const names = [...new Set(calls.map((c) => c.name))];
  let builder = Agent.create({
    provider: mock({
      replies: [
        ...calls.map((c, i) => ({
          toolCalls: [{ id: `c${i}`, name: c.name, args: c.args }],
        })),
        { content: 'done' },
      ],
    }),
    model: 'm',
    maxIterations: calls.length + 2,
    ...(options.nudge === false && { repeatedCallNudge: false as const }),
  });
  for (const name of names) builder = builder.tool(make(name));
  const agent = builder.build();
  agent.on('agentfootprint.stream.tool_end', (e) => {
    history.push(String((e as { payload?: { result?: unknown } }).payload?.result ?? ''));
  });
  return { agent, history: () => history };
}

/** Every note the model actually read, from the conversation history. */
async function notesFrom(agent: Agent, message = 'go'): Promise<string[]> {
  await agent.run({ message });
  const checkpoint = agent.checkpoint();
  return (checkpoint?.history ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => String(m.content))
    .filter((c) => c.includes('[identical call:'));
}

// ─── 1. UNIT — the truth table, on the pure function ─────────────────

describe('noteRepeatedCall — unit truth table', () => {
  const same = { q: 'Q3', n: 1 };

  it('first landing is never a note', () => {
    const out = noteRepeatedCall(undefined, 'lookup', same, 'rows');
    expect(out.occurrences).toBe(1);
    expect(out.note).toBeUndefined();
  });

  it('SECOND identical landing is the note, exactly once', () => {
    let ledger: RepeatedCallLedger | undefined;
    const notes: (string | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const out = noteRepeatedCall(ledger, 'lookup', same, 'rows');
      ledger = out.ledger;
      notes.push(out.note);
    }
    expect(notes.map((n) => n !== undefined)).toEqual([false, true, false, false]);
    expect(REPEATED_CALL_THRESHOLD).toBe(2);
  });

  it('DIFFERENT arguments are not a repeat', () => {
    const first = noteRepeatedCall(undefined, 'lookup', { q: 'Q3' }, 'rows');
    const second = noteRepeatedCall(first.ledger, 'lookup', { q: 'Q4' }, 'rows');
    expect(second.note).toBeUndefined();
    expect(second.occurrences).toBe(1);
  });

  it('a DIFFERENT result is progress, not a repeat', () => {
    // Polling a job until its status changes is exactly this shape.
    const first = noteRepeatedCall(undefined, 'status', same, 'running');
    const second = noteRepeatedCall(first.ledger, 'status', same, 'done');
    expect(second.note).toBeUndefined();
  });

  it('a DIFFERENT tool with the same args and result is not a repeat', () => {
    const first = noteRepeatedCall(undefined, 'a', same, 'rows');
    const second = noteRepeatedCall(first.ledger, 'b', same, 'rows');
    expect(second.note).toBeUndefined();
  });

  it('argument KEY ORDER does not matter — the same call is the same call', () => {
    const first = noteRepeatedCall(undefined, 'lookup', { q: 'Q3', n: 1 }, 'rows');
    const second = noteRepeatedCall(first.ledger, 'lookup', { n: 1, q: 'Q3' }, 'rows');
    expect(second.note).toBeDefined();
  });

  it('nested key order does not matter either, but ARRAY order does', () => {
    const a = noteRepeatedCall(undefined, 't', { f: { x: 1, y: 2 } }, 'r');
    const b = noteRepeatedCall(a.ledger, 't', { f: { y: 2, x: 1 } }, 'r');
    expect(b.note).toBeDefined();
    const c = noteRepeatedCall(undefined, 't', { list: [1, 2] }, 'r');
    const d = noteRepeatedCall(c.ledger, 't', { list: [2, 1] }, 'r');
    expect(d.note).toBeUndefined();
  });

  it('the note says what happened, what follows, and what to do instead', () => {
    const first = noteRepeatedCall(undefined, 'search', { q: 'x' }, 'nothing');
    const note = noteRepeatedCall(first.ledger, 'search', { q: 'x' }, 'nothing').note ?? '';
    expect(note).toContain("'search'");
    expect(note).toContain('will not change it');
    expect(note).toContain('change the arguments');
    // Never just "stop": a model told only to stop tends to stop answering.
    expect(note).toContain('act on what you have');
  });

  it('the ledger holds FINGERPRINTS, never the arguments or the result', () => {
    const secretArgs = { token: 'sk-live-supersecret' };
    const secretResult = 'the customer email is a@b.c';
    const out = noteRepeatedCall(undefined, 'lookup', secretArgs, secretResult);
    const serialized = JSON.stringify(out.ledger);
    expect(serialized).not.toContain('sk-live-supersecret');
    expect(serialized).not.toContain('a@b.c');
    expect(out.argsFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(out.resultFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─── 2. INTEGRATION — the note reaches the model ─────────────────────

describe('repeated-call nudge — integration', () => {
  it('THE FIELD CASE: three identical calls, one note on the second', async () => {
    const { agent } = agentCalling(
      [
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q3' } },
      ],
      () => 'the same 40 rows',
    );
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => events.push(e));

    const notes = await notesFrom(agent);
    expect(notes).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect((events[0] as { payload?: { occurrences?: number } }).payload?.occurrences).toBe(2);
  });

  it('is a NOTE, not a refusal: the call ran and the result is intact', async () => {
    const { agent } = agentCalling(
      [
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q3' } },
      ],
      () => 'the same 40 rows',
    );
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.run({ message: 'go' });

    // The tool ran twice — the framework never blocked anything.
    expect(events.filter((e) => e.type === 'agentfootprint.stream.tool_end')).toHaveLength(2);
    // `tool_end` keeps reporting the tool's OWN truth, un-decorated.
    expect(toolMessages(events).every((r) => !r.includes('[identical call:'))).toBe(true);
    // …and the model's history carries the decorated one.
    const history = agent.checkpoint()?.history ?? [];
    const decorated = history.filter(
      (m) => m.role === 'tool' && String(m.content).includes('[identical call:'),
    );
    expect(decorated).toHaveLength(1);
    // The tool's own answer is still there, whole, beside the note.
    expect(String(decorated[0]?.content)).toContain('the same 40 rows');
  });

  it('different arguments never earn a note', async () => {
    const { agent } = agentCalling(
      [
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q4' } },
        { name: 'lookup', args: { q: 'Q5' } },
      ],
      () => 'rows',
    );
    expect(await notesFrom(agent)).toHaveLength(0);
  });

  it('a changing result never earns a note', async () => {
    const { agent } = agentCalling(
      [
        { name: 'poll', args: {} },
        { name: 'poll', args: {} },
        { name: 'poll', args: {} },
      ],
      (_n, _a, nth) => `status: step ${nth}`,
    );
    expect(await notesFrom(agent)).toHaveLength(0);
  });

  it('a repeated ERROR result is also the loop, and is named', async () => {
    // A tool that keeps failing the same way is the same class of loop.
    const failing = defineTool({
      name: 'broken',
      description: 'always fails the same way',
      execute: () => Promise.reject(new Error('upstream 503')),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: '1', name: 'broken', args: {} }] },
          { toolCalls: [{ id: '2', name: 'broken', args: {} }] },
          { content: 'giving up' },
        ],
      }),
      model: 'm',
      maxIterations: 5,
    })
      .tool(failing)
      .build();
    expect(await notesFrom(agent)).toHaveLength(1);
  });
});

// ─── 3. ZERO-DELTA ───────────────────────────────────────────────────

describe('repeated-call nudge — zero-delta', () => {
  it('repeatedCallNudge: false leaves the results byte-identical and the ledger absent', async () => {
    const { agent } = agentCalling(
      [
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q3' } },
        { name: 'lookup', args: { q: 'Q3' } },
      ],
      () => 'the same 40 rows',
      { nudge: false },
    );
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => events.push(e));
    await agent.run({ message: 'go' });

    const history = agent.checkpoint()?.history ?? [];
    const toolTurns = history.filter((m) => m.role === 'tool');
    expect(toolTurns).toHaveLength(3);
    for (const turn of toolTurns) expect(String(turn.content)).toBe('the same 40 rows');
    expect(events).toHaveLength(0);
    // Nothing on the run's state either — see the state-key pin below for the
    // stronger form of this.
    const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown> | undefined;
    expect(Object.keys(state ?? {}).filter((k) => /repeat/i.test(k))).toEqual([]);
  });

  it('a turn that never repeats is byte-identical whether the dial is on or off', async () => {
    const build = (nudge: boolean) =>
      agentCalling(
        [
          { name: 'lookup', args: { q: 'Q3' } },
          { name: 'lookup', args: { q: 'Q4' } },
        ],
        (_n, a) => `rows for ${String(a.q)}`,
        { nudge },
      ).agent;
    const on = build(true);
    const off = build(false);
    await on.run({ message: 'go' });
    await off.run({ message: 'go' });
    const contentOf = (a: Agent) =>
      (a.checkpoint()?.history ?? []).filter((m) => m.role === 'tool').map((m) => m.content);
    expect(contentOf(on)).toEqual(contentOf(off));
  });

  it('THE STATE PIN: the counters never touch tracked state — same keys, on or off', async () => {
    // The failure this pins: a ledger written to scope on every landing would
    // put a new key in `sharedState`, in the commit log, in the narrative and
    // in every recording — for every agent that merely upgraded, on a turn
    // that repeated nothing. "Zero-cost when unused" is a claim about the
    // RECORD, not only about the answer.
    const build = (nudge: boolean) =>
      agentCalling(
        [
          { name: 'lookup', args: { q: 'Q3' } },
          { name: 'lookup', args: { q: 'Q4' } },
        ],
        (_n, a) => `rows for ${String(a.q)}`,
        { nudge },
      ).agent;
    const on = build(true);
    const off = build(false);
    await on.run({ message: 'go' });
    await off.run({ message: 'go' });
    const keysOf = (a: Agent): string[] =>
      Object.keys((a.getLastSnapshot()?.sharedState ?? {}) as Record<string, unknown>).sort();
    expect(keysOf(on)).toEqual(keysOf(off));
    // And the whole record, not just its key set: nothing named after this
    // feature appears anywhere a reader looks.
    const snapshot = JSON.stringify(on.getLastSnapshot() ?? {});
    expect(snapshot).not.toContain('repeatedToolCalls');
    expect(snapshot.toLowerCase()).not.toContain('repeatedcall');
  });

  it('a turn that DOES repeat still adds no state key — the note and the event carry it', async () => {
    // The nudge changes what the model reads and what the event stream says.
    // It does not change the shape of the run's state, so a consumer asserting
    // a key set is unaffected either way.
    const build = (nudge: boolean) =>
      agentCalling(
        [
          { name: 'lookup', args: { q: 'Q3' } },
          { name: 'lookup', args: { q: 'Q3' } },
        ],
        () => 'the same 40 rows',
        { nudge },
      ).agent;
    const on = build(true);
    const off = build(false);
    const notes: AgentfootprintEvent[] = [];
    on.on('agentfootprint.tools.repeated_call', (e) => notes.push(e));
    await on.run({ message: 'go' });
    await off.run({ message: 'go' });
    const keysOf = (a: Agent): string[] =>
      Object.keys((a.getLastSnapshot()?.sharedState ?? {}) as Record<string, unknown>).sort();
    expect(keysOf(on)).toEqual(keysOf(off));
    expect(JSON.stringify(on.getLastSnapshot() ?? {})).not.toContain('repeatedToolCalls');
    // The fact still landed — in the two channels that carry it.
    expect(notes).toHaveLength(1);
    const said = (a: Agent) =>
      (a.checkpoint()?.history ?? [])
        .filter((m) => m.role === 'tool')
        .map((m) => String(m.content));
    expect(said(on).some((c) => c.includes('[identical call:'))).toBe(true);
    expect(said(off).some((c) => c.includes('[identical call:'))).toBe(false);
  });

  it('the counters are per RUN: the same call in a later turn is not a repeat', async () => {
    // The counters live beside the run, keyed by runId. A conversation that
    // asks the same question again tomorrow has not repeated itself inside one
    // answer, and telling it so would be a note about the wrong thing.
    const lookup = defineTool({
      name: 'lookup',
      description: 'the lookup tool',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: () => Promise.resolve('the same 40 rows'),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'lookup', args: { q: 'Q3' } }] },
          { content: 'done' },
          { toolCalls: [{ id: 'b', name: 'lookup', args: { q: 'Q3' } }] },
          { content: 'done again' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(lookup)
      .build();
    const notes: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => notes.push(e));
    await agent.run({ message: 'first turn' });
    await agent.run({ message: 'second turn' });
    // One identical call in each of two runs is not a repeat in either.
    expect(notes).toHaveLength(0);
    const tools = (agent.checkpoint()?.history ?? [])
      .filter((m) => m.role === 'tool')
      .map((m) => String(m.content));
    expect(tools.every((c) => c === 'the same 40 rows')).toBe(true);
  });
});

// ─── 4. SECURITY — the event carries no payload ──────────────────────

describe('repeated-call nudge — security', () => {
  it('the typed event names fingerprints and never the arguments or result', async () => {
    const { agent } = agentCalling(
      [
        { name: 'lookup', args: { q: 'sk-live-secret' } },
        { name: 'lookup', args: { q: 'sk-live-secret' } },
      ],
      () => 'customer email: a@b.c',
    );
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => events.push(e));
    await agent.run({ message: 'go' });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain('a@b.c');
    const payload = (events[0] as unknown as { payload?: Record<string, unknown> }).payload ?? {};
    expect(Object.keys(payload).sort()).toEqual([
      'argsFingerprint',
      'iteration',
      'occurrences',
      'resultFingerprint',
      'toolCallId',
      'toolName',
    ]);
  });
});

// ─── 5. PROPERTY — at most one note per distinct call ────────────────

describe('repeated-call nudge — property', () => {
  it('for any N identical landings, exactly one note is produced', () => {
    for (const n of [2, 3, 5, 12]) {
      let ledger: RepeatedCallLedger | undefined;
      let notes = 0;
      for (let i = 0; i < n; i += 1) {
        const out = noteRepeatedCall(ledger, 't', { a: 1 }, 'r');
        ledger = out.ledger;
        if (out.note !== undefined) notes += 1;
      }
      expect(notes).toBe(1);
    }
  });
});

// ─── 6. PERFORMANCE — the ledger stays small ─────────────────────────

describe('repeated-call nudge — performance', () => {
  it('holds one small entry per distinct call, not one per landing', () => {
    let ledger: RepeatedCallLedger | undefined;
    for (let i = 0; i < 100; i += 1) {
      ledger = noteRepeatedCall(ledger, 'lookup', { page: i % 5 }, 'rows').ledger;
    }
    expect(Object.keys(ledger ?? {})).toHaveLength(5);
    // Keys are short: tool name + two 8-hex digests.
    for (const key of Object.keys(ledger ?? {})) expect(key.length).toBeLessThan(40);
  });

  it('the holder keeps runs apart and is bounded rather than growing forever', () => {
    const ledgers = repeatedCallLedgers(2);
    ledgers.write('run-1', { k: 1 });
    ledgers.write('run-2', { k: 1 });
    // Two runs, two independent tallies — one run can never read another's.
    expect(ledgers.read('run-1')).toEqual({ k: 1 });
    expect(ledgers.read('run-2')).toEqual({ k: 1 });
    // A third run evicts the least recently written. The cost of an eviction
    // is one note never given, never a note given wrongly.
    ledgers.write('run-3', { k: 1 });
    expect(ledgers.read('run-1')).toBeUndefined();
    expect(ledgers.read('run-3')).toEqual({ k: 1 });
  });
});

// ─── 7. ROI — what the turn cost before ──────────────────────────────

describe('repeated-call nudge — ROI', () => {
  it('the loop is named at the SECOND call, not after the budget is spent', async () => {
    // Before: three identical calls, three identical results, one wasted turn
    // and nothing in the loop that could say so. After: the second landing
    // carries the fact, in the one channel the model reads.
    const { agent } = agentCalling(
      [
        { name: 'search', args: { filter: 'unhonoured' } },
        { name: 'search', args: { filter: 'unhonoured' } },
      ],
      () => 'the same unfiltered rows',
    );
    const notes = await notesFrom(agent);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2 times this turn');
  });
});

// ─── 8. `repeatedWhen: 'arguments'` — the screen/UI-tool fix ──────────
//
// The gap this closes: a tool that stamps a fresh value into every result
// (a version number, a timestamp, a cursor) never produces two matching
// default-mode keys, so the detector above is silently inert for it even
// when the model fires the byte-identical call twice. `repeatedWhen:
// 'arguments'` fingerprints on the arguments alone.

describe('noteRepeatedCall — arguments-only mode, unit truth table', () => {
  it('fires on the SECOND identical-argument call even though the result differs', () => {
    const first = noteRepeatedCall(
      undefined,
      'render_screen',
      { view: 'home' },
      'rendered home @v1',
      'arguments',
    );
    const second = noteRepeatedCall(
      first.ledger,
      'render_screen',
      { view: 'home' },
      'rendered home @v2',
      'arguments',
    );
    expect(first.note).toBeUndefined();
    expect(second.note).toBeDefined();
    expect(second.mode).toBe('arguments');
    // The wording must not claim the RESULT matched — it did not.
    expect(second.note).not.toContain('returned exactly this result');
    expect(second.note).toContain("'render_screen'");
    expect(second.note).toContain("repeatedWhen: 'arguments'");
  });

  it('DIFFERENT arguments are still not a repeat in arguments mode', () => {
    const first = noteRepeatedCall(undefined, 'render_screen', { view: 'home' }, 'v1', 'arguments');
    const second = noteRepeatedCall(
      first.ledger,
      'render_screen',
      { view: 'settings' },
      'v2',
      'arguments',
    );
    expect(second.note).toBeUndefined();
  });

  it('THE DEFAULT IS UNCHANGED: the exact same landings, without the mode, produce no note', () => {
    // Same tool, same arguments, same differing results as the first test —
    // the only difference is the mode is omitted. This is the failure the
    // feature exists to fix: it must reproduce here, and stay reproduced,
    // for every tool that has not opted in.
    const first = noteRepeatedCall(
      undefined,
      'render_screen',
      { view: 'home' },
      'rendered home @v1',
    );
    const second = noteRepeatedCall(
      first.ledger,
      'render_screen',
      { view: 'home' },
      'rendered home @v2',
    );
    expect(second.note).toBeUndefined();
    expect(second.mode).toBeUndefined();
    expect(first.mode).toBeUndefined();
  });

  it('a THIRD identical-argument landing adds no second note, same as default mode', () => {
    let ledger: RepeatedCallLedger | undefined;
    const notes: (string | undefined)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const out = noteRepeatedCall(ledger, 't', { a: 1 }, `result-${i}`, 'arguments');
      ledger = out.ledger;
      notes.push(out.note);
    }
    expect(notes.map((n) => n !== undefined)).toEqual([false, true, false]);
  });
});

describe('repeated-call nudge — arguments-only mode, integration', () => {
  it('(a) THE FIX: a tool stamping a fresh value into every result now trips the detector', async () => {
    // The measured failure: a screen/UI tool returns a version/timestamp/
    // cursor that changes every call, so the default fingerprint (which
    // folds the result in) never repeats — the detector was silently inert
    // for it even on a byte-identical re-fire.
    let calls = 0;
    const screenTool = defineTool({
      name: 'render_screen',
      description: 'renders the named screen and stamps a fresh version',
      inputSchema: { type: 'object', properties: { view: { type: 'string' } } },
      repeatedWhen: 'arguments',
      execute: (args: Record<string, unknown>) => {
        calls += 1;
        return Promise.resolve(`rendered ${String(args.view)} @v${calls}`);
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'render_screen', args: { view: 'home' } }] },
          { toolCalls: [{ id: 'b', name: 'render_screen', args: { view: 'home' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(screenTool)
      .build();

    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => events.push(e));
    agent.on('agentfootprint.stream.tool_end', (e) => events.push(e));

    const notes = await notesFrom(agent);
    expect(notes).toHaveLength(1);

    const repeated = events.filter((e) => e.type === 'agentfootprint.tools.repeated_call');
    expect(repeated).toHaveLength(1);
    expect((repeated[0] as { payload?: { mode?: string } }).payload?.mode).toBe('arguments');

    // (c) THE ANTI-GUARANTEE: the tool ran BOTH times. The note never
    // suppressed execution — `calls` is the tool's own execution counter,
    // incremented inside `execute`, which only runs if the framework
    // actually called it.
    expect(calls).toBe(2);
    const toolEnds = events.filter((e) => e.type === 'agentfootprint.stream.tool_end');
    expect(toolEnds).toHaveLength(2);
    // And the two results genuinely differed — the note fired DESPITE that,
    // not because of a coincidental match.
    const resultsSeen = toolEnds.map(
      (e) => (e as { payload?: { result?: unknown } }).payload?.result,
    );
    expect(resultsSeen[0]).not.toBe(resultsSeen[1]);
  });

  it('(b) a tool WITHOUT the option is unaffected by the identical shape of stamped result', async () => {
    // Byte-for-byte the same scenario as (a), minus `repeatedWhen` — proves
    // the option is opt-in and the default detector stays inert for a tool
    // whose result legitimately changes every call.
    let calls = 0;
    const screenTool = defineTool({
      name: 'render_screen',
      description: 'renders the named screen and stamps a fresh version',
      inputSchema: { type: 'object', properties: { view: { type: 'string' } } },
      execute: (args: Record<string, unknown>) => {
        calls += 1;
        return Promise.resolve(`rendered ${String(args.view)} @v${calls}`);
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'render_screen', args: { view: 'home' } }] },
          { toolCalls: [{ id: 'b', name: 'render_screen', args: { view: 'home' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(screenTool)
      .build();

    expect(await notesFrom(agent)).toHaveLength(0);
    // (c) Still ran both times — absence of the option suppresses nothing.
    expect(calls).toBe(2);
  });

  it('the typed event carries `mode` only for the arguments-only match', async () => {
    const screenTool = defineTool({
      name: 'render_screen',
      description: 'renders a screen',
      inputSchema: { type: 'object', properties: {} },
      repeatedWhen: 'arguments',
      execute: () => Promise.resolve(`v${Date.now()}-${Math.random()}`),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'render_screen', args: {} }] },
          { toolCalls: [{ id: 'b', name: 'render_screen', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(screenTool)
      .build();
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.tools.repeated_call', (e) => events.push(e));
    await agent.run({ message: 'go' });
    expect(events).toHaveLength(1);
    const payload = (events[0] as unknown as { payload?: Record<string, unknown> }).payload ?? {};
    expect(payload.mode).toBe('arguments');
    // Additive: every other key from the default shape is still there.
    expect(Object.keys(payload).sort()).toEqual([
      'argsFingerprint',
      'iteration',
      'mode',
      'occurrences',
      'resultFingerprint',
      'toolCallId',
      'toolName',
    ]);
  });
});
