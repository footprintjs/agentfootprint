/**
 * The part of an answer before a pause, read from what the RESUMED record
 * carries (`facts/pausedLeg.ts` · `readPausedLeg`) — never claimed absent while
 * the record holds it.
 *
 * The field case (take-2 video, agentfootprint 9.134.3): every answer that
 * continued after the person confirmed a time reading said "This answer
 * continued after a pause; what happened before the pause is not in this
 * record" with tone UNKNOWN — while the same recording's state held the calls
 * answered before the pause (history), what their tools declared
 * (`coverageDeclared`) and the state the run paused with (`initialState`), and
 * the Time tab drew those rows.
 *
 * Test types:
 *   functional    — a real paused-and-resumed `.time()` run (the take-2 shape): the call before
 *                   the pause is listed in "It checked" / "It did not check" / "It found", read
 *                   from the state; the one-liner says what is NOT recoverable (that part's
 *                   events) and nothing else;
 *   integration   — a tool before the pause that declared `absent()` with an existence limit: its
 *                   declaration is read from the committed `coverageDeclared` rows, its empty
 *                   result is judged, and the signal it raises reaches the one-liner and its tone;
 *   negative      — a record that does not hold the paused state (`initialState` stripped) keeps
 *                   the "not in this record" sentences — the only case in which they are true;
 *   security      — every pointer resolves and every var is an allow-listed leaf (P1/P7) on
 *                   every account here, including the new `coverageDeclared` state leaves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  defineTool,
  englishTimeReader,
  inMemoryArtifacts,
  isInputPause,
  requestInput,
  type Tool,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import type { AnswerAccount, RowId } from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7 } from './helpers.js';

const SCOPE = { conversationId: 'paused-leg' };

const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);
const allIds = (a: AnswerAccount) => a.rows.flatMap((r) => r.lines.map((l) => l.template.id));
const allText = (a: AnswerAccount) =>
  [...a.rows.flatMap((r) => r.lines.map((l) => l.text)), a.summary.sentence.text].join('\n');

function explainChecked(recording: Recording, runId: string): AnswerAccount {
  const account = accountForAnswer(recording, undefined, { runId });
  assertP1(account, recording, {});
  assertP7(account, recording, {});
  return account;
}

/** The agent's own per-run recordings (`artifacts: { recordings: true }`), newest last. */
function minted(
  agent: { on: (t: string, f: (e: { payload: unknown }) => void) => unknown },
  store: ReturnType<typeof inMemoryArtifacts>,
) {
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const ref = (e.payload as { ref?: string }).ref;
    if (ref !== undefined) refs.push(ref);
  });
  return async () => {
    const out: { recording: Recording; runId: string }[] = [];
    for (const ref of refs) {
      const record = await store.get(SCOPE, ref);
      if (record?.meta.kind !== 'recording/run') continue;
      out.push({
        recording: JSON.parse(record.data as string) as Recording,
        runId: record.meta.origin?.runId as string,
      });
    }
    return out;
  };
}

// ─── The take-2 shape: a real paused-and-resumed `.time()` run ─────────────

const NOW = '2026-10-01T14:08:49Z';
const QUESTION =
  'what clients on SHISOLPLPAP006 had operations slower than 200 ms from 6:25 to 6:45 AM on October 1';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NOW) + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const clusterLookup = (): Tool =>
  defineTool({
    name: 'cluster_lookup',
    description: 'Is the cluster known?',
    inputSchema: { type: 'object', properties: {} },
    execute: () => '[{"cluster":"SHISOLPLPAP006"}]',
  }) as Tool;

const clientHealth = (): Tool =>
  defineTool({
    name: 'pscale_client_health',
    description: 'Clients over a window.',
    inputSchema: {
      type: 'object',
      properties: {
        cluster: { type: 'string' },
        start: { type: 'string' },
        stop: { type: 'string' },
      },
    },
    askOrAssume: { start: { ask: 'From when?' }, stop: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start', as: 'iso' },
          to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
        },
      ],
    } as never,
    execute: () => '{"rows":[{"client":"shsectraplw101"},{"client":"shsectraplw102"}]}',
  }) as Tool;

/** Run → the time ask pauses → the person confirms → the resumed leg's own recording. */
async function take2Leg(): Promise<{ recording: Recording; runId: string }> {
  const store = inMemoryArtifacts();
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c0', name: 'cluster_lookup', args: {} }] },
        {
          toolCalls: [
            { id: 'c1', name: 'pscale_client_health', args: { cluster: 'SHISOLPLPAP006' } },
          ],
        },
        { content: 'Two clients on SHISOLPLPAP006 were slow between 6:25 and 6:45 AM.' },
      ],
    }),
    model: 'mock',
    maxIterations: 6,
    artifacts: { store, recordings: true },
  })
    .tools([clusterLookup(), clientHealth()])
    .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
    .build();
  const read = minted(agent as never, store);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const paused = await agent.run({
      message: QUESTION,
      identity: SCOPE,
      time: { now: NOW },
    } as never);
    if (!isInputPause(paused)) throw new Error('expected the time ask to pause the run');
    const p = paused as unknown as {
      checkpoint: unknown;
      awaitingInput: { requestId: string; fields: { enum?: string[] }[] };
    };
    const done = await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: { f1: p.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  const legs = await read();
  expect(legs).toHaveLength(1); // a paused run mints nothing; the resumed leg mints its own
  return legs[0]!;
}

