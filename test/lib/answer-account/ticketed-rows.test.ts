/**
 * Rows that travel by reference — the emptiness reader counts the dataset ticket left where
 * the app's declared rows were (take 4 of the demo video, agentfootprint 9.134.5).
 *
 * The field case: `pscale_client_health` returned 2 rows; the app declares `rowsAt: 'rows'`;
 * artifact placement was on. "In plain words" still said "It cannot be told whether the result
 * of pscale_client_health was empty: its shape is not declared", and the one-liner's tone
 * stayed UNKNOWN.
 *
 * Layer by layer, from the recording:
 *   1. the tool returned `coverage({ …, rows: [2 rows] })` — right;
 *   2. the app staged the rows (`stageDatasetArtifacts`) and put a ticket beside them,
 *      `dataset` / `datasets.rows` = `{ ref, kind: 'dataset/rows', rows: 2, sourceField: 'rows' }`
 *      — right;
 *   3. the app's after-tool `allow(replacement)` kept the ticket and dropped the rows from what
 *      the model reads ("source rows remain in the artifact store") — right, and the record keeps
 *      both: `tool_end.result` (the rows) and `tool_end.modelResult` (the ticket);
 *   4. the ONE emptiness reader (`core/agent/coverage/emptiness.ts`) reads the value the MODEL
 *      read, with the app's `rowsAt` — no list at `rows`, so `unknown` with "shape not
 *      declared". The FIRST wrong layer: the reader had no rule for rows that went to the store,
 *      and called a declared key undeclared.
 * Fixed in the reader, so every reader of result rows gets it (this run's calls, the calls before
 * a pause, earlier answers in view, the standing fold): the ticket that names the declared key is
 * counted; a ticket with no count, the library's own placement ticket and a declared key with no
 * list are never guessed — and the account says which (template set 10).
 *
 * Test types:
 *   functional  — the take-4 shape whole: a real paused-and-resumed run, artifact placement ON,
 *                 rows staged and ticketed, the app's projection dropping them, `present`:
 *                 tone ok, "returned 2 items", every check reachable;
 *   integration — "show me" points at the ticket's count (it resolves to 2 in the record); the
 *                 standing fold reads the same result as readable (`result-shape`); P1/P7;
 *   negative    — no `rowsAt`: still "shape is not declared" (true); a ticket with no count, the
 *                 rows dropped with no ticket, the library's placement ticket: each said for what
 *                 it is, never "not declared", never counted.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  allow,
  coverage,
  defineTool,
  inMemoryArtifacts,
  isInputPause,
  stageDatasetArtifacts,
  type LLMRequest,
  type Tool,
  type ToolMiddleware,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { assessAnswer } from '../../../src/core/agent/assessment/assess.js';
import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { showLeaves } from '../../../src/lib/answer-account/shown.js';
import type {
  AnswerAccount,
  AnswerAccountDeclarations,
  RowId,
} from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7 } from './helpers.js';

const SCOPE = { conversationId: 'ticketed-rows' };
const TOOL = 'pscale_client_health';
const ROWS = [
  { client: 'client-101', slow_intervals: 2 },
  { client: 'client-102', slow_intervals: 1 },
];
/** The app declares where the field tool keeps its rows (the boundary's wrapped `result.rows`). */
const DECLARED: AnswerAccountDeclarations = { tools: { [TOOL]: { rowsAt: 'rows' } } };

const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);

function explainChecked(
  recording: Recording,
  runId: string,
  declarations: AnswerAccountDeclarations = {},
): AnswerAccount {
  const account = accountForAnswer(recording, declarations, { runId });
  assertP1(account, recording, declarations);
  assertP7(account, recording, declarations);
  return account;
}

/** The field tool: rows in a declared boundary, staged into the store, the ticket beside them. */
function clientHealth(counted: boolean): Tool {
  return defineTool({
    name: TOOL,
    description: 'Clients with slow operations on a cluster over a window.',
    inputSchema: {
      type: 'object',
      properties: { cluster: { type: 'string' }, window: { type: 'string' } },
    },
    askOrAssume: { window: { ask: 'Which window?' } },
    execute: async (_args, ctx) => {
      const [published] = await stageDatasetArtifacts(
        [
          {
            key: 'rows',
            artifact: { kind: 'dataset/rows', mediaType: 'application/json', data: ROWS },
          },
        ],
        ctx.artifacts,
      );
      if (published?.artifact.status !== 'stored') throw new Error('the store refused the rows');
      const { ref, kind } = published.artifact.meta;
      const ticket = { ref, kind, ...(counted && { rows: ROWS.length }), sourceField: 'rows' };
      return coverage(
        {
          cluster: 'cluster-a',
          clients: 2,
          rows: ROWS,
          dataset: ticket,
          datasets: { rows: ticket },
        },
        {
          checked: [{ what: 'ps_client over the window asked' }],
          notChecked: [{ what: 'the other operation classes', kind: 'scope' }],
        },
      );
    },
  }) as Tool;
}

