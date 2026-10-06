/**
 * inspect_subflow — the model opens a subflow mount's OWN log through the tools.
 *
 * A subflow commits to its own log; the run's log holds only the mount
 * boundary. These tests drive a REAL recorded agent run (the planted-fact
 * fixture: `sf-tools`, `sf-injection-engine`, … each mounted twice) and small
 * footprintjs charts for nesting, absence and redaction — every answer read
 * through `callTraceTool`, the way a model reads it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { decide, FlowChartExecutor, flowChart, type RuntimeSnapshot } from 'footprintjs';
import { controlDepRecorder, type ControlDepLookup } from 'footprintjs/trace';

import { callTraceTool, traceToolpack } from '../../../src/lib/trace-toolpack/traceToolpack';
import { TRACE_TOOL_NAMES } from '../../../src/lib/trace-toolpack/traceToolNames';
import type { Tool } from '../../../src/core/tools';
import { plantedScenario, runPlantedScenario } from '../context-bisect/plantedFactFixture';
import { innerRunStore } from '../../../src/lib/trace-toolpack/innerRunRecords';
import { Agent } from '../../../src/core/Agent';
import { mock } from '../../../src/adapters/llm/MockProvider';
import { FACTS, SYSTEM, scriptedRespond } from '../recorded-chat/chatDeskFixture';

let snapshot: RuntimeSnapshot;
let tools: Tool[];
let controlDeps: ControlDepLookup;

beforeAll(async () => {
  const run = await runPlantedScenario(plantedScenario(0));
  snapshot = run.snapshot;
  controlDeps = run.controlDeps;
  tools = traceToolpack({ snapshot, controlDeps });
});

/** The first `inspect_subflow({ … })` call an answer hands the model, parsed. */
function callIn(text: string): Record<string, string> {
  const match = /inspect_subflow\(\{ ([^}]*) \}\)/.exec(text);
  if (match === null) throw new Error(`no inspect_subflow call in:\n${text}`);
  return Object.fromEntries(
    [...(match[1] as string).matchAll(/(\w+): '([^']*)'/g)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
}

describe('inspect_subflow — the door is named, nothing inside is printed', () => {
  it('is mounted on every pack and reserved by name', () => {
    expect(tools.map((tool) => tool.schema.name)).toContain('inspect_subflow');
    expect(TRACE_TOOL_NAMES).toContain('inspect_subflow');
  });

  it('run_overview adds ONE line naming the door, and no inner step', async () => {
    const overview = await callTraceTool(tools, 'run_overview');
    const hints = overview.split('\n').filter((line) => line.includes('inspect_subflow'));
    expect(hints).toEqual([
      "[subflow] steps ran their own log: inspect_subflow({ mount: 'sf-injection-engine#1' }) opens one.",
    ]);
    expect(overview).not.toContain('sf-tools/compose');
  });

  it('trace_node on a mount says it can be opened, and how', async () => {
    const node = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'sf-tools#11' });
    expect(node).toContain(
      "inside: inspect_subflow({ mount: 'sf-tools#11' }) opens this subflow's own log.",
    );
  });
});

