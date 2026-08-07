/**
 * "The record goes through the tool boundary" — `keepRecord` +
 * `inspect_tool_run` (8.17.0).
 *
 * Convention-3 tiers:
 *   unit         the LRU store (cap, recency, drop count, merge, detection)
 *                and `flowchartAsTool`'s two refusals
 *   functional   the descent rung on `inspect_tool_call`; the five inner
 *                views; the two id namespaces stated on every answer
 *   integration  a real two-turn Agent: the chart tool's record is
 *                collected at `.build()` and opened by the model in turn 2
 *   security     redaction is enforced at INNER commit time, so a kept
 *                record cannot serve what the policy removed
 *   property     the store never exceeds its cap, and kept + dropped is
 *                conserved
 *   performance  off by default is the byte-identical path (no store, no
 *                extra recorder); the inner index is built once per call id
 *   ROI          the honest-absence arms NAME the switch instead of
 *                answering emptily
 */

import { describe, expect, it } from 'vitest';
import { decide, flowChart } from 'footprintjs';

import { Agent, flowchartAsTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { unconfiguredCredentialProvider } from '../../../src/identity.js';
import {
  callTraceTool,
  innerRunStore,
  innerRunsOf,
  mergeInnerRuns,
  traceToolpack,
  type InnerRunLookup,
  type InnerRunRecord,
  type TraceToolpackArtifacts,
} from '../../../src/observe.js';

/* ── fixtures ─────────────────────────────────────────────────────────── */

interface AdviceState {
  forecast: { precipitationChancePct: number; apiKey?: string };
  rainChancePct: number;
  usable: boolean;
  advice: string;
}

/** fetch → validate → decide → advise. The shape example 50 demonstrates. */
function buildAdviceChart(rainChance = 82, apiKey?: string) {
  return flowChart<AdviceState>(
    'Fetch the forecast',
    (scope) => {
      scope.forecast = {
        precipitationChancePct: rainChance,
        ...(apiKey !== undefined && { apiKey }),
      };
    },
    'fetch-forecast',
  )
    .addFunction(
      'Validate the forecast',
      (scope) => {
        scope.usable = true;
        scope.rainChancePct = scope.forecast.precipitationChancePct;
      },
      'validate-forecast',
      'Check the fields and hoist the decisive one.',
    )
    .addDeciderFunction(
      'Weigh the rain',
      (scope) =>
        decide(
          scope as unknown as AdviceState,
          [
            {
              when: { rainChancePct: { gte: 60 } },
              then: 'rain',
              label: 'Rain chance at or above the 60% bike threshold',
            },
          ],
          'clear',
        ),
      'weigh-the-rain',
    )
    .addFunctionBranch('rain', 'Advise transit', (scope) => {
      scope.advice = `do not bike (${scope.rainChancePct}%)`;
    })
    .addFunctionBranch('clear', 'Advise biking', (scope) => {
      scope.advice = `bike (${scope.rainChancePct}%)`;
    })
    .end()
    .build();
}

const ctxFor = (toolCallId: string) => ({
  toolCallId,
  iteration: 1,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
});

/** An artifact bag with nothing but the inner runs — the descent under test. */
const bagWith = (innerRuns?: InnerRunLookup): TraceToolpackArtifacts => ({
  snapshot: {
    commitLog: [],
    executionTree: undefined,
    sharedState: {},
    commitValues: 'full',
  } as never,
  ...(innerRuns !== undefined && { innerRuns }),
});

const recordFor = (toolCallId: string): InnerRunRecord => ({
  toolCallId,
  toolName: 'weather_advice',
  outcome: 'ok',
  steps: 4,
});

/* ── 1. UNIT — the bounded LRU store ──────────────────────────────────── */

describe('innerRunStore — bounded, LRU, and honest about what it dropped', () => {
  it('retrieves by toolCallId — the id the outer run already uses', () => {
    const store = innerRunStore(5);
    store.keep(recordFor('c1'));
    store.keep(recordFor('c2'));
    expect(store.get('c1')?.toolCallId).toBe('c1');
    expect(store.get('c2')?.steps).toBe(4);
    expect(store.get('c3')).toBeUndefined();
  });

  it('drops the least-recently-used record at the cap, and COUNTS the drops', () => {
    const store = innerRunStore(2);
    store.keep(recordFor('c1'));
    store.keep(recordFor('c2'));
    store.keep(recordFor('c3')); // evicts c1
    expect(store.get('c1')).toBeUndefined();
    expect(store.get('c2')).toBeDefined();
    expect(store.get('c3')).toBeDefined();
    // "we kept the last 2 of 3" is an answer a session can act on.
    expect(store.dropped).toBe(1);
    expect(store.limit).toBe(2);
    expect(store.list()).toHaveLength(2);
  });

  it('READING refreshes recency — a record under investigation is not the next evicted', () => {
    const store = innerRunStore(2);
    store.keep(recordFor('c1'));
    store.keep(recordFor('c2'));
    store.get('c1'); // c1 is now the most recently used
    store.keep(recordFor('c3')); // …so c2 goes, not c1
    expect(store.get('c1')).toBeDefined();
    expect(store.get('c2')).toBeUndefined();
  });

  it('re-keeping one id replaces rather than accumulates', () => {
    const store = innerRunStore(3);
    store.keep({ ...recordFor('c1'), steps: 4 });
    store.keep({ ...recordFor('c1'), steps: 9 });
    expect(store.list()).toHaveLength(1);
    expect(store.get('c1')?.steps).toBe(9);
    expect(store.dropped).toBe(0);
  });

  it('clamps a nonsense cap to 1 — a store that keeps nothing is keepRecord:false', () => {
    expect(innerRunStore(0).limit).toBe(1);
    expect(innerRunStore(-7).limit).toBe(1);
  });

  it('mergeInnerRuns searches every store and reports the strictest cap', () => {
    const a = innerRunStore(4);
    const b = innerRunStore(2);
    a.keep(recordFor('c1'));
    b.keep({ ...recordFor('c2'), toolName: 'other_chart' });
    b.keep(recordFor('c3'));
    b.keep(recordFor('c4')); // evicts c2 from b
    const merged = mergeInnerRuns([a, b])!;
    expect(merged.get('c1')?.toolName).toBe('weather_advice');
    expect(merged.get('c4')).toBeDefined();
    expect(merged.get('c2')).toBeUndefined();
    expect(merged.dropped).toBe(1);
    expect(merged.limit).toBe(2);
    expect(merged.list()).toHaveLength(3);
    // No stores at all is `undefined`, not an empty lookup that would
    // answer "nothing was kept" when the truth is "nothing keeps anything".
    expect(mergeInnerRuns([])).toBeUndefined();
    expect(mergeInnerRuns([a])).toBe(a);
  });

  it('innerRunsOf is total — a plain tool, a string, null all answer "no records"', () => {
    expect(innerRunsOf(undefined)).toBeUndefined();
    expect(innerRunsOf(null)).toBeUndefined();
    expect(innerRunsOf('c1')).toBeUndefined();
    expect(innerRunsOf({ schema: { name: 'x' } })).toBeUndefined();
  });
});

/* ── 2. UNIT — flowchartAsTool: the switch, and its two refusals ──────── */

describe('flowchartAsTool({ keepRecord }) — off by default, refusals that teach', () => {
  it('keeps NOTHING by default — no store rides the tool (the zero-cost path)', async () => {
    const tool = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
    });
    await tool.execute({}, ctxFor('c1'));
    expect(innerRunsOf(tool)).toBeUndefined();
  });

  it('keepRecord:true files the record under the EXECUTING toolCallId', async () => {
    const tool = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
      keepRecord: true,
    });
    await tool.execute({}, ctxFor('call_7'));
    const records = innerRunsOf(tool)!;
    const record = records.get('call_7')!;
    expect(record.toolName).toBe('weather_advice');
    expect(record.outcome).toBe('ok');
    expect(record.steps).toBeGreaterThan(0);
    // Live in process, so it CAN carry what a serialized recording cannot.
    expect(record.controlDeps).toBeDefined();
  });

  it('keeps a record for a run that THREW — "why did it fail?" comes next', async () => {
    const tool = flowchartAsTool({
      name: 'boom',
      description: 'fails',
      flowchart: flowChart<{ x: number }>(
        'Explode',
        () => {
          throw new Error('inner stage failed');
        },
        'explode',
      ).build(),
      keepRecord: true,
    });
    await expect(tool.execute({}, ctxFor('c1'))).rejects.toThrow(/inner stage failed/);
    expect(innerRunsOf(tool)!.get('c1')?.outcome).toBe('error');
  });

  it('refuses keepRecordLimit without keepRecord — a cap on records nobody keeps', () => {
    expect(() =>
      flowchartAsTool({
        name: 'weather_advice',
        description: 'advice',
        flowchart: buildAdviceChart(),
        keepRecordLimit: 5,
      }),
    ).toThrow(/caps records that are never kept/);
  });

  it('refuses a limit of 0 — that is keepRecord:false said with a number that lies', () => {
    expect(() =>
      flowchartAsTool({
        name: 'weather_advice',
        description: 'advice',
        flowchart: buildAdviceChart(),
        keepRecord: true,
        keepRecordLimit: 0,
      }),
    ).toThrow(/at least 1/);
  });

  it("honors keepRecordLimit — the LRU window is the consumer's to size", async () => {
    const tool = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
      keepRecord: true,
      keepRecordLimit: 2,
    });
    for (const id of ['c1', 'c2', 'c3']) await tool.execute({}, ctxFor(id));
    const records = innerRunsOf(tool)!;
    expect(records.get('c1')).toBeUndefined();
    expect(records.list()).toHaveLength(2);
    expect(records.dropped).toBe(1);
  });
});

