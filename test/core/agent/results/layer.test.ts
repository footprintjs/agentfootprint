/**
 * The results layer (honesty layer 3, step 7b) — end to end through real
 * agents on a scripted provider.
 *
 * Law: a result says what it covered, its period included; silence about a
 * declared period is recorded as silence.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL   — each verdict filed once per call: not-held, covered,
 *                    partly-held, unknown (a non-empty result too — adopted
 *                    Q33), undeclared (a `ToolPeriod` tool whose result
 *                    declared nothing); the coverage channel carries the
 *                    declared period; the event carries the verdict word only;
 *                    without the layer, a declared period and a ToolPeriod a
 *                    ToolProvider served are each dev-warned once per tool;
 *   - INTEGRATION  — both chart shapes; the loop head (a re-entry through the
 *                    schema re-ask files nothing twice, and a call id reused —
 *                    by a resumed leg after `resumeOnError`, or across two
 *                    batches of one run — is judged again: each batch once
 *                    per run, never by call id); the window strategy
 *                    beside it; a paused batch resumed; the limits block's
 *                    `Period:` line and a typed answer's `periods`; a continued
 *                    conversation (the checkpoint door, this turn only); the
 *                    join with the inputs layer; the answer account's lines;
 *   - SECURITY     — no instant on the event or the row; the model is served
 *                    nothing new;
 *   - BYTE IDENTITY — nothing declared, nothing mounted: no `sf-results`, no
 *                    run constant, no batch stamp, no row (and the unarmed
 *                    references in test/core/tools/reference/ stay green).
 * Unit: test/core/agent/results/subflow.test.ts. Property and boundary:
 * test/core/agent/coverage-period.test.ts. Performance and load:
 * test/core/agent/results/performance.test.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import {
  Agent,
  absent,
  coverage,
  defineTool,
  describedResult,
  isPaused,
  pauseHere,
  RunCheckpointError,
  slidingWindow,
  type DeclaredPeriod,
  type PeriodRow,
  type Tool,
} from '../../../../src/index.js';
import { accountForAnswer, recordRun } from '../../../../src/observe.js';
import { staticTools } from '../../../../src/tool-providers/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../../src/core/runCheckpoint.js';
import { _resetPeriodWarnings } from '../../../../src/core/agent/coverage/period.js';
import { _resetPeriodUnjudgedWarnings } from '../../../../src/core/agent/stages/toolCalls.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

/** A scripted provider: one reply per call, or an `Error` the call throws (a vendor outage). */
function scripted(script: readonly (Reply | Error)[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'results-layer-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        if (reply instanceof Error) throw reply;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const call = (id: string, name: string, args: object): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const Q = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const EXPORT_HELD = { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' };
const SOURCE = { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly backup export' };

/** The period each call's result declares — by host, so one script can ask several. */
const PERIODS: Record<string, DeclaredPeriod | undefined> = {
  stale: { queried: Q, held: EXPORT_HELD, readAt: '2026-09-26T10:00:03Z' }, // not-held
  fresh: { queried: Q, held: { from: '2026-09-01T00:00:00Z', to: '2026-09-27T00:00:00Z' } }, // covered
  half: { queried: Q, held: { from: '2026-09-01T00:00:00Z', to: '2026-09-26T09:30:00Z' } }, // partly
  blind: { queried: Q, held: 'unknown' }, // unknown
  silent: undefined,
};

/** A backup search: rows → describedResult, none → absent — each with the period its host declares. */
function backupRuns(extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'backup_runs',
    description: 'Failed backup runs for one host, read from the nightly backup export.',
    inputSchema: {
      type: 'object',
      required: ['host'],
      properties: { host: { type: 'string' }, rows: { type: 'boolean' } },
    },
    execute: async (args) => {
      const host = String(args.host);
      const period = PERIODS[host];
      if (args.rows === true) {
        return describedResult({
          facts: [{ entity: host, failed: 2 }],
          provenance: SOURCE,
          ...(period !== undefined && { period }),
        });
      }
      return absent({
        what: `failed backup runs for ${host}`,
        checked: ['every job in the 02:00 export'],
        provenance: SOURCE,
        ...(period !== undefined && { period }),
      });
    },
  });
  return { ...tool, ...extra } as Tool;
}