describe('inspect_subflow — the done test: who wrote X inside sf-tools, through the tools alone', () => {
  it('who_wrote points inside, and the inner answer names the writer with its reason code', async () => {
    // The outer log never holds 'toolSchemas' — sf-tools does not merge it back.
    const outer = await callTraceTool(tools, 'who_wrote', { key: 'toolSchemas' });
    expect(outer).toContain('⚠ never-written');
    const args = callIn(outer);
    expect(args).toEqual({ mount: 'sf-tools#33', key: 'toolSchemas' });

    const inner = await callTraceTool(tools, 'inspect_subflow', args);
    expect(inner).toContain('INSIDE SUBFLOW sf-tools#33 — "Tools"');
    expect(inner).toContain("'toolSchemas' was last written by sf-tools/compose#35");
    expect(inner).toContain('lookup_order');
    // The writer consumed args: the basis says so, with footprintjs's own code.
    expect(inner).toContain('⚠ incomplete-sources:');
    expect(inner).toContain('INNER ids');
  });

  it('a reason code is explained once per inner pack, then bare', async () => {
    const pack = traceToolpack({ snapshot });
    const ask = { mount: 'sf-tools#11', key: 'toolSchemas' };
    const first = await callTraceTool(pack, 'inspect_subflow', ask);
    const second = await callTraceTool(pack, 'inspect_subflow', ask);
    expect(first).toContain('⚠ incomplete-sources:');
    expect(second).toContain('⚠ incomplete-sources');
    expect(second).not.toContain('⚠ incomplete-sources:');
  });

  it("a mount's merge-back write points at the writer inside", async () => {
    const outer = await callTraceTool(tools, 'who_wrote', { key: 'toolsInjections' });
    expect(outer).toContain('is a subflow mount — this write is its merge-back');
    const inner = await callTraceTool(tools, 'inspect_subflow', callIn(outer));
    expect(inner).toMatch(/'toolsInjections' was last written by sf-tools\/compose#\d+/);
  });
});

describe('inspect_subflow — open / overview / find / variable / step / key', () => {
  it('open: a bounded overview of the inner log, the seed first, framed as inner', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-tools#11' });
    expect(out).toContain('INSIDE SUBFLOW sf-tools#11 — "Tools": its own log, 3 commit(s)');
    const stages = out.split('\n').filter((line) => line.startsWith('- sf-tools'));
    expect(stages.map((line) => line.split(' ')[1])).toEqual([
      'sf-tools',
      'sf-tools/discover',
      'sf-tools/compose',
    ]);
    expect(out).toContain("next inside 'sf-tools#11'");
    expect(out).toContain("⚠ the ids above are INNER ids — steps of subflow sf-tools#11's own log");
  });

  it('find: searches the inner log and hands back inner ids', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      find: 'lookup_order',
    });
    expect(out).toContain('FOUND');
    expect(out).toContain('sf-tools/compose#13');
  });

  it('variable: the slice anchors at the inner writer', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      variable: 'toolSchemas',
    });
    expect(out).toContain("SLICE for 'toolSchemas'");
    expect(out).toContain('(sf-tools/compose#13)');
  });

  it('step: one inner step, with its reason codes', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      runtimeStageId: 'sf-tools/compose#13',
    });
    expect(out).toContain('STEP sf-tools/compose#13');
    expect(out).toContain('toolSchemas (set)');
    expect(out).toContain('⚠ never-written'); // parkedToolNames: read, never written inside
  });

  it('step + key: one inner value in full', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      runtimeStageId: 'sf-tools/compose#13',
      key: 'toolSchemas',
    });
    expect(out).toContain("VALUE of 'toolSchemas' as of sf-tools/compose#13");
    expect(out).toContain('"name":"lookup_order"');
  });

  it('two mounts alternate cleanly through the one-slot memo', async () => {
    const a = await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-tools#11' });
    const b = await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-cache#14' });
    const again = await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-tools#11' });
    expect(b).toContain('INSIDE SUBFLOW sf-cache#14');
    expect(again).toBe(a);
  });
});