/* ── 3. FUNCTIONAL — the rung, and the five inner views ───────────────── */

/** Run the chart tool once and hand back a toolpack over its record. */
async function packOverOneCall(options?: Parameters<typeof flowchartAsTool>[0]) {
  const tool = flowchartAsTool(
    options ?? {
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
      keepRecord: true,
    },
  );
  await tool.execute({}, ctxFor('c1'));
  return traceToolpack(bagWith(innerRunsOf(tool)!));
}

describe('inspect_tool_run — the descent', () => {
  it('opens the inner run with a bounded overview, and names BOTH id spaces', async () => {
    const tools = await packOverOneCall();
    const out = await callTraceTool(tools, 'inspect_tool_run', { toolCallId: 'c1' });
    expect(out).toContain("INSIDE TOOL CALL c1 — 'weather_advice' ran a recorded flowchart");
    expect(out).toContain('TRACE RUN OVERVIEW');
    expect(out).toContain('validate-forecast');
    expect(out).toContain('⚠ the ids above are INNER ids');
    expect(out).toContain('trace_node / get_value / trace_slice do not accept them');
  });

  it("'variable' asks the inner run WHY — with the decision rule on the edge", async () => {
    const tools = await packOverOneCall();
    const out = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      variable: 'advice',
    });
    expect(out).toContain("SLICE for 'advice'");
    expect(out).toContain('validate-forecast#1');
    // The live control lookup is what a JSON recording can never carry back.
    expect(out).toContain('[control: Rain chance at or above the 60% bike threshold]');
  });

  it("'runtimeStageId' opens one inner step; adding 'key' fetches the field in full", async () => {
    const tools = await packOverOneCall();
    const node = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      runtimeStageId: 'validate-forecast#1',
    });
    expect(node).toContain('STEP validate-forecast#1');
    expect(node).toContain('rainChancePct');

    const value = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      runtimeStageId: 'validate-forecast#1',
      key: 'rainChancePct',
    });
    expect(value).toContain("VALUE of 'rainChancePct' as of validate-forecast#1");
    expect(value).toContain('82');
  });

  it("'find' searches the inner run in free text and returns INNER ids", async () => {
    const tools = await packOverOneCall();
    const out = await callTraceTool(tools, 'inspect_tool_run', { toolCallId: 'c1', find: 'rain' });
    expect(out).toContain('FOUND');
    expect(out).toContain('weigh-the-rain');
  });

  it("'key' without a step says what a value AS OF nothing would mean", async () => {
    const tools = await packOverOneCall();
    const out = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      key: 'rainChancePct',
    });
    expect(out).toContain('needs a step');
    expect(out).toContain("use 'variable'");
  });

  it("an unknown inner step id gets the inner pack's own correction, not a crash", async () => {
    const tools = await packOverOneCall();
    const out = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      runtimeStageId: 'not-a-stage#9',
    });
    // The inner pack's schema carries the real inner ids as an enum on a run
    // this small, so the correction names every one of them — free #9
    // validation, inherited by reusing the factory rather than reimplementing it.
    expect(out).toContain("Invalid arguments for tool 'trace_node'");
    expect(out).toContain('validate-forecast#1');
    expect(out).toContain('INSIDE TOOL CALL c1');
  });
});