describe('a resumed `.time()` run — the part before the pause is read from the record', () => {
  it('the call before the pause is listed in every call row, read from the state', async () => {
    const leg = await take2Leg();
    // The record really holds it: the state the run paused with, and the committed history.
    const snapshot = leg.recording.snapshot as { initialState?: { history?: unknown[] } };
    expect(Array.isArray(snapshot.initialState?.history)).toBe(true);
    const a = explainChecked(leg.recording, leg.runId);
    expect(a.run.value?.resumedLeg).toBe(true);
    expect(rowText(a, 'checked')).toContain(
      'Before the pause, the model read what came back from cluster_lookup; the tool did not say what it checked.',
    );
    expect(rowText(a, 'not-checked')).toContain(
      'cluster_lookup did not say what it left unchecked.',
    );
    expect(rowText(a, 'found')).toContain('Before the pause, cluster_lookup returned 1 item.');
    expect(a.facts.beforePause).toEqual([
      expect.objectContaining({
        toolName: 'cluster_lookup',
        toolCallId: 'c0',
        emptiness: 'non-empty',
        rows: 1,
      }),
    ]);
  });

  it('never claims the part before the pause is absent — it names what is not recoverable: that part’s events', async () => {
    const leg = await take2Leg();
    const a = explainChecked(leg.recording, leg.runId);
    const text = allText(a);
    expect(text).not.toContain('what happened before the pause is not in this record');
    expect(text).not.toContain('What the tools found before the pause is not in this record');
    expect(text).not.toContain('Anything before the pause is not in this record');
    for (const id of [
      'summary.resumed',
      'found.beforePause',
      'checked.beforePause.none',
      'notChecked.beforePause',
      'wrong.beforePause',
    ]) {
      expect(allIds(a), id).not.toContain(id);
    }
    expect(allIds(a)).toContain('wrong.beforePause.held');
    expect(a.summary.sentence.text).toMatch(
      /This answer continued after a pause; this record holds the state the run kept from before it, not that part's events\.$/,
    );
  });
});

// ─── A declaration before the pause, read from `coverageDeclared` ──────────

describe('a tool before the pause that declared its search — its rows are judged', () => {
  async function declaredLeg() {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'find_vm', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'ask_year', args: {} }] },
          { content: 'No VM named web01 was found.' },
        ],
      }),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .tools([
        defineTool({
          name: 'find_vm',
          description: 'Find a VM by name.',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            absent({
              what: 'a VM named web01',
              checked: [{ what: 'the RVTools export of 2026-09-30', short: 'the RVTools export' }],
              notChecked: [{ what: 'whether web01 exists under another name', kind: 'existence' }],
            }),
        }) as Tool,
        defineTool({
          name: 'ask_year',
          description: 'Which year?',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            }),
        }) as Tool,
      ])
      .build();
    const read = minted(agent as never, store);
    const paused = await agent.run({ message: 'is web01 still around?', identity: SCOPE } as never);
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const p = paused as unknown as { checkpoint: unknown; awaitingInput: { requestId: string } };
    await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const [leg] = await read();
    return leg!;
  }

  it('what it checked, did not check and found are read from the committed state', async () => {
    const leg = await declaredLeg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(rowText(a, 'checked')).toEqual(
      expect.arrayContaining(['Before the pause, find_vm said it checked:', 'the RVTools export']),
    );
    expect(rowText(a, 'not-checked')).toEqual(
      expect.arrayContaining([
        'find_vm says it did not check:',
        'whether web01 exists under another name',
      ]),
    );
    expect(rowText(a, 'found')).toContain(
      'Before the pause, find_vm looked for a VM named web01 and found none.',
    );
  });

  it('the existence limit it declared is a signal — the one-liner and its tone carry it', async () => {
    const leg = await declaredLeg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(a.signals.map((s) => s.id)).toContain('existence-not-checked');
    expect(a.summary.tone).toBe('warn');
    expect(a.summary.sentence.text).toContain(
      'find_vm says it did not check whether web01 exists under another name.',
    );
    expect(a.facts.beforePause[0]).toMatchObject({
      toolName: 'find_vm',
      emptiness: 'declared-absent',
      coverage: { kind: 'absent', lookedFor: 'a VM named web01', checked: 1, notChecked: 1 },
    });
  });

  it('NEGATIVE: a record without the paused state keeps "not in this record" — the one case it is true', async () => {
    const leg = await declaredLeg();
    const snapshot = { ...(leg.recording.snapshot as Record<string, unknown>) };
    delete snapshot.initialState;
    const recording = { ...leg.recording, snapshot } as Recording;
    const a = explainChecked(recording, leg.runId);
    expect(a.summary.sentence.text).toMatch(
      /what happened before the pause is not in this record\./i,
    );
    expect(allIds(a)).toEqual(
      expect.arrayContaining(['found.beforePause', 'notChecked.beforePause', 'wrong.beforePause']),
    );
    expect(a.facts.beforePause).toEqual([]);
    // Nothing is judged from a part the record does not hold.
    expect(a.signals).toEqual([]);
  });
});