describe('inspect_subflow — two namespaces, corrected both ways', () => {
  it.each(['trace_node', 'trace_slice'])(
    '%s handed an inner id corrects toward the mount',
    async (name) => {
      const out = await callTraceTool(tools, name, { runtimeStageId: 'sf-tools/compose#13' });
      expect(out).toContain("'sf-tools/compose#13' is a step INSIDE subflow mount sf-tools#11");
      expect(callIn(out)).toEqual({ mount: 'sf-tools#11', runtimeStageId: 'sf-tools/compose#13' });
    },
  );

  it('get_value handed an inner id corrects too', async () => {
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'sf-tools/discover#12',
      key: 'toolSchemas',
    });
    expect(out).toContain('is a step INSIDE subflow mount sf-tools#11');
  });

  it('an OUTER id handed to inspect_subflow is sent back to trace_node', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      runtimeStageId: 'call-llm#18',
    });
    expect(out).toBe(
      "'call-llm#18' is a step of the run ABOVE subflow sf-tools#11, not of its own log — " +
        "trace_node('call-llm#18') opens it there.",
    );
  });

  it('a bare stage name lists its executions; a non-mount step and an unknown id are named', async () => {
    expect(await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-tools' })).toBe(
      "'sf-tools' ran 2 time(s); a mount is ONE execution: sf-tools#11, sf-tools#33. Retry with " +
        'one of those ids.',
    );
    expect(await callTraceTool(tools, 'inspect_subflow', { mount: 'call-llm#18' })).toContain(
      'is an outer step, not a subflow mount',
    );
    expect(await callTraceTool(tools, 'inspect_subflow', { mount: 'nope#1' })).toContain(
      "unknown mount 'nope#1'. Subflow mounts in the traced run: sf-injection-engine#1,",
    );
  });
});

// ── Nested subflows: one level at a time ────────────────────────────────────

async function nestedRun(): Promise<RuntimeSnapshot> {
  const deepest = flowChart<{ deep: string }>(
    'Deep',
    (scope) => {
      scope.deep = 'made-in-b';
    },
    'make-deep',
  ).build();
  const middle = flowChart<{ mid: number; deep?: string }>(
    'Mid',
    (scope) => {
      scope.mid = 2;
    },
    'make-mid',
  )
    .addSubFlowChartNext('sf-b', deepest, 'B', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ deep: out.deep }),
    })
    .build();
  const chart = flowChart<{ start: number; deep?: string }>(
    'Start',
    (scope) => {
      scope.start = 1;
    },
    'start',
  )
    .addSubFlowChartNext('sf-a', middle, 'A', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ deep: out.deep }),
    })
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot();
}