describe('inspect_tool_call — the rung appears only when a record exists', () => {
  /** The outer run: one committed step whose history carries the call. */
  const outerBag = (innerRuns?: InnerRunLookup): TraceToolpackArtifacts => ({
    snapshot: {
      commitValues: 'full',
      sharedState: { history: [] },
      executionTree: {
        runtimeStageId: 'tool-calls#1',
        name: 'Tool calls',
        stageReads: {},
        children: [],
      },
      commitLog: [
        {
          runtimeStageId: 'tool-calls#1',
          stage: 'Tool calls',
          idx: 0,
          trace: [{ path: 'history', verb: 'set' }],
          overwrite: {
            history: [
              { role: 'assistant', toolCalls: [{ id: 'c1', name: 'weather_advice', args: {} }] },
              { role: 'tool', toolCallId: 'c1', toolName: 'weather_advice', content: 'ok' },
            ],
          },
          updates: {},
          redactedPaths: [],
          untrackedSources: [],
        },
      ],
    } as never,
    ...(innerRuns !== undefined && { innerRuns }),
  });

  it('without a record: the boundary marker stands, byte for byte', async () => {
    const out = await callTraceTool(traceToolpack(outerBag()), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('⚠ boundary: what happened INSIDE the tool is not traced');
    expect(out).not.toContain('inside:');
  });

  it('with a record: the wall becomes the call that opens it', async () => {
    const store = innerRunStore();
    store.keep(recordFor('c1'));
    const out = await callTraceTool(traceToolpack(outerBag(store)), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('inside: this tool kept its own record of the run — 4 step(s), ok.');
    expect(out).toContain("Descend with inspect_tool_run({ toolCallId: 'c1' })");
    expect(out).not.toContain('⚠ boundary: what happened INSIDE the tool is not traced');
  });
});

/* ── 4. ROI / HONEST ABSENCE — every "no" names the switch ────────────── */

describe('inspect_tool_run — honest absence', () => {
  it('no tool keeps records: names keepRecord and points back to the envelope', async () => {
    const out = await callTraceTool(traceToolpack(bagWith()), 'inspect_tool_run', {
      toolCallId: 'c1',
    });
    expect(out).toContain('nothing in this run kept a record below the tool boundary');
    expect(out).toContain('keepRecord: true');
    expect(out).toContain('OFF by default');
    expect(out).toContain("inspect_tool_call('c1')");
  });

  it('records exist but not this id: lists the ones that CAN be opened', async () => {
    const store = innerRunStore();
    store.keep(recordFor('c1'));
    const out = await callTraceTool(traceToolpack(bagWith(store)), 'inspect_tool_run', {
      toolCallId: 'c9',
    });
    expect(out).toContain("no retained inner run for tool call 'c9'");
    expect(out).toContain('Inner runs you CAN open (1): c1 (weather_advice, 4 step(s), ok)');
  });

  it('an evicted record says so, and names the cap that evicted it', async () => {
    const tool = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
      keepRecord: true,
      keepRecordLimit: 1,
    });
    await tool.execute({}, ctxFor('c1'));
    await tool.execute({}, ctxFor('c2'));
    const out = await callTraceTool(
      traceToolpack(bagWith(innerRunsOf(tool)!)),
      'inspect_tool_run',
      { toolCallId: 'c1' },
    );
    expect(out).toContain('⚠ 1 older record(s) were dropped to stay under the retention cap of 1');
    expect(out).toContain('Raise it with keepRecordLimit');
  });

  it('a capture that failed is FILED with its reason, not silently missing', async () => {
    const store = innerRunStore();
    store.keep({ ...recordFor('c1'), steps: 0, problem: 'snapshot unavailable' });
    const out = await callTraceTool(traceToolpack(bagWith(store)), 'inspect_tool_run', {
      toolCallId: 'c1',
    });
    expect(out).toContain('could not be captured: snapshot unavailable');
    expect(out).toContain("inspect_tool_call('c1') still has the envelope");
  });
});