/** A log search whose look-back period is RULED and DECLARED a period argument (a `ToolPeriod`). */
function searchLogs(result: (args: Record<string, unknown>) => unknown = () => []): Tool {
  return defineTool({
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
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => result(args),
  });
}

const periodRows = (agent: Agent): PeriodRow[] =>
  (agent.findings() ?? []).filter((r): r is PeriodRow => r.kind === 'period');

type Event = { type: string; payload: Record<string, unknown> };
function events(agent: Agent): Event[] {
  const out: Event[] = [];
  agent.on('*', (e) => out.push({ type: e.type, payload: e.payload as never }));
  return out;
}

const reasonsOf = async (agent: Agent): Promise<string[]> =>
  ((await agent.assessment())?.reasons ?? []).map((r) => r.reason);

afterEach(() => {
  _resetPeriodWarnings();
  _resetPeriodUnjudgedWarnings();
  vi.restoreAllMocks();
});

// ─── FUNCTIONAL ──────────────────────────────────────────────────────

describe('a result that declares its period — one verdict per call', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`the 02:00 export asked about 09:00–10:00: not-held, filed, evented, folded (${reactMode})`, async () => {
      const m = scripted([
        call('c1', 'backup_runs', { host: 'stale' }),
        answer('No failed backups in the last hour.'),
      ]);
      const agent = Agent.create({ provider: m.provider as never, model: 'm', reactMode })
        .tool(backupRuns())
        .resultsLayer()
        .build();
      const seen = events(agent);
      await agent.run({ message: 'Any failed backups on stale in the last hour?' });
      const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;

      // The run constant says the layer was armed.
      expect(state.honestyLayers).toEqual({ results: true });

      // The coverage channel carries the declared period — the tool's own words.
      const coverageRows = state.coverageDeclared as { period?: DeclaredPeriod }[];
      expect(coverageRows).toHaveLength(1);
      expect(coverageRows[0]!.period).toEqual(PERIODS.stale);
      const absentEvent = seen.find((e) => e.type === 'agentfootprint.tools.absent')!;
      expect(absentEvent.payload.period).toEqual(PERIODS.stale);
      expect(absentEvent.payload.provenance).toEqual(SOURCE);

      // ONE period row, the verdict, no instants.
      expect(periodRows(agent)).toEqual([
        {
          kind: 'period',
          turn: 1,
          toolCallId: 'c1',
          toolName: 'backup_runs',
          iteration: 1,
          verdict: 'not-held',
        },
      ]);
      const verdictEvents = seen.filter((e) => e.type === 'agentfootprint.findings.period');
      expect(verdictEvents.map((e) => e.payload)).toEqual([
        { toolCallId: 'c1', toolName: 'backup_runs', iteration: 1, turn: 1, verdict: 'not-held' },
      ]);

      // The standing: not sure — nothing matched, AND the store does not hold the hour asked about.
      const standing = (await agent.assessment())!;
      expect(standing.standing).toBe('not-sure');
      expect(standing.reasons.map((r) => [r.reason, r.layer])).toEqual([
        ['declared-absent', 3],
        ['period-not-held', 3],
      ]);
      expect(standing.checked.find((c) => c.check === 'result-period')).toMatchObject({
        layer: 3,
        ran: 1,
        of: 1,
      });

      // The model read the period as declared, and nothing more (the layer serves nothing).
      const served = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
      expect(String(served.content)).toContain(
        '"period":{"queried":{"from":"2026-09-26T09:00:00Z","to":"2026-09-26T10:00:00Z"}',
      );
      expect(String(served.content)).toContain('"read_at":"2026-09-26T10:00:03Z"');
      expect(String(served.content)).not.toContain('not-held');
    });
  }

  it('covered — no period reason; the verdict still counts as a check that ran', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'fresh', rows: true }),
        answer('2 failed.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'failed backups on fresh?' });
    expect(periodRows(agent).map((r) => r.verdict)).toEqual(['covered']);
    const standing = (await agent.assessment())!;
    expect(standing.reasons).toEqual([]);
    expect(standing.standing).toBe('consistent');
    expect(standing.checked.map((c) => c.check)).toContain('result-period');
  });

  it('partly-held — the store holds only part of the hour asked about', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'half', rows: true }),
        answer('2 failed.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'failed backups on half?' });
    expect(periodRows(agent).map((r) => r.verdict)).toEqual(['partly-held']);
    expect(await reasonsOf(agent)).toEqual(['period-partly-held']);
  });

  it('unknown — held: "unknown" on a NON-empty result still reads not sure (adopted Q33)', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'blind', rows: true }),
        answer('2 failed.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'failed backups on blind?' });
    expect(periodRows(agent).map((r) => r.verdict)).toEqual(['unknown']);
    const standing = (await agent.assessment())!;
    expect(standing.standing).toBe('not-sure');
    expect(standing.reasons.map((r) => r.reason)).toEqual(['period-unknown']);
  });

  it('a result that declares no period, from a tool with none: no row — nothing was declared', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'silent' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'failed backups on silent?' });
    expect(periodRows(agent)).toEqual([]);
    expect((await agent.assessment())!.checked.map((c) => c.check)).not.toContain('result-period');
  });

  it('a batch of three calls: one row each, in batch order, filed in ONE merge', async () => {
    const agent = Agent.create({
      provider: scripted([
        {
          content: '',
          toolCalls: [
            { id: 'a', name: 'backup_runs', args: { host: 'stale' } },
            { id: 'b', name: 'backup_runs', args: { host: 'fresh', rows: true } },
            { id: 'c', name: 'backup_runs', args: { host: 'silent' } },
          ],
        },
        answer('done'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'three hosts' });
    expect(periodRows(agent).map((r) => [r.toolCallId, r.verdict])).toEqual([
      ['a', 'not-held'],
      ['b', 'covered'],
    ]);
    const writes = agent
      .getSnapshot()!
      .commitLog.filter((bundle) =>
        (bundle.trace as readonly { path: string }[]).some((t) => t.path === 'findingsLedger'),
      );
    expect(writes).toHaveLength(1);
  });
});

describe('a tool that declares a period argument (ToolPeriod) — silence is recorded as silence', () => {
  it('a bare result: `undeclared`, joined to the inputs layer’s row for the same call', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(searchLogs())
      .build(); // no .resultsLayer(): a registered ToolPeriod arms it by itself
    await agent.run({ message: 'any errors on checkout?' });
    const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
    expect(state.honestyLayers).toEqual({ inputs: true, results: true });
    expect(periodRows(agent)).toEqual([
      {
        kind: 'period',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'search_logs',
        iteration: 1,
        verdict: 'undeclared',
        argument: 'window',
      },
    ]);
    const standing = (await agent.assessment())!;
    const undeclared = standing.reasons.find((r) => r.reason === 'period-undeclared')!;
    expect(undeclared.layer).toBe(3);
    // THE JOIN: the period row, and the argument row that says who chose the period.
    const ledger = agent.findings()!;
    const pointed = undeclared.witness.map((w) =>
      w.kind === 'state' ? ledger[Number(w.path.split('/')[1])]!.kind : 'history',
    );
    expect(pointed).toEqual(['period', 'argument']);
  });

  it('a result that declares its period: the verdict is the period’s, and still names the argument', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'search_logs', { service: 'checkout' }), answer('No errors.')])
        .provider as never,
      model: 'm',
    })
      .tool(
        searchLogs(() =>
          coverage([], {
            checked: ['every error line the log store holds for checkout'],
            period: {
              queried: Q,
              held: { from: '2026-09-19T10:00:00Z', to: '2026-09-26T10:00:00Z' },
            },
          }),
        ),
      )
      .build();
    await agent.run({ message: 'any errors on checkout?' });
    expect(periodRows(agent)).toMatchObject([{ verdict: 'covered', argument: 'window' }]);
    const reasons = await reasonsOf(agent);
    expect(reasons).not.toContain('period-undeclared');
    // The empty rowset inside a declared boundary is a declared absence; the
    // default the tool's rule filled is still an assumption.
    expect(reasons).toEqual(['argument-assumed', 'declared-absent']);
  });
});