/** The app's model-data projection (an after-tool `allow(replacement)`): the rows stay in the store. */
function modelData(keepTickets: boolean): ToolMiddleware {
  return {
    name: 'model-data',
    onToolResult: (call) => {
      const value = call.result as { result?: Record<string, unknown> } | undefined;
      if (call.toolName !== TOOL || !Array.isArray(value?.result?.rows)) return allow();
      const { rows: _rows, dataset, datasets, ...rest } = value!.result!;
      void _rows;
      return allow(
        { ...value, result: keepTickets ? { ...rest, dataset, datasets } : rest },
        'Source rows remain in the artifact store; the model receives their dataset ticket.',
      );
    },
  };
}

const REF = /art_[A-Za-z0-9]{22}/;

/** The model: ask the tool, present the dataset it was handed, answer. */
function respond(request: LLMRequest) {
  const tools = request.messages.filter((m) => m.role === 'tool');
  const health = tools.find((m) => m.toolName === TOOL);
  if (health === undefined) {
    return {
      content: '',
      toolCalls: [{ id: 'c1', name: TOOL, args: { cluster: 'cluster-a' } }],
    };
  }
  const text = String(health.content);
  const ref = /"placed":\s*true/.test(text) ? undefined : REF.exec(text)?.[0];
  if (ref !== undefined && !tools.some((m) => m.toolName === 'present')) {
    return { content: '', toolCalls: [{ id: 'c2', name: 'present', args: { ref, as: 'table' } }] };
  }
  return { content: 'Two clients on cluster-a were slow; the table is on the Data panel.' };
}

interface Take4 {
  /** The rows' count reaches the ticket (`rows`). */
  readonly counted?: boolean;
  /** The app's projection keeps the tickets when it drops the rows. */
  readonly keepTickets?: boolean;
  /** The placement threshold — on in every run, as in the field. */
  readonly maxInlineChars?: number;
}

/** Run → the window is asked (a pause) → the person answers → the resumed leg's own recording. */
async function take4Leg(options: Take4 = {}) {
  const store = inMemoryArtifacts();
  const agent = Agent.create({
    provider: mock({ respond }),
    model: 'mock',
    maxIterations: 8,
    artifacts: {
      store,
      recordings: true,
      placement: { maxInlineChars: options.maxInlineChars ?? 50_000 },
    },
  })
    .tools([clientHealth(options.counted ?? true)])
    .toolMiddleware(modelData(options.keepTickets ?? true))
    .build();
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const p = e.payload as { ref?: string; kind?: string };
    if (p.kind === 'recording/run' && p.ref !== undefined) refs.push(p.ref);
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const paused = await agent.run({
      message: 'which clients were slow?',
      identity: SCOPE,
    } as never);
    if (!isInputPause(paused)) throw new Error('expected the arguments ask to pause the run');
    const p = paused as unknown as {
      checkpoint: unknown;
      awaitingInput: { requestId: string; fields: { id: string }[] };
    };
    const done = await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: Object.fromEntries(p.awaitingInput.fields.map((f) => [f.id, 'the last hour'])),
    });
    expect(isInputPause(done)).toBe(false);
  } finally {
    warn.mockRestore();
  }
  expect(refs).toHaveLength(1);
  const record = await store.get(SCOPE, refs[0]!);
  return {
    recording: JSON.parse(record!.data as string) as Recording,
    runId: record!.meta.origin?.runId as string,
  };
}

type Payload = Record<string, any>;
const healthEnd = (recording: Recording): Payload =>
  recording.events.find(
    (e) =>
      e.type === 'agentfootprint.stream.tool_end' && (e.payload as Payload).toolCallId === 'c1',
  )!.payload as Payload;

function resolve(value: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>((cur, seg) => (cur as Record<string, unknown> | undefined)?.[seg], value);
}

