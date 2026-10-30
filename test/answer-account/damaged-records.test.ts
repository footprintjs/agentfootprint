/**
 * The public reader is TOTAL over a damaged record — the contract
 * `account.ts` states ("it throws ONLY on a caller error … content it cannot
 * read is passed over and counted") and README law 8 ("bounded by
 * construction"), held for every reader at once rather than one field at a
 * time.
 *
 * A saved recording is JSON a reader is handed: it can hold any value at any
 * leaf. Each recording below — real runs on the mock, one per reader path the
 * account has (fixture A; scripts shown, attached and behind a closed fence;
 * declared coverage and an assumed value under the standing line; a resumed
 * leg; a typed answer's limits as data) — is damaged at ONE leaf at a time:
 * every payload, meta and state leaf (an array by its first and last
 * element), with a missing value, a wrong kind, a negative or fractional or
 * huge number, a 50,000-character string, an empty or a 2,000-fold list, and
 * a prototype key. After a JSON round trip — the saved form — the account
 * must come back, with its seven rows, within 128 KB, and the op's response
 * within 192 KB.
 *
 * Each site is damaged once, in the first recording that holds it. The full,
 * un-deduplicated sweep that found the readers this pins (131,053 builds over
 * the 1,054 recordings the account's tests read) is described in the change
 * note; this is its bounded regression copy.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  absent,
  Agent,
  codeRunnerTool,
  coverage,
  defineTool,
  inMemoryArtifacts,
  isInputPause,
  requestInput,
  type Tool,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import type { AnswerAccountDeclarations } from '../../src/answer-account/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { fixtureA, FLAGSHIP_RUN_ID, HOST_APP_DECLARATIONS, utf8Bytes } from './helpers.js';

interface Case {
  readonly name: string;
  readonly recording: Recording;
  readonly declarations?: AnswerAccountDeclarations;
  readonly runId?: string;
}

// ─── the recordings ───────────────────────────────────────────────────────

const PROGRAM = 'print(41 + 1)';

async function recorded(agent: Agent, message: string): Promise<Recording> {
  const recorder = recordRun(agent);
  await agent.run({ message });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return recording;
}

/** Two code calls; the answer shows one program and a block no call submitted, then opens a fence. */
function scriptsAgent(): Agent {
  let n = 0;
  return Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'run_code', args: { code: PROGRAM } },
            { id: 'c2', name: 'run_code', args: { code: 'exit(7)' } },
          ],
        },
        {
          content:
            `It printed 42.\n\n\`\`\`python\n${PROGRAM}\n\`\`\`\n\n` +
            '```python\nprint(0)\n```\n\nThe log:\n\n```text\nunfinished',
        },
      ] as never,
    }),
    model: 'mock',
  })
    .namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' })
    .tool(
      codeRunnerTool({
        runner: {
          id: 'answering',
          start: () =>
            Promise.resolve({
              id: 's1',
              execute: () =>
                Promise.resolve(
                  (n += 1) === 1
                    ? { ok: true, exitCode: 0, stdout: '42', stderr: '' }
                    : { ok: false, exitCode: 7, stdout: '', stderr: 'boom' },
                ),
              stop: () => Promise.resolve(),
            }),
        },
      }),
    )
    .scriptTravelsWithTheAnswer({ which: 'all', maxBytes: 8 })
    .answerLayer()
    .build();
}

/** A declared absence and an assumed argument, under the standing line. */
function declaringAgent(): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'find_vm', args: {} },
            { id: 'c2', name: 'search_logs', args: { service: 'checkout' } },
          ],
        },
        { content: 'No VM named web01, and no errors.' },
      ] as never,
    }),
    model: 'mock',
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
        name: 'search_logs',
        description: 'Error lines for one service over a look-back period.',
        inputSchema: {
          type: 'object',
          required: ['service', 'window'],
          properties: {
            service: { type: 'string' },
            window: { type: 'string', enum: ['1h', '2h', '24h'] },
          },
        },
        askOrAssume: { window: { assume: '2h' } },
        execute: async () => ({ errors: 0 }),
      }) as Tool,
    ])
    .answerLayer()
    .build();
}

/** A typed answer whose limits travel as data. */
function typedAgent(): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'replication_health', args: {} }] },
        { content: '{"healthy":true}' },
      ] as never,
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'replication_health',
        description: 'Replication health across the estate',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          coverage(
            { verdict: 'all pairs synchronized' },
            {
              checked: ['SRDF pair state'],
              notChecked: [{ what: 'NDM sessions', why: 'the API timed out' }],
              cannotCover: [{ what: 'host-side multipathing', why: 'no collector there' }],
            },
          ),
      }),
    )
    .outputSchema(z.object({ healthy: z.boolean() }).strict())
    .limitsTravelWithTheAnswer()
    .build();
}