describe('inspect_subflow — nested subflows open one level at a time', () => {
  it('the outer level opens sf-a; sf-a names its own mount sf-b; sf-b opens through sf-a', async () => {
    const pack = traceToolpack({ snapshot: await nestedRun() });
    const overview = await callTraceTool(pack, 'run_overview');
    const outerMount = callIn(overview).mount as string;
    expect(outerMount).toMatch(/^sf-a#\d+$/);

    const a = await callTraceTool(pack, 'inspect_subflow', { mount: outerMount });
    expect(a).toContain(`INSIDE SUBFLOW ${outerMount}`);
    expect(a).toMatch(/- sf-a\/sf-b ×1 \[subflow\]/);
    const nested = callIn(a.slice(a.indexOf('[subflow] steps'))).mount as string;
    expect(nested).toMatch(/^sf-a\/sf-b#\d+$/);

    const b = await callTraceTool(pack, 'inspect_subflow', { mount: nested, key: 'deep' });
    expect(b).toContain(`INSIDE SUBFLOW ${nested} — "sf-a/B" (nested in ${outerMount})`);
    expect(b).toMatch(/'deep' was last written by sf-a\/sf-b\/make-deep#\d+/);
  });

  it('an id two levels down, pasted into an outer tool, names its own mount', async () => {
    const pack = traceToolpack({ snapshot: await nestedRun() });
    const a = callIn(await callTraceTool(pack, 'run_overview')).mount as string;
    const nested = callIn(
      (await callTraceTool(pack, 'inspect_subflow', { mount: a })).split('[subflow] steps')[1] ??
        '',
    ).mount as string;
    const b = await callTraceTool(pack, 'inspect_subflow', { mount: nested });
    const deepId = /sf-a\/sf-b\/make-deep#\d+/.exec(b)?.[0] as string;
    const out = await callTraceTool(pack, 'trace_node', { runtimeStageId: deepId });
    expect(out).toContain(`'${deepId}' is a step INSIDE subflow mount ${nested}`);
  });
});

// ── Honest absence ──────────────────────────────────────────────────────────

describe('inspect_subflow — honest absence', () => {
  const variant = (results: Record<string, unknown> | undefined): RuntimeSnapshot =>
    ({ ...snapshot, subflowResults: results } as RuntimeSnapshot);
  const resultsOf = (): Record<string, unknown> => ({ ...(snapshot.subflowResults ?? {}) });

  it('a snapshot without subflow results says so, and the overview says the logs are not here', async () => {
    const pack = traceToolpack({ snapshot: variant(undefined) });
    const out = await callTraceTool(pack, 'inspect_subflow', { mount: 'sf-tools#11' });
    expect(out).toContain('this snapshot carries no subflow results');
    expect(out).toContain("trace_node('sf-tools#11')");
    expect(await callTraceTool(pack, 'run_overview')).toContain(
      '[subflow] steps kept no own log here — inspect_subflow({ mount }) says why.',
    );
    expect(await callTraceTool(pack, 'trace_node', { runtimeStageId: 'sf-tools#11' })).toContain(
      'inside: no own log kept for this mount',
    );
  });

  it('a mount with no result (never returned, or lazy and never ran) says the record cannot tell which', async () => {
    const results = resultsOf();
    delete results['sf-tools#11'];
    const pack = traceToolpack({ snapshot: variant(results) });
    const out = await callTraceTool(pack, 'inspect_subflow', { mount: 'sf-tools#11' });
    expect(out).toContain("no subflow result was kept for mount 'sf-tools#11'");
    expect(out).toContain('a lazy mount that never ran');
  });

  it('a result kept without its history (a lean checkpoint) says so', async () => {
    const results = resultsOf();
    const entry = results['sf-tools#11'] as { treeContext: Record<string, unknown> };
    results['sf-tools#11'] = {
      ...entry,
      treeContext: { ...entry.treeContext, history: undefined },
    };
    const pack = traceToolpack({ snapshot: variant(results) });
    expect(await callTraceTool(pack, 'inspect_subflow', { mount: 'sf-tools#11' })).toContain(
      'carries no inner log',
    );
  });

  it('a run with no subflows says there is nothing to open', async () => {
    const executor = new FlowChartExecutor(
      flowChart<{ a: number }>('A', (scope) => void (scope.a = 1), 'a').build(),
    );
    await executor.run();
    const pack = traceToolpack({ snapshot: executor.getSnapshot() });
    expect(await callTraceTool(pack, 'inspect_subflow', { mount: 'a#0' })).toContain(
      'not a subflow mount',
    );
    expect(await callTraceTool(pack, 'inspect_subflow', { mount: 'x' })).toBe(
      'the traced run mounted no subflows — there is no inner log to open.',
    );
    expect(await callTraceTool(pack, 'run_overview')).not.toContain('inspect_subflow');
  });
});

// ── Redaction holds inside ──────────────────────────────────────────────────

const SECRET = 'sk-live-0000-SECRET';

async function redactedRun(): Promise<FlowChartExecutor> {
  const inner = flowChart<{ innerKey: string; derived: string }>(
    'Use the key inside',
    (scope) => {
      scope.innerKey = SECRET;
      scope.derived = 'ok';
    },
    'inner-use',
  ).build();
  const chart = flowChart<{ start: number; derived?: string }>(
    'Start',
    (scope) => {
      scope.start = 1;
    },
    'start',
  )
    .addSubFlowChartNext('sf', inner, 'Sub', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ derived: out.derived }),
    })
    .build();
  const executor = new FlowChartExecutor(chart);
  executor.setRedactionPolicy({ keys: ['innerKey'] });
  await executor.run();
  return executor;
}

