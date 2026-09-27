/**
 * `.limitsTravelWithTheAnswer()` on a TYPED answer — the limits travel as
 * data, beside the answer, never appended to it.
 *
 * THE BUG this pins: the option appends a prose block to the final answer,
 * and an answer with `.outputSchema()` is JSON. JSON followed by prose is not
 * JSON, so `agent.runTyped()` threw `OutputSchemaError` (`json-parse`) on
 * every answer whose tools declared a limit — `coverage()`, `absent()`, a
 * `describedResult()` coverage, a raised absence alike.
 *
 * THE FIX: with an output schema the answer string stays exactly the model's
 * (peeled) JSON, and the SAME fold the block would have printed is delivered
 * as data — committed on the run's state (`answerCoverage`, beside the raw
 * `coverageDeclared` rows), returned by `agent.answerCoverage()`, and
 * projected onto `turn_end.answerCoverage`. A prose answer is untouched, byte
 * for byte.
 *
 * Sections: Unit (the fold) · Integration (runTyped under a strict parser,
 * every door and every chart shape; the three readers agree; the data IS the
 * block's content) · Streaming · Edge (nothing declared, detachment, the
 * narrow commit delta) · Regression (the prose answer's exact bytes).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  Agent,
  absent,
  coverage,
  COVERAGE_BLOCK_HEADING,
  defineTool,
  describedResult,
  isInputPause,
  requestInput,
  type Coverage,
  type DeclaredCoverage,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { coverageOfAnswer } from '../../../src/core/agent/coverage/index.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A STRICT schema: an extra key, or anything appended, fails it. */
const Verdict = z.object({ healthy: z.boolean(), summary: z.string() }).strict();
type Verdict = z.infer<typeof Verdict>;
const VERDICT: Verdict = { healthy: true, summary: 'Replication is healthy.' };
const JSON_ANSWER = JSON.stringify(VERDICT);

const LEDGER = {
  checked: ['SRDF pair state on all 4 arrays (live query)'],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
  cannotCover: [
    {
      what: 'host-side multipathing',
      why: 'no collector runs on the ESX hosts',
      short: 'multipathing',
      kind: 'scope' as const,
    },
  ],
};

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

const noArgs = { type: 'object', properties: {} } as const;

/** A verdict with its own boundary — `coverage()`. */
const healthTool = defineTool({
  name: 'replication_health',
  description: 'Replication health across the estate',
  inputSchema: noArgs,
  execute: () => coverage({ verdict: 'all pairs synchronized' }, LEDGER),
});

/** A search that found nothing — `absent()`; it repeats one limit on purpose. */
const sessionsTool = defineTool({
  name: 'ndm_sessions',
  description: 'NDM migration sessions',
  inputSchema: noArgs,
  execute: () =>
    absent({
      what: 'NDM migration sessions',
      checked: ['the migration collector'],
      cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
    }),
});

/** Rows from a system of record — `describedResult()` with a coverage field. */
const inventoryTool = defineTool({
  name: 'array_inventory',
  description: 'Arrays in the nightly export',
  inputSchema: noArgs,
  execute: () =>
    describedResult({
      facts: [{ entity: 'array-1', state: 'online' }],
      provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly array export' },
      coverage: {
        checked: ['every array in the nightly export'],
        notChecked: [{ what: 'arrays added since 02:00', why: 'the export runs nightly' }],
      },
    }),
});

type ReactMode = 'dynamic' | 'dynamic-grouped' | 'classic';
type TurnEnd = Record<string, unknown> & { finalContent?: string; answerCoverage?: unknown };

interface Built {
  readonly agent: Agent;
  readonly turnEnds: TurnEnd[];
  readonly tokens: string[];
  readonly fallbacks: unknown[];
}