/** The resumed leg of a run that paused for input after a declared absence. */
async function resumedLeg(): Promise<{ recording: Recording; runId: string }> {
  const SCOPE = { conversationId: 'damaged-records' };
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
            checked: [{ what: 'the RVTools export', short: 'RVTools' }],
            notChecked: [{ what: 'other names', kind: 'existence' }],
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
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e: { payload: unknown }) => {
    const ref = (e.payload as { ref?: string }).ref;
    if (ref !== undefined) refs.push(ref);
  });
  const paused = await agent.run({ message: 'is web01 still around?', identity: SCOPE } as never);
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  const p = paused as unknown as { checkpoint: unknown; awaitingInput: { requestId: string } };
  await agent.resume(p.checkpoint as never, {
    requestId: p.awaitingInput.requestId,
    values: { year: 2026 },
  });
  for (const ref of [...refs].reverse()) {
    const record = await store.get(SCOPE, ref);
    if (record?.meta.kind !== 'recording/run') continue;
    return {
      recording: JSON.parse(record.data as string) as Recording,
      runId: record.meta.origin?.runId as string,
    };
  }
  throw new Error('no recording was minted');
}

// ─── the damage ───────────────────────────────────────────────────────────

type Path = readonly (string | number)[];
const DELETE = Symbol('delete');
const LONG = 'y'.repeat(50_000);

/**
 * The damage one leaf gets, by the kind of value the writer put there: it
 * goes missing, turns null, or turns into another kind — then is wrong the
 * ways its own kind can be (a number negative, fractional or huge; a string
 * empty, 50,000 characters long or a prototype key; a list empty, an object
 * or 2,000-fold).
 */
function damageFor(original: unknown): ReadonlyArray<readonly [string, unknown]> {
  const common = [
    ['missing', DELETE],
    ['null', null],
  ] as const;
  if (typeof original === 'string') {
    return [
      ...common,
      ['1e12', 1e12],
      ['""', ''],
      ['"constructor"', 'constructor'],
      ['a 50,000-character string', LONG],
    ];
  }
  if (typeof original === 'number') {
    return [...common, ['"x"', 'x'], ['-1', -1], ['2.5', 2.5], ['1e12', 1e12]];
  }
  if (Array.isArray(original)) {
    return [
      ...common,
      ['"x"', 'x'],
      ['{}', {}],
      ['[]', []],
      ...(original.length > 0
        ? ([['the list 2,000-fold', Array.from({ length: 2000 }, () => original[0])]] as const)
        : []),
    ];
  }
  return [...common, ['"x"', 'x'], ['1', 1], ['[]', []], ['{}', {}]];
}

/** Every leaf under `value` (an array by its first and last element), as paths. */
function leaves(value: unknown, path: Path, out: Path[], depth = 0): Path[] {
  out.push(path);
  if (depth >= 5) return out;
  if (Array.isArray(value)) {
    if (value.length > 0) leaves(value[0], [...path, 0], out, depth + 1);
    if (value.length > 1) leaves(value[value.length - 1], [...path, -1], out, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) leaves(child, [...path, key], out, depth + 1);
  }
  return out;
}

type Doc = {
  events: Array<{ type: string; payload: unknown; meta: unknown }>;
  snapshot: Record<string, unknown>;
};

/**
 * What the reader reads of a recording — its events and the snapshot's two
 * states (`view.ts` · `recordingView`, `shown.ts` · `showLeaves`) — so each
 * damaged copy is cheap to make. The rest (the commit log, the structure) no
 * reader of the account opens.
 */
function readPart(recording: Recording): Doc {
  const doc = recording as unknown as Doc;
  const { sharedState, initialState } = doc.snapshot;
  return JSON.parse(
    JSON.stringify({
      events: doc.events,
      snapshot: { sharedState, ...(initialState !== undefined && { initialState }) },
      structure: null,
    }),
  ) as Doc;
}