describe('without the layer — a declared period is recorded, never judged in silence', () => {
  it('the coverage row carries it, no verdict is filed, and dev mode says so once per tool', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const agent = Agent.create({
        provider: scripted([
          call('c1', 'backup_runs', { host: 'stale' }),
          call('c2', 'backup_runs', { host: 'stale' }),
          answer('none'),
        ]).provider as never,
        model: 'm',
      })
        .tool(backupRuns())
        .build();
      await agent.run({ message: 'twice' });
      const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
      expect(state).not.toHaveProperty('honestyLayers');
      expect((state.coverageDeclared as { period?: unknown }[]).map((r) => r.period)).toEqual([
        PERIODS.stale,
        PERIODS.stale,
      ]);
      expect(agent.findings()).toBeUndefined();
      const warnings = warn.mock.calls.map((c) => String(c[0]));
      expect(
        warnings.filter((w) =>
          w.includes("tool 'backup_runs' declared the period its read covered"),
        ),
      ).toHaveLength(1);
      expect(warnings.join('\n')).toContain('.resultsLayer()');
    } finally {
      disableDevMode();
    }
  });

  it('a ToolPeriod the build could not see (a ToolProvider served it): the calls run, and dev mode says no verdict is filed', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const agent = Agent.create({
        provider: scripted([
          call('c1', 'search_logs', { service: 'checkout', window: '1h' }),
          call('c2', 'search_logs', { service: 'payments', window: '1h' }),
          answer('No errors.'),
        ]).provider as never,
        model: 'm',
      })
        .toolProvider(staticTools([searchLogs()]))
        .inputsLayer() // the rules are honoured; the period is nobody's to judge
        .build();
      await agent.run({ message: 'any errors?' });
      const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
      expect(state.honestyLayers).toEqual({ inputs: true });
      expect(state).not.toHaveProperty('toolResultsIteration');
      expect(periodRows(agent)).toEqual([]);
      const warnings = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((w) => w.includes("tool 'search_logs' declares which argument sets its period"));
      expect(warnings).toHaveLength(1); // two calls, one warning per tool
      expect(warnings[0]).toContain('.resultsLayer()');
    } finally {
      disableDevMode();
    }
  });
});