describe('inspect_subflow — the redacted view stays redacted inside', () => {
  it.each([
    ['getSnapshot({ redact: true })', true],
    ['getSnapshot() — the log is scrubbed at commit', false],
  ])('%s: no inner answer carries the secret', async (_label, redact) => {
    const executor = await redactedRun();
    const pack = traceToolpack({ snapshot: executor.getSnapshot({ redact }) });
    const mount = callIn(await callTraceTool(pack, 'run_overview')).mount as string;
    const innerId = /sf\/inner-use#\d+/.exec(
      await callTraceTool(pack, 'inspect_subflow', { mount }),
    )?.[0] as string;
    const answers = [
      await callTraceTool(pack, 'inspect_subflow', { mount }),
      await callTraceTool(pack, 'inspect_subflow', { mount, find: 'sk-live' }),
      await callTraceTool(pack, 'inspect_subflow', { mount, variable: 'innerKey' }),
      await callTraceTool(pack, 'inspect_subflow', { mount, key: 'innerKey' }),
      await callTraceTool(pack, 'inspect_subflow', { mount, runtimeStageId: innerId }),
      await callTraceTool(pack, 'inspect_subflow', {
        mount,
        runtimeStageId: innerId,
        key: 'innerKey',
      }),
    ];
    for (const answer of answers) expect(answer).not.toContain(SECRET);
    expect(answers[3]).toContain('(redacted by policy)');
    expect(answers[5]).toContain('REDACTED');
  });
});

// ── Token cost of the door ──────────────────────────────────────────────────

describe('inspect_subflow — what the door costs', () => {
  it('the overview grows by one short line (measured on the planted run)', async () => {
    const after = await callTraceTool(tools, 'run_overview');
    const hint = after.split('\n').find((line) => line.startsWith('[subflow] steps')) as string;
    const before = after.replace(`${hint}\n`, '');
    // ≈ chars / 4 tokens. Measured 2026-10-06: 1,854 → 1,952 chars (+98, one line).
    expect(hint.length).toBeLessThanOrEqual(100);
    expect((after.length - before.length) / before.length).toBeLessThan(0.06);
  });
});

// ── Review round 1: a hint is emitted only when it is TRUE ──────────────────

async function renamedRun(): Promise<RuntimeSnapshot> {
  const inner = flowChart<{ score: number }>(
    'Score',
    (scope) => {
      scope.score = 7;
    },
    'score-it',
  ).build();
  const chart = flowChart<{ start: number; finalScore?: number }>(
    'Start',
    (scope) => {
      scope.start = 1;
    },
    'start',
  )
    .addSubFlowChartNext('sf', inner, 'Sub', {
      inputMapper: () => ({}),
      // The key is RENAMED on the way out: 'finalScore' is never written inside.
      outputMapper: (out) => ({ finalScore: out.score }),
    })
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot();
}