/* ── 5. SECURITY — redaction is enforced INSIDE, at commit time ───────── */

describe('inner records respect redaction — the same contract as the outer run', () => {
  it('a redacted inner key is a placeholder in the record, and is flagged as such', async () => {
    const tool = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: flowChart<{ apiKey: string; rainChancePct: number }>(
        'Fetch the forecast',
        (scope) => {
          scope.apiKey = 'sk-live-SUPER-SECRET';
          scope.rainChancePct = 82;
        },
        'fetch-forecast',
      ).build(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    await tool.execute({}, ctxFor('c1'));
    const tools = traceToolpack(bagWith(innerRunsOf(tool)!));

    const value = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      runtimeStageId: 'fetch-forecast#0',
      key: 'apiKey',
    });
    expect(value).not.toContain('SUPER-SECRET');
    // footprintjs's own placeholder, passed through verbatim — the toolpack
    // never reconstructs around a redaction, inside a tool or outside one.
    expect(value).toContain('REDACTED');
    expect(value).toContain('(redacted by policy)');

    // …and a free-text search cannot route around it: the commit log is the
    // only copy that exists, and the secret never entered it.
    const found = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      find: 'SUPER-SECRET',
    });
    expect(found).not.toContain('sk-live-SUPER-SECRET');
    expect(found).toContain('no match');

    // The unredacted key is untouched — redaction is a policy, not a blanket.
    const open = await callTraceTool(tools, 'inspect_tool_run', {
      toolCallId: 'c1',
      runtimeStageId: 'fetch-forecast#0',
      key: 'rainChancePct',
    });
    expect(open).toContain('82');
  });
});