/** Every damage site of `doc`: a path from its root, and a key to deduplicate it by. */
function sitesOf(doc: Doc): { key: string; path: Path }[] {
  const sites: { key: string; path: Path }[] = [];
  const byType = new Map<string, number[]>();
  doc.events.forEach((e, i) => byType.set(e.type, [...(byType.get(e.type) ?? []), i]));
  for (const [type, indices] of byType) {
    for (const index of new Set([indices[0]!, indices[indices.length - 1]!])) {
      const event = doc.events[index]!;
      for (const part of ['payload', 'meta'] as const) {
        for (const path of leaves(event[part], [], [])) {
          sites.push({
            key: `${type}|${index === indices[0] ? 'first' : 'last'}|${part}|${path.join('.')}`,
            path: ['events', index, part, ...path],
          });
        }
      }
    }
  }
  for (const part of ['sharedState', 'initialState']) {
    if (doc.snapshot[part] === undefined) continue;
    for (const path of leaves(doc.snapshot[part], [], [])) {
      sites.push({ key: `${part}|${path.join('.')}`, path: ['snapshot', part, ...path] });
    }
  }
  return sites;
}

/** The holder of `path`'s last step in `doc`, and that step — `undefined` when the path is gone. */
function slotOf(
  doc: unknown,
  path: Path,
): { holder: Record<string | number, unknown>; key: string | number } | undefined {
  let holder = doc as Record<string | number, unknown> | unknown[];
  for (const step of path.slice(0, -1)) {
    const next: unknown = Array.isArray(holder)
      ? holder[step === -1 ? holder.length - 1 : (step as number)]
      : holder[step];
    if (next === null || typeof next !== 'object') return undefined;
    holder = next as typeof holder;
  }
  const last = path[path.length - 1]!;
  const key = Array.isArray(holder) && last === -1 ? holder.length - 1 : last;
  return { holder: holder as Record<string | number, unknown>, key };
}

/** The saved form of `text` (a recording) with `value` put at `path`. */
function damaged(text: string, path: Path, value: unknown): Recording {
  const doc = JSON.parse(text) as unknown;
  const slot = slotOf(doc, path)!;
  if (value !== DELETE) slot.holder[slot.key] = value;
  else if (Array.isArray(slot.holder)) slot.holder.splice(slot.key as number, 1);
  else delete slot.holder[slot.key];
  return JSON.parse(JSON.stringify(doc)) as Recording;
}

/** What is wrong with the account of `recording` — `undefined` when nothing is. */
function problemOf(c: Case, recording: Recording): string | undefined {
  try {
    const account = accountForAnswer(
      recording,
      c.declarations,
      c.runId !== undefined ? { runId: c.runId } : undefined,
    );
    if (account.rows.length !== 7) return `${account.rows.length} rows`;
    const size = utf8Bytes(account);
    if (size > 128 * 1024) return `an account of ${size} bytes`;
    const shown = showLeaves(account, recording, c.declarations);
    const op = utf8Bytes({ account, shown });
    if (op > 192 * 1024) return `a response of ${op} bytes`;
    return undefined;
  } catch (error) {
    return `threw ${String(error).slice(0, 160)}`;
  }
}

// ─── the sweep ────────────────────────────────────────────────────────────

describe('the public reader on a record damaged at any one leaf', () => {
  const cases: Case[] = [];
  const seen = new Set<string>();
  beforeAll(async () => {
    const leg = await resumedLeg();
    cases.push(
      {
        name: 'scripts shown, attached and behind a closed fence',
        recording: await recorded(scriptsAgent(), 'compute'),
      },
      {
        name: 'declared coverage and an assumed value',
        recording: await recorded(declaringAgent(), 'web01?'),
      },
      {
        name: 'fixture A',
        recording: fixtureA(),
        declarations: HOST_APP_DECLARATIONS,
        runId: FLAGSHIP_RUN_ID,
      },
      { name: 'a resumed leg', recording: leg.recording, runId: leg.runId },
      {
        name: "a typed answer's limits as data",
        recording: await recorded(typedAgent(), 'healthy?'),
      },
    );
  });

  it.each([0, 1, 2, 3, 4])(
    'recording %i: every damage leaves a readable, bounded account',
    (i) => {
      const c = cases[i]!;
      const doc = readPart(c.recording);
      const text = JSON.stringify(doc);
      expect(problemOf(c, doc as unknown as Recording)).toBeUndefined();
      const problems: string[] = [];
      let built = 0;
      for (const site of sitesOf(doc)) {
        if (seen.has(site.key)) continue;
        seen.add(site.key);
        const slot = slotOf(doc, site.path);
        if (slot === undefined) continue;
        for (const [name, value] of damageFor(slot.holder[slot.key])) {
          built += 1;
          const problem = problemOf(c, damaged(text, site.path, value));
          if (problem !== undefined) problems.push(`${c.name} · ${site.key} = ${name}: ${problem}`);
        }
      }
      expect(built).toBeGreaterThan(100);
      expect(problems).toEqual([]);
    },
    120_000,
  );
});