describe('review fixes — hints claim only what is true', () => {
  it('a merge-back under a RENAMED key names the mount and claims no writer inside', async () => {
    const pack = traceToolpack({ snapshot: await renamedRun() });
    const out = await callTraceTool(pack, 'who_wrote', { key: 'finalScore' });
    expect(out).toMatch(
      /↳ sf#\d+ is a subflow mount — inside: inspect_subflow\(\{ mount: 'sf#\d+' \}\)/,
    );
    expect(out).not.toContain('names the writer');
    expect(out).not.toContain('merge-back');
  });

  it("a computed merge-back on the agent run ('activeByslot.systemPrompt') claims no writer inside", async () => {
    const out = await callTraceTool(tools, 'who_wrote', { key: 'activeByslot.systemPrompt' });
    expect(out).not.toContain('names the writer');
  });

  it('who_wrote before an anchor never points at a mount that ran after it', async () => {
    const out = await callTraceTool(tools, 'who_wrote', {
      key: 'toolSchemas',
      beforeStageId: 'call-llm#18',
    });
    expect(callIn(out).mount).toBe('sf-tools#11');
    const early = await callTraceTool(tools, 'who_wrote', {
      key: 'toolSchemas',
      beforeStageId: 'sf-tools#11',
    });
    expect(early).not.toContain('inspect_subflow');
  });

  it('the header claims a seed only when the log opens with the mount', async () => {
    expect(await callTraceTool(tools, 'inspect_subflow', { mount: 'sf-tools#11' })).toContain(
      "the mount's seed first",
    );
    const results = { ...(snapshot.subflowResults ?? {}) } as Record<string, any>;
    const entry = results['sf-tools#11'];
    results['sf-tools#11'] = {
      ...entry,
      treeContext: { ...entry.treeContext, history: entry.treeContext.history.slice(1) },
    };
    const pack = traceToolpack({
      snapshot: { ...snapshot, subflowResults: results } as RuntimeSnapshot,
    });
    const out = await callTraceTool(pack, 'inspect_subflow', { mount: 'sf-tools#11' });
    expect(out).toContain('2 commit(s).');
    expect(out).not.toContain('seed');
  });

  it('an outer decider is not served as an inner control parent', async () => {
    const out = await callTraceTool(tools, 'inspect_subflow', {
      mount: 'sf-tools#11',
      runtimeStageId: 'sf-tools/compose#13',
    });
    expect(out).not.toContain('context#6');
  });

  it("inspect_tool_run's inner pack names no door it cannot route to", async () => {
    const store = innerRunStore();
    const inner = await nestedRun();
    store.keep({
      toolCallId: 'c1',
      toolName: 'nested',
      outcome: 'ok',
      steps: 3,
      recording: { snapshot: inner },
    });
    const pack = traceToolpack({ snapshot, innerRuns: store });
    const overview = await callTraceTool(pack, 'inspect_tool_run', { toolCallId: 'c1' });
    expect(overview).toContain('[subflow]');
    const mount = /sf-a#\d+/.exec(overview)?.[0] as string;
    const answers = [
      overview,
      await callTraceTool(pack, 'inspect_tool_run', { toolCallId: 'c1', runtimeStageId: mount }),
      await callTraceTool(pack, 'inspect_tool_run', { toolCallId: 'c1', key: 'deep' }),
    ];
    for (const answer of answers) expect(answer).not.toContain('inspect_subflow');
  });
});

// ── Property: every hint, followed, does not contradict itself ─────────────

/** Follow every inspect_subflow hint the outer tools emit; return the contradictions. */
async function contradictions(pack: Tool[], snap: RuntimeSnapshot): Promise<string[]> {
  const log = snap.commitLog;
  const keys = [...new Set(log.flatMap((bundle) => bundle.trace.map((row) => row.path)))];
  const ids = [...new Set(log.map((bundle) => bundle.runtimeStageId))];
  const outerKeys = new Set(keys);
  const bad: string[] = [];
  const follow = async (source: string, out: string): Promise<void> => {
    const match = /inspect_subflow\(\{ ([^}]*) \}\)/.exec(out);
    if (match === null) return;
    const args = callIn(out);
    const answer = await callTraceTool(pack, 'inspect_subflow', args);
    const line = out.split('\n').find((l) => l.includes('inspect_subflow')) ?? '';
    if (line.includes('names the writer') && !answer.includes('was last written by')) {
      bad.push(`${source}: promised a writer, got ${answer.split('\n')[1]}`);
    }
    if (line.includes('opens') && !answer.startsWith(`INSIDE SUBFLOW ${args.mount}`)) {
      bad.push(`${source}: promised the log opens, got ${answer.split('\n')[0]}`);
    }
    if (line.includes('not merged back') && outerKeys.has(args.key ?? '')) {
      bad.push(`${source}: 'not merged back' for a key the outer log wrote`);
    }
  };
  for (const key of keys) {
    for (const before of [undefined, ...ids]) {
      const args = before === undefined ? { key } : { key, beforeStageId: before };
      const out = await callTraceTool(pack, 'who_wrote', args);
      await follow(`who_wrote(${key}, ${before ?? '-'})`, out);
      const mount = callInOrUndefined(out)?.mount;
      if (before !== undefined && mount !== undefined && out.includes('but subflow')) {
        const order = ids.indexOf(mount);
        if (order >= ids.indexOf(before))
          bad.push(`who_wrote(${key}, ${before}): ${mount} ran after`);
      }
    }
  }
  for (const id of ids)
    await follow(
      `trace_node(${id})`,
      await callTraceTool(pack, 'trace_node', { runtimeStageId: id }),
    );
  await follow('run_overview', await callTraceTool(pack, 'run_overview'));
  return bad;
}