/* ── 6. PROPERTY — the cap holds, and nothing is lost unaccounted ─────── */

describe('innerRunStore — invariants over many keeps', () => {
  it('never exceeds its cap, and kept + dropped conserves every record', () => {
    for (const cap of [1, 3, 7, 20]) {
      const store = innerRunStore(cap);
      const total = 50;
      for (let i = 0; i < total; i++) store.keep(recordFor(`c${i}`));
      expect(store.list().length).toBeLessThanOrEqual(cap);
      expect(store.list().length + store.dropped).toBe(total);
      // The survivors are always the most recent ones.
      expect(store.get(`c${total - 1}`)).toBeDefined();
    }
  });
});

/* ── 7. INTEGRATION — a real agent descends in turn 2 ─────────────────── */

describe('a two-turn agent goes through its own tool boundary', () => {
  it('collects the store at build() and opens the inner run without re-executing', async () => {
    const stageRuns = { fetch: 0 };
    const chart = flowChart<AdviceState>(
      'Fetch the forecast',
      (scope) => {
        stageRuns.fetch += 1;
        scope.forecast = { precipitationChancePct: 82 };
      },
      'fetch-forecast',
    )
      .addFunction(
        'Validate the forecast',
        (scope) => {
          scope.rainChancePct = scope.forecast.precipitationChancePct;
          scope.advice = 'do not bike';
        },
        'validate-forecast',
      )
      .build();

    const results: { name: string; text: string }[] = [];
    const nameOf = new Map<string, string>();
    const provider = mock({
      chunkDelayMs: 0,
      respond: (req: {
        messages: { role: string; content?: unknown }[];
        tools?: { name: string }[];
      }) => {
        const names = (req.tools ?? []).map((t) => t.name);
        const asked = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
        const back = String(
          [...req.messages].reverse().find((m) => m.role === 'tool')?.content ?? '',
        );
        if (/^why/i.test(asked)) {
          if (names.includes('inspect_tool_run')) {
            if (back.startsWith('TOOL CALL')) {
              return {
                toolCalls: [{ id: 'w2', name: 'inspect_tool_run', args: { toolCallId: 'c1' } }],
              };
            }
            if (back.startsWith('INSIDE TOOL CALL')) return `ANSWER: ${back.slice(0, 300)}`;
            return {
              toolCalls: [{ id: 'w1', name: 'inspect_tool_call', args: { toolCallId: 'c1' } }],
            };
          }
          return { toolCalls: [{ id: 'sk', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        if (!back) return { toolCalls: [{ id: 'c1', name: 'weather_advice', args: {} }] };
        return 'Do not bike tomorrow.';
      },
    });

    const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 8 })
      .system('You are a commuting assistant.')
      .tool(
        flowchartAsTool({
          name: 'weather_advice',
          description: 'Decide whether to bike tomorrow.',
          flowchart: chart,
          keepRecord: true,
        }),
      )
      .selfExplain()
      .build();

    agent.on('agentfootprint.stream.tool_start', (e) =>
      nameOf.set(e.payload.toolCallId, e.payload.toolName),
    );
    agent.on('agentfootprint.stream.tool_end', (e) =>
      results.push({
        name: nameOf.get(e.payload.toolCallId) ?? '?',
        text: String(e.payload.result),
      }),
    );

    await agent.run({ message: 'Should I bike tomorrow?' });
    expect(stageRuns.fetch).toBe(1);

    const answer = await agent.run({ message: 'Why did you say it would rain?' });
    // The rung appeared on the envelope…
    const envelope = results.find((r) => r.name === 'inspect_tool_call')!;
    expect(envelope.text).toContain("Descend with inspect_tool_run({ toolCallId: 'c1' })");
    // …and the descent served the inner run's own steps.
    const inside = results.find((r) => r.name === 'inspect_tool_run')!;
    expect(inside.text).toContain('INSIDE TOOL CALL c1');
    expect(inside.text).toContain('validate-forecast');
    expect(String(answer)).toContain('ANSWER:');
    // Nothing re-executed: the explanation read the record.
    expect(stageRuns.fetch).toBe(1);
  });
});

/* ── 8. PERFORMANCE — the memo, and what OFF costs ────────────────────── */

describe('cost', () => {
  it('builds the inner index ONCE per call id, not once per drill', async () => {
    const tools = await packOverOneCall();
    const first = await callTraceTool(tools, 'inspect_tool_run', { toolCallId: 'c1' });
    const second = await callTraceTool(tools, 'inspect_tool_run', { toolCallId: 'c1' });
    // Same pack, same record → identical bytes (a rebuilt index would still
    // match, so this pins the CONTRACT the memo has to keep, not the memo).
    expect(second).toBe(first);
  });

  it('off means no store at all — not an empty one that answers "nothing kept"', async () => {
    const off = flowchartAsTool({
      name: 'weather_advice',
      description: 'advice',
      flowchart: buildAdviceChart(),
    });
    await off.execute({}, ctxFor('c1'));
    // No lookup on the tool → the artifacts carry none → the tool that
    // reads them names the switch rather than listing an empty store.
    expect(innerRunsOf(off)).toBeUndefined();
    const out = await callTraceTool(traceToolpack(bagWith()), 'inspect_tool_run', {
      toolCallId: 'c1',
    });
    expect(out).toContain('keepRecord: true');
  });
});