describe('the take-4 shape — rows that went to the artifact store are counted from their ticket', () => {
  it('the record: the tool returned the rows; the model read the ticket left in their place', async () => {
    const leg = await take4Leg();
    const end = healthEnd(leg.recording);
    expect(end.result.result.rows).toHaveLength(2);
    expect(end.modelResult.result).not.toHaveProperty('rows');
    expect(end.modelResult.result.datasets.rows).toMatchObject({
      kind: 'dataset/rows',
      rows: 2,
      sourceField: 'rows',
    });
    expect(
      leg.recording.events.some(
        (e) =>
          e.type === 'agentfootprint.agent.run_configured' &&
          (e.payload as Payload).artifacts?.placement === true,
      ),
    ).toBe(true);
  });

  it('with the app’s rowsAt: "returned 2 items", every check reachable, the tone ok', async () => {
    const leg = await take4Leg();
    const a = explainChecked(leg.recording, leg.runId, DECLARED);
    expect(a.unreachable).toEqual([]);
    expect(a.facts.checks.unreachable).toEqual([]);
    expect(a.facts.checks.reachable).toContain('empty-results');
    expect(a.summary.tone).toBe('ok');
    expect(rowText(a, 'found')).toContain('pscale_client_health returned 2 items.');
    const fact = a.facts.calls.find((c) => c.toolName === TOOL)!;
    expect(fact).toMatchObject({
      emptiness: 'non-empty',
      rows: 2,
      emptinessSource: 'app',
      countedAt: '/result/datasets/rows/rows',
      view: 'model-result',
    });
  });

  it('"show me" points at the ticket’s count, and the record holds 2 there', async () => {
    const leg = await take4Leg();
    const a = explainChecked(leg.recording, leg.runId, DECLARED);
    const leaves = showLeaves(a, leg.recording, DECLARED);
    const leaf = Object.entries(leaves).find(
      ([key, value]) => key.endsWith(':#emptiness') && (value as Payload).rows === 2,
    )?.[1] as { rows: number; at: string } | undefined;
    expect(leaf).toEqual({ rows: 2, at: '/modelResult/result/datasets/rows/rows' });
    expect(resolve(healthEnd(leg.recording), leaf!.at)).toBe(2);
  });

  it('the standing fold reads the same result as readable — the one reader, the same bytes', async () => {
    const leg = await take4Leg();
    const state = (leg.recording.snapshot as { sharedState: Record<string, unknown> }).sharedState;
    const shape = (declarations?: AnswerAccountDeclarations) =>
      assessAnswer({ snapshot: { sharedState: state } }, declarations).checked.find(
        (c) => c.check === 'result-shape',
      )!;
    // The present receipt is not a rowset; the ticketed result is, once the app names its key.
    expect(shape(DECLARED).ran).toBe(shape().ran + 1);
  });

  it('NEGATIVE: without the app’s rowsAt nothing is guessed — the shape is not declared', async () => {
    const leg = await take4Leg();
    const a = explainChecked(leg.recording, leg.runId);
    expect(a.unreachable.map((u) => u.sentence.text)).toEqual([
      'It cannot be told whether the result of pscale_client_health was empty: its shape is not declared.',
    ]);
    expect(a.summary.tone).toBe('unknown');
  });

  it('NEVER GUESSED: a ticket with no count is said for what it is — never "not declared"', async () => {
    const leg = await take4Leg({ counted: false });
    const a = explainChecked(leg.recording, leg.runId, DECLARED);
    expect(a.unreachable.map((u) => u.sentence.template.id)).toEqual([
      'unreachable.empty.uncountedTicket',
    ]);
    expect(a.unreachable[0]!.sentence.text).toBe(
      'It cannot be told whether the result of pscale_client_health was empty: it reached the ' +
        'model as a ticket to the artifact store, and the ticket does not say how many rows it holds.',
    );
    expect(a.unreachable[0]!.sentence.source).toBe('app');
    expect(a.summary.tone).toBe('unknown');
    expect(rowText(a, 'found')).toContain('pscale_client_health returned a result.');
  });

  it('NEGATIVE: the rows dropped with no ticket — the declared key holds no list, said so', async () => {
    const leg = await take4Leg({ keepTickets: false });
    const a = explainChecked(leg.recording, leg.runId, DECLARED);
    expect(a.unreachable.map((u) => u.sentence.text)).toEqual([
      'It cannot be told whether the result of pscale_client_health was empty: what the model ' +
        'read holds no list at the key the app declared for its rows.',
    ]);
    expect(a.unreachable[0]!.sentence.pointers).toContainEqual(
      expect.objectContaining({ kind: 'declaration', field: `tools.${TOOL}.rowsAt` }),
    );
    expect(a.summary.tone).toBe('unknown');
  });

  it('the library’s own placement ticket (the whole result placed) counts bytes — said, not guessed', async () => {
    const leg = await take4Leg({ maxInlineChars: 200 });
    const end = healthEnd(leg.recording);
    expect(end.modelResult).toMatchObject({ placed: true });
    for (const declarations of [DECLARED, {}]) {
      const a = explainChecked(leg.recording, leg.runId, declarations);
      expect(a.unreachable.map((u) => u.sentence.template.id)).toEqual([
        'unreachable.empty.uncountedTicket',
      ]);
      expect(a.summary.tone).toBe('unknown');
    }
  });
});