function callInOrUndefined(text: string): Record<string, string> | undefined {
  try {
    return callIn(text);
  } catch {
    return undefined;
  }
}

describe('property — every hint the outer tools emit, followed, holds', () => {
  it('on the planted-fact agent run', async () => {
    expect(await contradictions(tools, snapshot)).toEqual([]);
  }, 60_000);

  it('on the chat-desk agent run', async () => {
    const provider = mock({ respond: (req) => scriptedRespond(req) });
    let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(SYSTEM);
    for (const fact of FACTS) builder = builder.fact(fact);
    const agent = builder.build();
    await agent.run({ message: 'User: should I buy ACME?' });
    const desk = agent.getLastSnapshot() as RuntimeSnapshot;
    expect(await contradictions(traceToolpack({ snapshot: desk }), desk)).toEqual([]);
  }, 60_000);
});

// ── Review round 2: control edges at every depth ────────────────────────────

/** A subflow whose own decider routes: score → gate{hi | lo}. */
function gateChart(score: number) {
  return flowChart<{ score: number; verdict?: string }>(
    'Score',
    (scope) => {
      scope.score = score;
    },
    'score',
  )
    .addDeciderFunction(
      'Gate',
      (scope) =>
        decide(scope, [{ when: { score: { gte: 60 } }, then: 'hi', label: 'score ≥ 60' }], {
          branch: 'lo',
          label: 'below 60',
        }),
      'gate',
    )
    .addFunctionBranch('hi', 'High', (scope) => {
      scope.verdict = 'high';
    })
    .addFunctionBranch('lo', 'Low', (scope) => {
      scope.verdict = 'low';
    })
    .end()
    .build();
}

/**
 * start → route{ sf-a | skip } → sf-c{gate}, where sf-a = make-mid → sf-b{gate}.
 * An OUTER decider routes into sf-a (its edge must not show inside), a gate
 * routes at depth 1 (sf-c) and at depth 2 (sf-a/sf-b).
 */
async function gatedRun(): Promise<{ snap: RuntimeSnapshot; lookup: ControlDepLookup }> {
  const mid = flowChart<{ mid: number; verdict?: string }>(
    'Mid',
    (scope) => {
      scope.mid = 1;
    },
    'make-mid',
  )
    .addSubFlowChartNext('sf-b', gateChart(70), 'B', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ verdict: out.verdict }),
    })
    .build();
  const chart = flowChart<{ n: number; verdict?: string; v2?: string; skipped?: number }>(
    'Start',
    (scope) => {
      scope.n = 1;
    },
    'start',
  )
    .addDeciderFunction(
      'Route',
      (scope) => decide(scope, [{ when: { n: { gte: 1 } }, then: 'sf-a', label: 'n ≥ 1' }], 'skip'),
      'route',
    )
    .addSubFlowChartBranch('sf-a', mid, 'A', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ verdict: out.verdict }),
    })
    .addFunctionBranch('skip', 'Skip', (scope) => {
      scope.skipped = 1;
    })
    .end()
    .addSubFlowChartNext('sf-c', gateChart(10), 'C', {
      inputMapper: () => ({}),
      outputMapper: (out) => ({ v2: out.verdict }),
    })
    .build();
  const executor = new FlowChartExecutor(chart);
  const recorder = controlDepRecorder();
  executor.attachCombinedRecorder(recorder);
  await executor.run();
  return { snap: executor.getSnapshot(), lookup: recorder.asLookup() };
}

/**
 * Every inner step of every mount, opened through the OUTER tool: its control
 * parents must be exactly the run's edge when that edge's decider is in the
 * mount's own log, and none otherwise. Returns the mismatches and how many
 * real edges were checked per depth (so a green run is not a vacuous one).
 */