function build(args: {
  replies: readonly unknown[];
  tools: readonly unknown[];
  typed?: boolean;
  limits?: boolean;
  reactMode?: ReactMode;
  retries?: number;
  fallback?: () => Verdict;
  findings?: boolean;
}): Built {
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never, chunkDelayMs: 0 }),
    model: 'mock',
    maxIterations: 6,
    ...(args.reactMode !== undefined && { reactMode: args.reactMode }),
  }).system('You are a storage engineer.');
  for (const t of args.tools) builder = builder.tool(t as never);
  if (args.findings === true) builder = builder.findings();
  if (args.typed !== false) {
    builder = builder.outputSchema(Verdict, {
      ...(args.retries !== undefined && { retries: args.retries }),
    });
  }
  if (args.fallback !== undefined) builder = builder.outputFallback({ fallback: args.fallback });
  if (args.limits !== false) builder = builder.limitsTravelWithTheAnswer();
  const agent = builder.build();
  const turnEnds: TurnEnd[] = [];
  const tokens: string[] = [];
  const fallbacks: unknown[] = [];
  agent.on('agentfootprint.agent.turn_end', (e) => turnEnds.push(e.payload as TurnEnd));
  agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload.content));
  agent.on('agentfootprint.resilience.output_fallback_triggered', (e) => fallbacks.push(e.payload));
  return { agent, turnEnds, tokens, fallbacks };
}

type State = { answerCoverage?: Coverage; coverageDeclared?: readonly DeclaredCoverage[] };
const stateOf = (agent: Agent): State => (agent.getLastSnapshot()?.sharedState ?? {}) as State;

/** The data as the block prints it — the renderer's format, restated so the
 *  test can hold the data up against the prose a twin agent received. */
function asBlock(c: Coverage): string {
  const section = (label: string, items: Coverage['checked']) =>
    items.length === 0
      ? []
      : [
          `${label}:\n${items
            .map((i) => `- ${i.what}${i.why !== undefined ? ` — ${i.why}` : ''}`)
            .join('\n')}`,
        ];
  return (
    `${COVERAGE_BLOCK_HEADING} — declared by the tools that produced it, not by the model:\n\n` +
    [
      ...section('Checked', c.checked),
      ...section('Not checked', c.notChecked),
      ...section('Cannot cover', c.cannotCover),
    ].join('\n\n')
  );
}