// ─── INTEGRATION ─────────────────────────────────────────────────────

describe('the loop head — every re-entry reads the batch in place, and files nothing twice', () => {
  it('a schema re-ask loops back through the layer: still ONE period row', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'stale' }),
        answer('not json'),
        answer('{"failed":0}'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .outputSchema({ parse: (v: string) => JSON.parse(v) as unknown }, { retries: 1 })
      .build();
    await agent.run({ message: 'failed backups?' });
    const visits = agent
      .getSnapshot()!
      .commitLog.filter((b) => b.stageId === 'sf-results' && (b.tags ?? []).length > 0);
    expect(visits.length).toBe(3); // iteration 1, after the batch, after the re-ask
    expect(periodRows(agent)).toHaveLength(1);
  });

  it('beside a window strategy the layer heads the loop and Compact still runs after it', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'stale' }),
        call('c2', 'backup_runs', { host: 'fresh', rows: true }),
        answer('done'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .window(slidingWindow({ keepRecentTurns: 4 }))
      .build();
    await agent.run({ message: 'two hosts' });
    const order = agent
      .getSnapshot()!
      .commitLog.map((b) => b.stageId)
      .filter((id) => id === 'sf-results' || id === 'compact' || id === 'tool-calls');
    // After each batch the loop lands on the layer, then the window.
    const afterFirstBatch = order.slice(
      order.indexOf('tool-calls') + 1,
      order.indexOf('tool-calls') + 3,
    );
    expect(afterFirstBatch).toEqual(['sf-results', 'sf-results']);
    expect(order).toContain('compact');
    expect(periodRows(agent).map((r) => [r.toolCallId, r.verdict])).toEqual([
      ['c1', 'not-held'],
      ['c2', 'covered'],
    ]);
  });

  it('a batch paused mid-way: after the resume, the loop head judges the whole batch', async () => {
    const pausing = defineTool({
      name: 'confirm_host',
      description: 'Ask the operator to confirm a host.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => pauseHere({ question: 'Which host?' }),
    });
    const agent = Agent.create({
      provider: scripted([
        {
          content: '',
          toolCalls: [
            { id: 'a', name: 'backup_runs', args: { host: 'stale' } },
            { id: 'b', name: 'confirm_host', args: {} },
          ],
        },
        answer('done'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .tool(pausing)
      .resultsLayer()
      .build();
    const paused = await agent.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    expect(periodRows(agent)).toEqual([]); // the loop head has not run since the batch
    if (!isPaused(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, 'host-103');
    expect(periodRows(agent).map((r) => [r.toolCallId, r.verdict])).toEqual([['a', 'not-held']]);
  });

  it('a batch paused BEFORE anything stamped it (an agent without the layer) is still judged once when it completes', async () => {
    const pausing = defineTool({
      name: 'confirm_host',
      description: 'Ask the operator to confirm a host.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => pauseHere({ question: 'Which host?' }),
    });
    const batch = {
      content: '',
      toolCalls: [
        { id: 'a', name: 'backup_runs', args: { host: 'stale' } },
        { id: 'b', name: 'confirm_host', args: {} },
      ],
    };
    // Paused on an agent with no results layer — a checkpoint an older build
    // writes the same way — so the batch carries no stamp…
    const before = Agent.create({
      provider: scripted([batch, answer('done')]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .tool(pausing)
      .build();
    const paused = await before.run({ message: 'go' });
    if (!isPaused(paused)) throw new Error('expected a pause');
    // …and resumed on one that mounts it: the batch is stamped as it completes.
    const after = Agent.create({
      provider: scripted([answer('done')]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .tool(pausing)
      .resultsLayer()
      .build();
    await after.resume(paused.checkpoint, 'host-103');
    expect(periodRows(after).map((r) => [r.toolCallId, r.iteration, r.verdict])).toEqual([
      ['a', 1, 'not-held'],
    ]);
  });
});

describe('a call id is not a call — each batch is judged once per run, whatever ids it reuses', () => {
  // A synthetic-id provider numbers its calls from a counter local to the
  // provider instance (`<prefix>-call-${++toolCallSeq}`), so a resumed leg in a
  // fresh process repeats the ids of the leg that failed; nothing stops a
  // provider reusing an id across batches of one run either.
  const failThenResume = async (first: string, second: string): Promise<Agent> => {
    const failing = Agent.create({
      provider: scripted([
        call('gemini-call-1', 'backup_runs', { host: first, rows: true }),
        new Error('503 Service Unavailable'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    const failed = await failing
      .run({ message: 'Failed backups in the last hour?' })
      .catch((e) => e);
    if (!(failed instanceof RunCheckpointError)) throw new Error(`expected a checkpoint error`);
    expect(failed.checkpoint.findingsLedger?.map((r) => [r.kind, r.toolCallId])).toEqual([
      ['period', 'gemini-call-1'],
    ]);
    // A fresh process: a fresh agent and a fresh provider, whose counter restarts.
    const resumed = Agent.create({
      provider: scripted([
        call('gemini-call-1', 'backup_runs', { host: second, rows: true }),
        answer('2 failed.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await resumed.resumeOnError(failed.checkpoint);
    return resumed;
  };

  it('resumeOnError: the resumed leg’s call is judged although the failed leg filed its id', async () => {
    const resumed = await failThenResume('fresh', 'stale');
    expect(periodRows(resumed).map((r) => [r.toolCallId, r.turn, r.iteration, r.verdict])).toEqual([
      ['gemini-call-1', 1, 1, 'covered'], // the failed leg's row, restored as a record
      ['gemini-call-1', 1, 1, 'not-held'], // this leg's call — the same id, another read
    ]);
    const standing = (await resumed.assessment())!;
    expect(standing.standing).toBe('not-sure');
    expect(standing.reasons.map((r) => r.reason)).toEqual(['period-not-held']);
  });

  it('…and the fold never lets a later row under the same id hide an earlier verdict', async () => {
    const resumed = await failThenResume('stale', 'fresh');
    expect(periodRows(resumed).map((r) => r.verdict)).toEqual(['not-held', 'covered']);
    // The failed leg's result is still in the history the answer was written from.
    expect(await reasonsOf(resumed)).toEqual(['period-not-held']);
  });

  for (const [first, second, verdicts] of [
    ['fresh', 'stale', ['covered', 'not-held']],
    ['stale', 'fresh', ['not-held', 'covered']],
  ] as const) {
    const label = verdicts.join(' → ');
    it(`one run, one id in two batches (${label}): two rows, each its own batch’s period`, async () => {
      const agent = Agent.create({
        provider: scripted([
          call('c1', 'backup_runs', { host: first, rows: true }),
          call('c1', 'backup_runs', { host: second, rows: true }),
          answer('2 failed.'),
        ]).provider as never,
        model: 'm',
      })
        .tool(backupRuns())
        .resultsLayer()
        .build();
      await agent.run({ message: 'failed backups, twice' });
      // Each batch reads ITS OWN coverage row (by iteration), never the
      // earlier batch's under the same id.
      expect(periodRows(agent).map((r) => [r.toolCallId, r.iteration, r.verdict])).toEqual([
        ['c1', 1, verdicts[0]],
        ['c1', 2, verdicts[1]],
      ]);
      expect(await reasonsOf(agent)).toEqual(['period-not-held']);
    });
  }

  it('the batch stamp rides ToolCalls’ commit only under the arm', async () => {
    const stampedBy = async (armed: boolean): Promise<string[]> => {
      let builder = Agent.create({
        provider: scripted([call('c1', 'backup_runs', { host: 'fresh', rows: true }), answer('ok')])
          .provider as never,
        model: 'm',
      }).tool(backupRuns());
      if (armed) builder = builder.resultsLayer();
      const agent = builder.build();
      await agent.run({ message: 'x' });
      return agent
        .getSnapshot()!
        .commitLog.filter((b) =>
          (b.trace as readonly { path: string }[]).some((t) => t.path === 'toolResultsIteration'),
        )
        .map((b) => `${b.stageId}=${JSON.stringify(b.overwrite.toolResultsIteration)}`);
    };
    expect(await stampedBy(true)).toEqual(['tool-calls=1']);
    expect(await stampedBy(false)).toEqual([]);
  });
});

describe('the person reads it — only under .limitsTravelWithTheAnswer()', () => {
  it('a prose answer: one Period line per declaring call, as declared', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('No failures.')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .limitsTravelWithTheAnswer()
      .build();
    const out = String(await agent.run({ message: 'any failures in the last hour?' }));
    expect(out).toBe(
      'No failures.\n\n---\n\n' +
        'Coverage of this answer — declared by the tools that produced it, not by the model:\n\n' +
        'Checked:\n- every job in the 02:00 export\n\n' +
        'Period:\n- backup_runs queried 2026-09-26T09:00:00Z to 2026-09-26T10:00:00Z; the store ' +
        'holds 2026-08-27T02:00:00Z to 2026-09-26T02:00:00Z (read at 2026-09-26T10:00:03Z)',
    );
  });

  it('a typed answer: the same periods as data, beside the JSON', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('{"failed":0}')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .outputSchema({ parse: (v: string) => JSON.parse(v) as unknown })
      .limitsTravelWithTheAnswer()
      .build();
    const seen = events(agent);
    await agent.run({ message: 'any failures?' });
    const limits = agent.answerCoverage()!;
    expect(limits.periods).toEqual([
      { toolName: 'backup_runs', toolCallId: 'c1', ...PERIODS.stale },
    ]);
    const turnEnd = seen.find((e) => e.type === 'agentfootprint.agent.turn_end')!;
    expect((turnEnd.payload.answerCoverage as { periods?: unknown }).periods).toEqual(
      limits.periods,
    );
  });

  it('nothing declared a period: the block is the bytes it always was', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'silent' }), answer('No failures.')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .limitsTravelWithTheAnswer()
      .build();
    const out = String(await agent.run({ message: 'any failures?' }));
    expect(out).toBe(
      'No failures.\n\n---\n\n' +
        'Coverage of this answer — declared by the tools that produced it, not by the model:\n\n' +
        'Checked:\n- every job in the 02:00 export',
    );
  });
});

describe('across turns — the checkpoint door and this turn only', () => {
  it('turn 1’s period row rides the checkpoint; turn 2 folds without it', async () => {
    const first = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await first.run({ message: 'failures?' });
    const cp = first.checkpoint()!;
    expect(cp.findingsLedger?.map((r) => r.kind)).toEqual(['period']);
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(cp)))).not.toThrow();

    const second = Agent.create({
      provider: scripted([answer('you are welcome')]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await second.run({ message: 'thanks', continueFrom: cp });
    expect(periodRows(second)).toEqual(periodRows(first)); // restored as a record
    expect(await reasonsOf(second)).not.toContain('period-not-held');
  });

  it('the door refuses a period row the layer never files — and names the kind it expects', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    await agent.run({ message: 'failures?' });
    const cp = JSON.parse(JSON.stringify(agent.checkpoint())) as { findingsLedger: object[] };
    cp.findingsLedger = [{ ...cp.findingsLedger[0], verdict: 'held' }];
    expect(() => validateCheckpoint(cp)).toThrow(
      /'period' \(with toolCallId, toolName, iteration, turn, and a verdict of covered/,
    );
  });
});

describe('the answer account reads the same rows the standing does', () => {
  it('“How sure” names the period reason with its count of calls', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'failures?' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    recorder.stop();
    const account = accountForAnswer(recording);
    const howSure = account.rows.find((r) => r.id === 'how-sure')!;
    expect(howSure.lines.map((l) => l.text)).toContain(
      '1 call asked about a period its store does not hold.',
    );
  });

  it('a covered period is a check that ran — “How sure” lists it, and nothing fires', async () => {
    const agent = Agent.create({
      provider: scripted([
        call('c1', 'backup_runs', { host: 'fresh', rows: true }),
        answer('2 failed.'),
      ]).provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'failures?' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    recorder.stop();
    const howSure = accountForAnswer(recording).rows.find((r) => r.id === 'how-sure')!;
    expect(howSure.lines.map((l) => l.text)).toContain(
      'Result periods: 1 of 1 call had a period verdict on the record.',
    );
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('security: the verdict travels as a word, never as the instants', () => {
  it('neither the row nor the event carries an instant; the served request gains nothing', async () => {
    const plain = scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('none')]);
    const armed = scripted([call('c1', 'backup_runs', { host: 'stale' }), answer('none')]);
    const unarmed = Agent.create({ provider: plain.provider as never, model: 'm' })
      .tool(backupRuns())
      .build();
    const agent = Agent.create({ provider: armed.provider as never, model: 'm' })
      .tool(backupRuns())
      .resultsLayer()
      .build();
    const seen = events(agent);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await unarmed.run({ message: 'x' });
    await agent.run({ message: 'x' });
    const event = seen.find((e) => e.type === 'agentfootprint.findings.period')!;
    expect(JSON.stringify(event.payload)).not.toMatch(/2026-/);
    expect(JSON.stringify(periodRows(agent))).not.toMatch(/2026-/);
    // Every request the armed agent sent is the request the unarmed one sent.
    expect(armed.requests.map((r) => JSON.stringify(r.messages))).toEqual(
      plain.requests.map((r) => JSON.stringify(r.messages)),
    );
  });
});

// ─── BYTE IDENTITY ───────────────────────────────────────────────────

describe('byte identity: nothing declared, nothing mounted', () => {
  it('no ToolPeriod and no .resultsLayer(): no sf-results, no run constant, no row', async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'backup_runs', { host: 'silent' }), answer('none')])
        .provider as never,
      model: 'm',
    })
      .tool(backupRuns())
      .build();
    await agent.run({ message: 'x' });
    const snapshot = agent.getSnapshot()!;
    expect(snapshot.commitLog.some((b) => b.stageId === 'sf-results')).toBe(false);
    expect(snapshot.sharedState).not.toHaveProperty('honestyLayers');
    expect(snapshot.sharedState).not.toHaveProperty('toolResultsIteration');
    expect(agent.findings()).toBeUndefined();
  });
});