async function controlEdgeMismatches(
  pack: Tool[],
  snap: RuntimeSnapshot,
  lookup: ControlDepLookup,
): Promise<{ bad: string[]; edgesAtDepth: Record<number, number> }> {
  const results = (snap.subflowResults ?? {}) as Record<
    string,
    { treeContext?: { history?: { runtimeStageId: string }[] } }
  >;
  const bad: string[] = [];
  const edgesAtDepth: Record<number, number> = {};
  for (const [mount, entry] of Object.entries(results)) {
    if (!mount.includes('#')) continue;
    const history = entry.treeContext?.history ?? [];
    const own = new Set(history.map((bundle) => bundle.runtimeStageId));
    const depth = mount.split('/').length;
    for (const id of own) {
      const dep = lookup(id);
      const expected = dep !== undefined && own.has(dep.deciderId) ? [dep.deciderId] : [];
      const answer = await callTraceTool(pack, 'inspect_subflow', { mount, runtimeStageId: id });
      const shown = [...answer.matchAll(/routed here by (\S+)/g)].map((m) => m[1]);
      if (JSON.stringify(shown) !== JSON.stringify(expected)) {
        bad.push(
          `${mount} ${id}: shown ${JSON.stringify(shown)}, own log says ${JSON.stringify(
            expected,
          )}`,
        );
      }
      if (expected.length > 0) edgesAtDepth[depth] = (edgesAtDepth[depth] ?? 0) + 1;
    }
  }
  return { bad, edgesAtDepth };
}

describe('review round 2 — control edges hold at every depth', () => {
  it('a gate two levels down still routes its branch, in the step and in the slice', async () => {
    const { snap, lookup } = await gatedRun();
    const pack = traceToolpack({ snapshot: snap, controlDeps: lookup });
    const nested = Object.keys(snap.subflowResults ?? {}).find((key) =>
      /^sf-a\/sf-b#\d+$/.test(key),
    ) as string;
    const history = (
      snap.subflowResults?.[nested] as { treeContext: { history: { runtimeStageId: string }[] } }
    ).treeContext.history;
    const hi = history
      .map((bundle) => bundle.runtimeStageId)
      .find((id) => id.startsWith('sf-a/sf-b/hi#')) as string;
    const gate = history
      .map((bundle) => bundle.runtimeStageId)
      .find((id) => id.startsWith('sf-a/sf-b/gate#')) as string;

    const step = await callTraceTool(pack, 'inspect_subflow', {
      mount: nested,
      runtimeStageId: hi,
    });
    expect(step).toContain(`- control: routed here by ${gate} — rule "score ≥ 60"`);
    const slice = await callTraceTool(pack, 'inspect_subflow', {
      mount: nested,
      variable: 'verdict',
    });
    expect(slice).toContain(gate);
  });

  it("property: inner control parents equal the subflow's own decisions, at depth 1 and depth 2", async () => {
    const { snap, lookup } = await gatedRun();
    const pack = traceToolpack({ snapshot: snap, controlDeps: lookup });
    const { bad, edgesAtDepth } = await controlEdgeMismatches(pack, snap, lookup);
    expect(bad).toEqual([]);
    expect(edgesAtDepth[1]).toBeGreaterThan(0);
    expect(edgesAtDepth[2]).toBeGreaterThan(0);
    // The outer decider routed INTO sf-a: a real edge, never shown as an inner one.
    const sfA = Object.keys(snap.subflowResults ?? {}).find((key) =>
      /^sf-a#\d+$/.test(key),
    ) as string;
    expect(lookup(sfA)?.deciderId).toMatch(/^route#\d+$/);
    // And every door hint on this run, followed, holds too.
    expect(await contradictions(pack, snap)).toEqual([]);
  }, 60_000);

  it('property: the same holds on the planted-fact agent run', async () => {
    const { bad, edgesAtDepth } = await controlEdgeMismatches(tools, snapshot, controlDeps);
    expect(bad).toEqual([]);
    expect(edgesAtDepth[1]).toBeGreaterThan(0);
  }, 60_000);
});