/** What the replication tool plus the absence fold to — the expected data. */
const HEALTH_AND_SESSIONS: Coverage = {
  checked: [
    { what: 'SRDF pair state on all 4 arrays (live query)' },
    { what: 'the migration collector' },
  ],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
  cannotCover: [
    {
      what: 'host-side multipathing',
      why: 'no collector runs on the ESX hosts',
      short: 'multipathing',
      kind: 'scope',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Unit — the fold
// ─────────────────────────────────────────────────────────────────────────

describe('unit: coverageOfAnswer — the block’s fold, as data', () => {
  const row = (over: Partial<DeclaredCoverage>): DeclaredCoverage => ({
    kind: 'ledger',
    toolName: 't',
    iteration: 1,
    checked: [],
    notChecked: [],
    cannotCover: [],
    ...over,
  });

  it('folds in declaration order and says a repeated limit once — the first declaration wins', () => {
    const folded = coverageOfAnswer([
      row({ checked: [{ what: 'a' }], cannotCover: [{ what: 'x', why: 'w', kind: 'scope' }] }),
      row({
        kind: 'absence',
        checked: [{ what: 'b' }, { what: 'a' }],
        cannotCover: [{ what: 'x', why: 'w' }],
      }),
    ]);
    expect(folded).toEqual({
      checked: [{ what: 'a' }, { what: 'b' }],
      notChecked: [],
      cannotCover: [{ what: 'x', why: 'w', kind: 'scope' }],
    });
  });

  it('keeps EVERY entry — the prose block’s cap of twelve is a reading aid, not a limit on the data', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ what: `source ${i + 1}` }));
    expect(coverageOfAnswer([row({ checked: many })])?.checked).toHaveLength(15);
  });

  it('is undefined when nothing was declared, or when every row says nothing', () => {
    expect(coverageOfAnswer([])).toBeUndefined();
    expect(coverageOfAnswer([row({})])).toBeUndefined();
  });

  it('returns detached plain data — never a reference into the rows it folded', () => {
    const item = { what: 'a', why: 'because', short: 'A' };
    const source = [row({ checked: [item] })];
    const folded = coverageOfAnswer(source)!;
    expect(folded.checked[0]).toEqual(item);
    expect(folded.checked[0]).not.toBe(item);
    (folded.checked[0] as { what: string }).what = 'changed';
    expect(item.what).toBe('a');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — runTyped succeeds, and the limits arrive as data
// ─────────────────────────────────────────────────────────────────────────

describe('integration: runTyped() parses a typed answer whose tools declared limits', () => {
  it.each<ReactMode>(['dynamic', 'dynamic-grouped', 'classic'])(
    'coverage() + absent() under a strict parser, %s chart — the value, and the limits beside it',
    async (reactMode) => {
      const t = build({
        replies: [call('replication_health', 'c1'), call('ndm_sessions', 'c2'), final(JSON_ANSWER)],
        tools: [healthTool, sessionsTool],
        reactMode,
      });
      // Before the fix: OutputSchemaError (json-parse) — the block made the answer prose.
      await expect(t.agent.runTyped<Verdict>('is replication healthy?')).resolves.toEqual(VERDICT);
      expect(t.agent.answerCoverage()).toEqual(HEALTH_AND_SESSIONS);
    },
  );

  it('describedResult()’s coverage travels the same way', async () => {
    const t = build({
      replies: [call('array_inventory', 'c1'), final(JSON_ANSWER)],
      tools: [inventoryTool],
    });
    await expect(t.agent.runTyped<Verdict>('which arrays are online?')).resolves.toEqual(VERDICT);
    expect(t.agent.answerCoverage()).toEqual({
      checked: [{ what: 'every array in the nightly export' }],
      notChecked: [{ what: 'arrays added since 02:00', why: 'the export runs nightly' }],
      cannotCover: [],
    });
  });

  it('a schema retry still ends in a parsed answer with the limits beside it', async () => {
    const t = build({
      replies: [
        call('replication_health', 'c1'),
        final('Replication is healthy.'),
        final(JSON_ANSWER),
      ],
      tools: [healthTool],
      retries: 1,
    });
    await expect(t.agent.runTyped<Verdict>('status?')).resolves.toEqual(VERDICT);
    expect(t.agent.answerCoverage()?.cannotCover[0]?.what).toBe('host-side multipathing');
  });

  it('a RAISED absence (requestInput with `absence`) rides the pause and arrives as data on resume', async () => {
    const lookup = defineTool({
      name: 'port_for_device',
      description: 'Which port a device is logged in to.',
      inputSchema: noArgs,
      execute: () =>
        requestInput({
          id: 'fabric',
          question: 'Which fabric is the host cabled to?',
          fields: [{ id: 'fabric', type: 'string' as const, required: true }],
          absence: absent({
            what: 'port logins for the device',
            checked: ['the name-server database on fabric A'],
            notChecked: [{ what: 'fabric B', why: 'the person has not said which fabric' }],
          }),
        }),
    });
    const t = build({
      replies: [call('port_for_device', 'c1'), final(JSON_ANSWER)],
      tools: [lookup],
    });
    const paused = await t.agent.run({ message: 'which port is it on?' });
    if (!isInputPause(paused)) throw new Error('expected an input pause');
    const out = await t.agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { fabric: 'A' },
    });
    expect(out).toBe(JSON_ANSWER);
    expect(t.agent.parseOutput<Verdict>(out as string)).toEqual(VERDICT);
    expect(t.agent.answerCoverage()).toEqual({
      checked: [{ what: 'the name-server database on fabric A' }],
      notChecked: [{ what: 'fabric B', why: 'the person has not said which fabric' }],
      cannotCover: [],
    });
  });

  it('the answer is the model’s PEELED JSON — `.findings()` takes its key off, nothing is added', async () => {
    const withNotes = JSON.stringify({
      ...VERDICT,
      _findings: { previous: [{ toolCallId: 'c1', standing: 'noise' }] },
    });
    const t = build({
      replies: [
        call('replication_health', 'c1', { _findings: { basis: 'direct', expect: 'high' } }),
        final(withNotes),
      ],
      tools: [healthTool],
      findings: true,
    });
    const out = await t.agent.run('status?');
    expect(out).toBe(JSON_ANSWER);
    expect(t.agent.parseOutput<Verdict>(out as string)).toEqual(VERDICT);
    expect(t.agent.answerCoverage()?.checked).toEqual(LEDGER.checked.map((what) => ({ what })));
  });
});

describe('integration: one value, three readers — the accessor, the state and turn_end agree', () => {
  it('run() returns exactly the model’s JSON; the limits are on the state, the accessor and turn_end', async () => {
    const t = build({
      replies: [call('replication_health', 'c1'), call('ndm_sessions', 'c2'), final(JSON_ANSWER)],
      tools: [healthTool, sessionsTool],
    });
    const out = await t.agent.run('is replication healthy?');
    expect(out).toBe(JSON_ANSWER);

    const state = stateOf(t.agent);
    expect(state.answerCoverage).toEqual(HEALTH_AND_SESSIONS);
    // The raw rows stay where they always were — the fold is a projection of them.
    expect(state.coverageDeclared?.map((r) => r.kind)).toEqual(['ledger', 'absence']);

    expect(t.turnEnds).toHaveLength(1);
    expect(t.turnEnds[0]!.finalContent).toBe(JSON_ANSWER);
    expect(t.turnEnds[0]!.answerCoverage).toEqual(HEALTH_AND_SESSIONS);
    // Detached plain data, as every event payload must be (the deferred tier clones it).
    expect(structuredClone(t.turnEnds[0]!.answerCoverage)).toEqual(HEALTH_AND_SESSIONS);
    expect(t.agent.answerCoverage()).toEqual(HEALTH_AND_SESSIONS);
  });

  it('under deferred observer delivery the turn_end field still arrives whole', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [call('replication_health', 'c1'), final(JSON_ANSWER)] as never,
        chunkDelayMs: 0,
      }),
      model: 'mock',
      maxIterations: 6,
      observerDelivery: 'deferred',
    })
      .system('You are a storage engineer.')
      .tool(healthTool)
      .outputSchema(Verdict)
      .limitsTravelWithTheAnswer()
      .build();
    const turnEnds: TurnEnd[] = [];
    agent.on('agentfootprint.agent.turn_end', (e) => turnEnds.push(e.payload as TurnEnd));
    await expect(agent.runTyped<Verdict>('status?')).resolves.toEqual(VERDICT);
    await agent.drainObservers({ timeoutMs: 5_000 });
    expect(turnEnds).toHaveLength(1);
    expect(turnEnds[0]!.answerCoverage).toEqual(agent.answerCoverage());
  });

  it('the data is exactly what the prose block prints for the same run — the same limits, not a second opinion', async () => {
    const typed = build({
      replies: [call('replication_health', 'c1'), call('ndm_sessions', 'c2'), final(JSON_ANSWER)],
      tools: [healthTool, sessionsTool],
    });
    await typed.agent.runTyped('is replication healthy?');
    const prose = build({
      replies: [call('replication_health', 'c1'), call('ndm_sessions', 'c2'), final('All fine.')],
      tools: [healthTool, sessionsTool],
      typed: false,
    });
    const answer = await prose.agent.run('is replication healthy?');
    expect(answer).toBe(`All fine.\n\n---\n\n${asBlock(typed.agent.answerCoverage()!)}`);
  });

  it('a valid typed answer is no longer handed to .outputFallback() — the appended block used to fail it', async () => {
    let fallbackRan = false;
    const t = build({
      replies: [call('replication_health', 'c1'), final(JSON_ANSWER)],
      tools: [healthTool],
      fallback: () => {
        fallbackRan = true;
        return { healthy: false, summary: 'fallback' };
      },
    });
    await expect(t.agent.runTyped<Verdict>('status?')).resolves.toEqual(VERDICT);
    expect(fallbackRan).toBe(false);
    expect(t.fallbacks).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────────────

describe('streaming: a typed answer’s stream carries no appended prose', () => {
  it('the tokens join to the JSON, turn_end.finalContent IS the JSON, and the limits ride beside it', async () => {
    const t = build({
      replies: [call('replication_health', 'c1'), final(JSON_ANSWER)],
      tools: [healthTool],
    });
    const value = await t.agent.runTyped<Verdict>('status?');
    expect(value).toEqual(VERDICT);
    expect(t.tokens.length).toBeGreaterThan(0);
    expect(t.tokens.join('')).toBe(JSON_ANSWER);
    for (const token of t.tokens) expect(token).not.toContain(COVERAGE_BLOCK_HEADING);
    expect(t.turnEnds[0]!.finalContent).toBe(JSON_ANSWER);
    expect(String(t.turnEnds[0]!.finalContent)).not.toContain(COVERAGE_BLOCK_HEADING);
    expect(t.turnEnds[0]!.answerCoverage).toEqual(t.agent.answerCoverage());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

/** Per commit bundle: which stage wrote which keys — the shape of the record. */
const keysOf = (agent: Agent): string[] =>
  (agent.getLastSnapshot()?.commitLog ?? []).map(
    (b) =>
      `${b.stageId}: ${[...Object.keys(b.overwrite ?? {}), ...Object.keys(b.updates ?? {})]
        .sort()
        .join(',')}`,
  );

/** The commit log with clocks, run ids and digests masked — `test/core/tools/byte-identity.test.ts`'s rule. */
const VOLATILE_KEYS = new Set(['runId', 'traceId', 'timestamp', 'at', 'conversationId']);
const CLOCK_KEY = /(?:Ms|At)$/;
const DIGEST = /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/;
const RUN_ID = /^run_[0-9a-z_-]+$/i;
function normalise(value: unknown, key?: string): unknown {
  if (key !== undefined && (VOLATILE_KEYS.has(key) || CLOCK_KEY.test(key))) return '<volatile>';
  if (typeof value === 'string') {
    if (DIGEST.test(value)) return '<digest>';
    if (RUN_ID.test(value)) return '<run-id>';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = normalise((value as Record<string, unknown>)[k], k);
    }
    return out;
  }
  return value;
}
const normalisedLog = (agent: Agent): unknown =>
  normalise(JSON.parse(JSON.stringify(agent.getLastSnapshot()?.commitLog ?? [])));

describe('edge: nothing extra when there is nothing to carry', () => {
  const plain = defineTool({
    name: 'plain',
    description: 'x',
    inputSchema: noArgs,
    execute: () => ({ rows: 3 }),
  });

  it('tools that declared nothing: no key, no accessor value, no turn_end field — and the same record as without the option', async () => {
    const withOption = build({
      replies: [call('plain', 'c1'), final(JSON_ANSWER)],
      tools: [plain],
    });
    await expect(withOption.agent.runTyped<Verdict>('status?')).resolves.toEqual(VERDICT);
    expect(withOption.agent.answerCoverage()).toBeUndefined();
    expect('answerCoverage' in stateOf(withOption.agent)).toBe(false);
    expect('answerCoverage' in withOption.turnEnds[0]!).toBe(false);

    const without = build({
      replies: [call('plain', 'c1'), final(JSON_ANSWER)],
      tools: [plain],
      limits: false,
    });
    await without.agent.runTyped('status?');
    expect(keysOf(withOption.agent)).toEqual(keysOf(without.agent));
    // …and not only the keys: the whole commit log, clocks and run ids aside.
    expect(normalisedLog(withOption.agent)).toEqual(normalisedLog(without.agent));
  });

  it('with limits declared, the ONE addition to the record is `answerCoverage` on the Route decider’s commit', async () => {
    const script = [call('replication_health', 'c1'), final(JSON_ANSWER)];
    const withOption = build({ replies: script, tools: [healthTool] });
    await withOption.agent.runTyped('status?');
    const without = build({ replies: script, tools: [healthTool], limits: false });
    await without.agent.runTyped('status?');

    const a = keysOf(withOption.agent);
    const b = keysOf(without.agent);
    expect(a).toHaveLength(b.length);
    const moved = a.map((line, i) => [line, b[i]!]).filter(([x, y]) => x !== y);
    expect(moved).toHaveLength(1);
    const [changed, before] = moved[0]!;
    expect(changed!.startsWith('sf-route:')).toBe(true);
    const added = changed!
      .slice('sf-route: '.length)
      .split(',')
      .filter((k) => !before!.slice('sf-route: '.length).split(',').includes(k));
    expect(added).toEqual(['answerCoverage']);
  });

  it('the accessor hands back a detached copy — mutating it does not touch the run', async () => {
    const t = build({
      replies: [call('replication_health', 'c1'), final(JSON_ANSWER)],
      tools: [healthTool],
    });
    await t.agent.runTyped('status?');
    const first = t.agent.answerCoverage()!;
    (first.checked as { what: string }[]).length = 0;
    expect(t.agent.answerCoverage()?.checked).toHaveLength(1);
    expect(stateOf(t.agent).answerCoverage?.checked).toHaveLength(1);
  });

  it('undefined before the first run, and on an agent without an output schema', async () => {
    const t = build({
      replies: [call('replication_health', 'c1'), final('All fine.')],
      tools: [healthTool],
      typed: false,
    });
    expect(t.agent.answerCoverage()).toBeUndefined();
    await t.agent.run('status?');
    expect(t.agent.answerCoverage()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the prose answer is untouched
// ─────────────────────────────────────────────────────────────────────────

describe('regression: a prose answer is byte-identical', () => {
  it('the appended block, character for character (captured before the typed path existed)', async () => {
    const t = build({
      replies: [
        call('replication_health', 'c1'),
        call('ndm_sessions', 'c2'),
        final('Replication is healthy. Everything looks fine.'),
      ],
      tools: [healthTool, sessionsTool],
      typed: false,
    });
    const out = await t.agent.run('go');
    expect(out).toBe(
      'Replication is healthy. Everything looks fine.\n\n---\n\n' +
        'Coverage of this answer — declared by the tools that produced it, not by the model:\n\n' +
        'Checked:\n- SRDF pair state on all 4 arrays (live query)\n- the migration collector\n\n' +
        'Not checked:\n- NDM migration sessions — the API timed out — ask again\n\n' +
        'Cannot cover:\n- host-side multipathing — no collector runs on the ESX hosts',
    );
    // …and nothing of the data path leaks into it: no state key, no turn_end field.
    expect(Object.keys(t.turnEnds[0]!).sort()).toEqual([
      'durationMs',
      'finalContent',
      'iterationCount',
      'totalInputTokens',
      'totalOutputTokens',
      'turnIndex',
    ]);
    expect('answerCoverage' in stateOf(t.agent)).toBe(false);
  });

  it('an output schema WITHOUT the option commits no answerCoverage and appends nothing', async () => {
    const t = build({
      replies: [call('replication_health', 'c1'), final(JSON_ANSWER)],
      tools: [healthTool],
      limits: false,
    });
    await expect(t.agent.runTyped<Verdict>('status?')).resolves.toEqual(VERDICT);
    expect('answerCoverage' in stateOf(t.agent)).toBe(false);
    expect('answerCoverage' in t.turnEnds[0]!).toBe(false);
  });
});
