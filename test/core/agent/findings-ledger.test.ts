/**
 * Integration — the findings ledger on the record (9.101.0, step 2 of the
 * findings-ledger program), driven through real agent runs on the mock
 * provider.
 *
 * Pattern: Test-as-specification, scenario style.
 * Role:    Pin the WIRING — every gate is `.findings()`, and each landing site
 *          does exactly one thing:
 *
 *   • the tools slot / seed DECORATE every served schema with the reserved
 *     `_findings` property (`required` untouched);
 *   • the dispatch loop PEELS it as the first read of the call's args, so
 *     `tool_start`, middleware and `execute` never see it, files the BASIS
 *     row before `tool_start`, and files the previous batch's STANDINGS off
 *     the next call — while history keeps the emission verbatim;
 *   • the enforcing decider peels a JSON answer's top-level `_findings`,
 *     files `declaredOn: 'answer'` rows and judges the peeled content;
 *   • the checkpoint carries the ledger and `continueFrom` re-seeds it;
 *   • the registry refuses an author's `_findings` at build, armed only;
 *   • the unarmed twin is byte-for-byte the agent it always was.
 *
 * The leaf modules have their own unit tests (`findings/reserved.test.ts`,
 * `findings/ledger.test.ts`); nothing here re-proves a pure function.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  RESERVED_ARGUMENT,
  ask,
  checkInApproved,
  isAskPause,
  servedViews,
  slidingWindow,
  type BasisRow,
  type FindingsRow,
  type StandingRow,
} from '../../../src/index.js';
import { defineTool } from '../../../src/core/tools.js';
import { mock } from '../../../src/llm-providers.js';
import type {
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
  PermissionChecker,
} from '../../../src/adapters/types.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { allow } from '../../../src/core/agent/middleware/outcomes.js';
import {
  FINDINGS_ARGUMENT_SCHEMA,
  FINDINGS_INSTRUCTION,
} from '../../../src/core/agent/findings/reserved.js';
import { PolicyHaltError } from '../../../src/security/index.js';
import { notDispatchedResult } from '../../../src/core/agent/stages/toolCalls.js';
import { staticTools } from '../../../src/tool-providers/index.js';
import { defineSkill } from '../../../src/injection-engine.js';
import { TOOL_RESULTS } from './fixtures/sanEvidence.js';

type Row = { type: string; payload: Record<string, unknown> };
type Shot = {
  readonly tools: readonly LLMToolSchema[];
  readonly system: string | undefined;
  /** The `role: 'tool'` ids on the wire, in wire order — what an offer may list. */
  readonly toolIds: readonly string[];
};

/** One request, snapshotted (the schemas are plain data; the system prompt a string). */
const shotOf = (req: LLMRequest): Shot => ({
  tools: JSON.parse(JSON.stringify(req.tools ?? [])) as LLMToolSchema[],
  system: req.systemPrompt,
  toolIds: req.messages
    .filter((m) => m.role === 'tool' && m.toolCallId !== undefined)
    .map((m) => m.toolCallId as string),
});

/** A provider that answers each call from a script, snapshotting every request. */
function scripted(seen: Shot[], ...turns: readonly (string | Partial<LLMResponse>)[]) {
  let i = 0;
  return mock({
    respond: (req: LLMRequest) => {
      seen.push(shotOf(req));
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      return turn;
    },
  });
}

/** A tool that records the args it ran with. */
function recordingTool(name: string, ran: Record<string, unknown>[], extra: object = {}) {
  return defineTool({
    name,
    description: `${name} something up`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, ...extra },
    execute: (args: Record<string, unknown>) => {
      ran.push(args);
      return `RESULT for ${String(args.q ?? '')}`;
    },
  } as never);
}

async function runCollecting(agent: Agent, message = 'which port is down?'): Promise<Row[]> {
  const rows: Row[] = [];
  agent.on('*', (e) =>
    rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  await agent.run({ message });
  return rows;
}

const ledgerOf = (agent: Agent): readonly FindingsRow[] | undefined =>
  (agent.getLastSnapshot()?.sharedState as Partial<AgentState> | undefined)?.findingsLedger;

const keysOf = (agent: Agent): string[] =>
  Object.keys(agent.getLastSnapshot()?.sharedState ?? {}).sort();

/** The two-iteration script every dispatch scenario shares: a basis on call 1,
 *  a basis + the previous result's standing on call 2, then a text answer. */
const FACT_ASSERTION = { subject: { kind: 'port', id: 'p1' }, predicate: 'status', value: 'down' };
const CALL_ONE: Partial<LLMResponse> = {
  content: '',
  toolCalls: [
    {
      id: 'c1',
      name: 'look',
      args: { q: 'ports', _findings: { basis: 'direct', expect: 'high' } },
    },
  ],
};
const CALL_TWO: Partial<LLMResponse> = {
  content: '',
  toolCalls: [
    {
      id: 'c2',
      name: 'look',
      args: {
        q: 'p1',
        _findings: {
          basis: 'exploratory',
          previous: [
            { toolCallId: 'c1', standing: 'fact', sought: true, assertions: [FACT_ASSERTION] },
          ],
        },
      },
    },
  ],
};

// ─── 1. schemas on the record ───────────────────────────────────────────

describe('.findings() — every served schema carries the reserved argument', () => {
  it('decorates the wire on every call, leaves `required` alone, and adds the instruction piece', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: scripted(seen, CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', [], { required: ['q'] }) as never)
      .findings()
      .build();
    await agent.run({ message: 'which port is down?' });

    expect(seen.length).toBe(3);
    for (const shot of seen) {
      const look = shot.tools.find((t) => t.name === 'look')!;
      const properties = look.inputSchema.properties as Record<string, unknown>;
      expect(Object.keys(properties)).toEqual(['q', RESERVED_ARGUMENT]);
      expect(look.inputSchema.required).toEqual(['q']);
      expect(shot.system).toContain(FINDINGS_INSTRUCTION);
    }
  });

  it('an unarmed agent serves undecorated schemas and no instruction', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({ provider: scripted(seen, 'done'), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .build();
    await agent.run({ message: 'hi' });
    const look = seen[0]!.tools.find((t) => t.name === 'look')!;
    expect(Object.keys(look.inputSchema.properties as object)).toEqual(['q']);
    expect(seen[0]!.system ?? '').not.toContain('Findings v1');
  });
});

// ─── 2. dispatch: the peel, the basis row, the standings ────────────────

describe('.findings() — dispatch peels, files a basis, files the previous batch', () => {
  it('execute and tool_start never see `_findings`; history keeps the emission verbatim', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({
      provider: scripted([], CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', ran) as never)
      .findings()
      .build();
    const rows = await runCollecting(agent);

    expect(ran).toEqual([{ q: 'ports' }, { q: 'p1' }]);
    const starts = rows.filter((r) => r.type === 'agentfootprint.stream.tool_start');
    expect(starts.map((r) => r.payload.args)).toEqual([{ q: 'ports' }, { q: 'p1' }]);

    const history = (agent.getLastSnapshot()?.sharedState as unknown as AgentState).history;
    const emissions = history
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.toolCalls ?? [])
      .map((c) => c.args);
    expect(emissions).toEqual([CALL_ONE.toolCalls![0]!.args, CALL_TWO.toolCalls![0]!.args]);
  });

  it('files the basis row before tool_start, and the standing off the next call', async () => {
    const agent = Agent.create({
      provider: scripted([], CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    const rows = await runCollecting(agent);

    // Event order: declared → tool_start, per call.
    const order = rows
      .filter(
        (r) =>
          r.type === 'agentfootprint.findings.declared' ||
          r.type === 'agentfootprint.stream.tool_start',
      )
      .map((r) => `${r.type.split('.').pop()}:${String(r.payload.toolCallId)}`);
    expect(order).toEqual(['declared:c1', 'tool_start:c1', 'declared:c2', 'tool_start:c2']);

    const declared = rows
      .filter((r) => r.type === 'agentfootprint.findings.declared')
      .map((r) => r.payload);
    expect(declared).toEqual([
      { toolName: 'look', toolCallId: 'c1', iteration: 1, basis: 'direct', expect: 'high' },
      { toolName: 'look', toolCallId: 'c2', iteration: 2, basis: 'exploratory' },
    ]);
    const standing = rows
      .filter((r) => r.type === 'agentfootprint.findings.standing')
      .map((r) => r.payload);
    expect(standing).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'look',
        iteration: 2,
        standing: 'fact',
        declaredOn: 'tool-call',
        assertionCount: 1,
      },
    ]);

    const ledger = ledgerOf(agent)!;
    expect(ledger.map((r) => r.kind)).toEqual(['basis', 'standing', 'basis']);
    expect(ledger[0]).toEqual({
      kind: 'basis',
      toolCallId: 'c1',
      toolName: 'look',
      iteration: 1,
      basis: 'direct',
      expect: 'high',
    });
    expect(ledger[1]).toEqual({
      kind: 'standing',
      toolCallId: 'c1',
      toolName: 'look',
      standing: 'fact',
      sought: true,
      assertions: [{ ...FACT_ASSERTION, stratum: 'asserted', provenance: 'tool:c1' }],
      declaredOn: { toolCallId: 'c2' },
      iteration: 2,
    });
    expect(ledger[2]).toMatchObject({
      kind: 'basis',
      toolCallId: 'c2',
      basis: 'exploratory',
      iteration: 2,
    });
    // Nothing on the standing row was inferred: no `epoch`, no `ref`.
    expect(ledger[1]).not.toHaveProperty('ref');
    expect((ledger[1] as unknown as { assertions: object[] }).assertions[0]).not.toHaveProperty(
      'epoch',
    );

    // The accessor is a detached copy of the committed key.
    const copy = agent.findings()!;
    expect(copy).toEqual(ledger);
    expect(copy).not.toBe(ledger);
  });

  it('a tool with additionalProperties:false under `enforce` still runs — the peel precedes validation', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({
      provider: scripted([], CALL_ONE, 'done'),
      model: 'm',
      toolArgValidation: 'enforce',
    })
      .tool(recordingTool('look', ran, { additionalProperties: false }) as never)
      .findings()
      .build();
    const rows = await runCollecting(agent);
    expect(ran).toEqual([{ q: 'ports' }]);
    expect(rows.filter((r) => r.type === 'agentfootprint.validation.args_invalid')).toEqual([]);
    expect(ledgerOf(agent)!.map((r) => r.kind)).toEqual(['basis']);
  });

  it('the onToolCall middleware chain sees peeled args', async () => {
    const chainSaw: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: scripted([], CALL_ONE, 'done'), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .findings()
      .act({
        beforeTool: [
          {
            name: 'watch',
            onToolCall: (call: { args: Record<string, unknown> }) => {
              chainSaw.push(call.args);
              return allow();
            },
          },
        ] as never,
      })
      .build();
    await agent.run({ message: 'go' });
    expect(chainSaw).toEqual([{ q: 'ports' }]);
  });

  it('a call with no `_findings` files no row; a standing for an unknown id is recorded, never resolved', async () => {
    const agent = Agent.create({
      provider: scripted(
        [],
        { content: '', toolCalls: [{ id: 'c1', name: 'look', args: { q: 'a' } }] },
        {
          content: '',
          toolCalls: [
            {
              id: 'c2',
              name: 'look',
              args: {
                q: 'b',
                _findings: { previous: [{ toolCallId: 'ghost', standing: 'noise' }] },
              },
            },
          ],
        },
        'done',
      ),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    const rows = await runCollecting(agent);
    const ledger = ledgerOf(agent)!;
    // c1 declared nothing → no basis row; c2 declared no basis → none either.
    expect(ledger.map((r) => r.kind)).toEqual(['standing']);
    expect(ledger[0]).toMatchObject({
      toolCallId: 'ghost',
      standing: 'noise',
      unknownId: true,
      assertions: [],
    });
    expect(ledger[0]).not.toHaveProperty('toolName');
    expect(rows.filter((r) => r.type === 'agentfootprint.findings.declared')).toEqual([]);
    expect(rows.find((r) => r.type === 'agentfootprint.findings.standing')?.payload).toMatchObject({
      toolCallId: 'ghost',
      unknownId: true,
      assertionCount: 0,
    });
  });
});

// ─── 3. the unarmed twin ────────────────────────────────────────────────

describe('.findings() — the unarmed agent is the agent it always was', () => {
  it('armed-but-silent: same committed keys as unarmed, no ledger, no events', async () => {
    const script: (string | Partial<LLMResponse>)[] = [
      { content: '', toolCalls: [{ id: 'c1', name: 'look', args: { q: 'a' } }] },
      'done',
    ];
    const on = Agent.create({ provider: scripted([], ...script), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    const off = Agent.create({ provider: scripted([], ...script), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .build();
    const rowsOn = await runCollecting(on);
    const rowsOff = await runCollecting(off);
    // The arm IS one visible thing: the always-on instruction piece, injected
    // on every call (`context.injected`, source id `findings-ledger`). Every
    // other event, and every committed key, is the unarmed agent's.
    const injected = 'agentfootprint.context.injected';
    expect(rowsOn.filter((r) => r.type !== injected).map((r) => r.type)).toEqual(
      rowsOff.filter((r) => r.type !== injected).map((r) => r.type),
    );
    const extraInjected =
      rowsOn.filter((r) => r.type === injected).length -
      rowsOff.filter((r) => r.type === injected).length;
    expect(extraInjected).toBeGreaterThan(0);
    expect(
      rowsOn.filter((r) => r.type === injected && r.payload.sourceId === 'findings-ledger'),
    ).toHaveLength(extraInjected);
    // …plus the ONE run constant the arm seeds on every run (`findingsServe`,
    // step 3 — `seed.ts · seedFrom`): the serve mode the rebuild reads. No
    // ledger, because the model declared nothing.
    expect(keysOf(on)).toEqual([...keysOf(off), 'findingsServe'].sort());
    expect(keysOf(on)).not.toContain('findingsLedger');
    expect(on.findings()).toBeUndefined();
    expect(rowsOn.filter((r) => r.type.startsWith('agentfootprint.findings.'))).toEqual([]);
  });

  it("unarmed: an author's `_findings` argument passes through to execute untouched", async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: scripted([], CALL_ONE, 'done'), model: 'm' })
      .tool(recordingTool('look', ran) as never)
      .build();
    const rows = await runCollecting(agent);
    expect(ran).toEqual([CALL_ONE.toolCalls![0]!.args]);
    expect(rows.find((r) => r.type === 'agentfootprint.stream.tool_start')?.payload.args).toEqual(
      CALL_ONE.toolCalls![0]!.args,
    );
    expect(keysOf(agent)).not.toContain('findingsLedger');
  });
});

// ─── 4. the answer turn under an output schema ──────────────────────────

describe(".findings() — the JSON answer carries the last batch's standings", () => {
  /** A strict parser: refuses any key it does not know — including `_findings`. */
  const strict = {
    parse: (value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('not an object');
      const keys = Object.keys(value as object);
      const unknown = keys.filter((k) => k !== 'down');
      if (unknown.length > 0) throw new Error(`unknown keys: ${unknown.join(',')}`);
      return value as { down: string };
    },
  };
  const ANSWER = JSON.stringify({
    down: 'p1',
    _findings: { previous: [{ toolCallId: 'c1', standing: 'ruled-out', line: 'p2 was up' }] },
  });

  it('files declaredOn: answer, judges the peeled content (no retry), and runTyped returns the peeled object', async () => {
    const agent = Agent.create({ provider: scripted([], CALL_ONE, ANSWER), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .findings()
      .outputSchema(strict, { retries: 0 })
      .build();
    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const typed = await agent.runTyped<{ down: string }>({ message: 'which port is down?' });

    expect(typed).toEqual({ down: 'p1' });
    expect(rows.filter((r) => r.type === 'agentfootprint.agent.output_schema_retry')).toEqual([]);
    const ledger = ledgerOf(agent)!;
    expect(ledger.map((r) => r.kind)).toEqual(['basis', 'standing']);
    expect(ledger[1]).toEqual({
      kind: 'standing',
      toolCallId: 'c1',
      toolName: 'look',
      standing: 'ruled-out',
      line: 'p2 was up',
      assertions: [],
      declaredOn: 'answer',
      iteration: 2,
    });
    expect(rows.find((r) => r.type === 'agentfootprint.findings.standing')?.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'look',
      iteration: 2,
      standing: 'ruled-out',
      declaredOn: 'answer',
      assertionCount: 0,
    });
    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    expect(state.outputAttempts?.map((a) => a.outcome)).toEqual(['passed']);
  });

  it('a JSON answer without the key is judged exactly as before', async () => {
    const agent = Agent.create({ provider: scripted([], '{"down":"p1"}'), model: 'm' })
      .findings()
      .outputSchema(strict, { retries: 0 })
      .build();
    expect(await agent.runTyped({ message: 'q' })).toEqual({ down: 'p1' });
    expect(keysOf(agent)).not.toContain('findingsLedger');
  });
});

// ─── 5. pause, resume, and the pre-8.13 fallback ─────────────────────────

describe('.findings() — a pause mid-call keeps one basis row and peels the fallback', () => {
  const PAUSING: Partial<LLMResponse> = {
    content: '',
    toolCalls: [
      {
        id: 't1',
        name: 'ask_person',
        args: { topic: 'refund', amount: 500, _findings: { basis: 'direct' } },
      },
    ],
  };
  function pausingAgent(
    onToolResult?: (call: { args: Readonly<Record<string, unknown>> }) => unknown,
  ) {
    const builder = Agent.create({ provider: scripted([], PAUSING, 'all done'), model: 'm' })
      .system('')
      .tool({
        schema: { name: 'ask_person', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'what should I tell them?' });
          return '';
        },
      })
      .findings();
    return onToolResult === undefined
      ? builder.build()
      : builder
          .act({
            afterTool: [{ name: 'reader', onToolResult: (c: never) => onToolResult(c) }] as never,
          })
          .build();
  }

  it('exactly ONE basis row for the paused call after resume; the resume door files nothing', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    // The row is on the pre-pause partial commit, and the checkpoint carries it.
    expect(paused.checkpoint.sharedState).toMatchObject({
      findingsLedger: [{ kind: 'basis', toolCallId: 't1', basis: 'direct' }],
    });
    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    await agent.resume(paused.checkpoint, 'tell them yes');
    expect(
      ledgerOf(agent)!.filter((r) => r.kind === 'basis' && r.toolCallId === 't1'),
    ).toHaveLength(1);
    expect(rows.filter((r) => r.type === 'agentfootprint.findings.declared')).toEqual([]);
  });

  it('a pre-8.13 checkpoint (no pausedToolArgs) recovers args from history WITHOUT the key', async () => {
    const seenArgs: Readonly<Record<string, unknown>>[] = [];
    const agent = pausingAgent((call) => {
      seenArgs.push(call.args);
      return allow();
    });
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    const legacy = JSON.parse(JSON.stringify(paused.checkpoint)) as {
      sharedState: Record<string, unknown>;
    };
    delete legacy.sharedState.pausedToolArgs;
    await agent.resume(legacy as never, 'answered');
    expect(seenArgs).toEqual([{ topic: 'refund', amount: 500 }]);
  });
});

// ─── 6. the checkpoint carrier and continueFrom ──────────────────────────

describe('.findings() — the conversation carrier keeps the ledger', () => {
  it('checkpoint() carries the ledger only when rows exist; continueFrom re-seeds it as a record', async () => {
    const first = Agent.create({
      provider: scripted([], CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    await first.run({ message: 'which port is down?' });
    const cp = first.checkpoint()!;
    expect(cp.findingsLedger).toEqual(ledgerOf(first));

    const second = Agent.create({ provider: scripted([], 'still p1'), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    const rows = await (async () => {
      const out: Row[] = [];
      second.on('*', (e) =>
        out.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
      );
      await second.run({ message: 'and now?', continueFrom: cp });
      return out;
    })();
    // Restored verbatim, and restored as a RECORD — no event re-fired.
    expect(ledgerOf(second)).toEqual(cp.findingsLedger);
    expect(rows.filter((r) => r.type.startsWith('agentfootprint.findings.'))).toEqual([]);
  });

  it('an agent that recorded nothing writes no findingsLedger on its checkpoint', async () => {
    const agent = Agent.create({ provider: scripted([], 'done'), model: 'm' })
      .findings()
      .build();
    await agent.run({ message: 'hi' });
    expect(agent.checkpoint()).not.toHaveProperty('findingsLedger');
  });
});

// ─── 7. the door ─────────────────────────────────────────────────────────

describe('.findings() — the door', () => {
  it('refuses a second call, a bad serve, and a bad keepLedgerFacts', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .findings()
        .findings(),
    ).toThrow(/already set/);
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).findings({
        serve: 'all' as never,
      }),
    ).toThrow(/serve/);
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).findings({
        keepLedgerFacts: -1,
      }),
    ).toThrow(/keepLedgerFacts/);
  });

  it('given as an option it is the same door: armed, and a later .findings() is the second call', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({ provider: scripted(seen, 'done'), model: 'm', findings: {} })
      .tool(recordingTool('look', []) as never)
      .build();
    await agent.run({ message: 'hi' });
    expect(Object.keys(seen[0]!.tools[0]!.inputSchema.properties as object)).toContain(
      RESERVED_ARGUMENT,
    );
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm', findings: {} }).findings(),
    ).toThrow(/already set/);
  });

  it("refuses reactMode 'classic' at build — through both doors — because the cached tools slot could never carry the offer; 'dynamic-grouped' builds", () => {
    // Classic selects the Tools branch on turn 1 only, so an armed classic
    // agent would serve the offer-less base on every call and file every
    // standing as `unknownId` — a silent degrade of the number the packet
    // exists to move. Refused loud, the `selfExplain` twin.
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm', reactMode: 'classic' })
        .findings()
        .build(),
    ).toThrow(/reactMode 'classic' caches the tools slot/);
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'x' }),
        model: 'm',
        reactMode: 'classic',
        findings: {},
      }).build(),
    ).toThrow(/per-iteration slot recomposition/);
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm', reactMode: 'dynamic-grouped' })
        .findings()
        .build(),
    ).not.toThrow();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm', reactMode: 'classic' }).build(),
    ).not.toThrow();
  });

  it('refuses a registry tool that declares `_findings` — armed only, naming the tool', () => {
    const clashing = defineTool({
      name: 'clash',
      description: 'declares the reserved name',
      inputSchema: { type: 'object', properties: { _findings: { type: 'string' } } },
      execute: () => 'x',
    } as never);
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .tool(clashing as never)
        .findings()
        .build(),
    ).toThrow(/tool 'clash' declares the reserved argument '_findings'/);
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .tool(clashing as never)
        .build(),
    ).not.toThrow();
  });
});

// ─── 8. BOTH chart shapes ────────────────────────────────────────────────
//
// The `skillGraphSelfCallGrouped` harness lesson: a chart shape is a
// rendering choice and must not change what lands on the record. Under
// `'dynamic-grouped'` the Tools slot and the LLM call run inside
// `sf-llm-call`; the dispatch loop and the Route decider — the two writers
// of `findingsLedger` — run on the main chart in both shapes.

describe('.findings() — the same record under both chart shapes', () => {
  const ledgers: Partial<Record<'dynamic' | 'dynamic-grouped', readonly FindingsRow[]>> = {};

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: basis + declared precede tool_start; the standing rides the next call`, async () => {
      const seen: Shot[] = [];
      const ran: Record<string, unknown>[] = [];
      const agent = Agent.create({
        provider: scripted(seen, CALL_ONE, CALL_TWO, 'p1 is down'),
        model: 'm',
        reactMode,
      })
        .tool(recordingTool('look', ran) as never)
        .findings()
        .build();
      const rows = await runCollecting(agent);

      const order = rows
        .filter(
          (r) =>
            r.type === 'agentfootprint.findings.declared' ||
            r.type === 'agentfootprint.stream.tool_start',
        )
        .map((r) => `${r.type.split('.').pop()}:${String(r.payload.toolCallId)}`);
      expect(order).toEqual(['declared:c1', 'tool_start:c1', 'declared:c2', 'tool_start:c2']);
      expect(ran).toEqual([{ q: 'ports' }, { q: 'p1' }]);
      for (const shot of seen) {
        const look = shot.tools.find((t) => t.name === 'look')!;
        expect(Object.keys(look.inputSchema.properties as object)).toContain(RESERVED_ARGUMENT);
      }
      const ledger = ledgerOf(agent)!;
      expect(ledger.map((r) => r.kind)).toEqual(['basis', 'standing', 'basis']);
      expect(ledger[1]).toMatchObject({
        kind: 'standing',
        toolCallId: 'c1',
        declaredOn: { toolCallId: 'c2' },
        iteration: 2,
      });
      ledgers[reactMode] = ledger;
    });

    it(`${reactMode}: the JSON answer files declaredOn: 'answer' and runTyped returns the peeled object`, async () => {
      const parser = {
        parse: (value: unknown) => {
          const v = value as Record<string, unknown>;
          if (typeof v?.down !== 'string') throw new Error('down must be a string');
          if (Object.keys(v).some((k) => k !== 'down')) throw new Error('unknown key');
          return v as { down: string };
        },
      };
      const agent = Agent.create({
        provider: scripted(
          [],
          CALL_ONE,
          JSON.stringify({
            down: 'p1',
            _findings: { previous: [{ toolCallId: 'c1', standing: 'open', settles: 'a ping' }] },
          }),
        ),
        model: 'm',
        reactMode,
      })
        .tool(recordingTool('look', []) as never)
        .findings()
        .outputSchema(parser, { retries: 0 })
        .build();
      expect(await agent.runTyped<{ down: string }>({ message: 'q' })).toEqual({ down: 'p1' });
      const ledger = ledgerOf(agent)!;
      expect(ledger.map((r) => r.kind)).toEqual(['basis', 'standing']);
      expect(ledger[1]).toMatchObject({
        toolCallId: 'c1',
        standing: 'open',
        settles: 'a ping',
        declaredOn: 'answer',
        assertions: [],
      });
      const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
      // The peeled JSON is what the run hands back and what the conversation
      // carrier appends as the answer turn (`Agent.checkpoint` pushes
      // `lastRunAnswer`; `prepareFinal` runs in a non-merging subflow, so the
      // final answer is not in `sharedState.history` at all). Recorded as a
      // fact in the worklog: the ANSWER emission is on the record peeled —
      // only the tool-call emission (`toolCalls[].args`) stays raw.
      expect(state.llmLatestContent).toBe('{"down":"p1"}');
      expect(agent.checkpoint()!.history.at(-1)).toEqual({
        role: 'assistant',
        content: '{"down":"p1"}',
      });
    });
  }

  it('the two shapes wrote the same ledger', () => {
    expect(ledgers['dynamic-grouped']).toEqual(ledgers.dynamic);
  });
});

// ─── 9. the unarmed twin of a DECLARING model ────────────────────────────

describe('.findings() — the unarmed twin of a declaring model', () => {
  it('keys(on) is keys(off) plus findingsLedger; off passes the key through, decorates nothing, fires nothing', async () => {
    const seenOn: Shot[] = [];
    const seenOff: Shot[] = [];
    const ranOn: Record<string, unknown>[] = [];
    const ranOff: Record<string, unknown>[] = [];
    const on = Agent.create({
      provider: scripted(seenOn, CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', ranOn) as never)
      .findings()
      .build();
    const off = Agent.create({
      provider: scripted(seenOff, CALL_ONE, CALL_TWO, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', ranOff) as never)
      .build();
    const rowsOn = await runCollecting(on);
    const rowsOff = await runCollecting(off);

    // The agent-wrap-up.test.ts pattern: the committed key set differs by
    // exactly the keys the feature owns — the ledger the model wrote, and the
    // serve-mode run constant seed writes on every armed run (step 3).
    expect(keysOf(on)).toEqual([...keysOf(off), 'findingsLedger', 'findingsServe'].sort());
    expect(keysOf(off)).not.toContain('findingsLedger');
    expect(off.findings()).toBeUndefined();

    // Off: the author's argument reaches execute and tool_start untouched.
    expect(ranOff).toEqual([CALL_ONE.toolCalls![0]!.args, CALL_TWO.toolCalls![0]!.args]);
    expect(ranOn).toEqual([{ q: 'ports' }, { q: 'p1' }]);
    expect(
      rowsOff
        .filter((r) => r.type === 'agentfootprint.stream.tool_start')
        .map((r) => r.payload.args),
    ).toEqual([CALL_ONE.toolCalls![0]!.args, CALL_TWO.toolCalls![0]!.args]);

    // Off: schemas undecorated, no instruction piece, no findings event.
    for (const shot of seenOff) {
      const look = shot.tools.find((t) => t.name === 'look')!;
      expect(Object.keys(look.inputSchema.properties as object)).toEqual(['q']);
      expect(shot.system ?? '').not.toContain('Findings v1');
    }
    expect(rowsOff.filter((r) => r.type.startsWith('agentfootprint.findings.'))).toEqual([]);
    expect(
      rowsOff.filter(
        (r) =>
          r.type === 'agentfootprint.context.injected' && r.payload.sourceId === 'findings-ledger',
      ),
    ).toEqual([]);
    // On: the same run, with the record.
    expect(rowsOn.filter((r) => r.type.startsWith('agentfootprint.findings.'))).toHaveLength(3);
  });
});

// ─── 10. an ask-human pause MID-BATCH ────────────────────────────────────

describe('.findings() — an ask-human pause mid-batch keeps ONE basis row per call', () => {
  const BATCH: Partial<LLMResponse> = {
    content: '',
    toolCalls: [
      { id: 'c1', name: 'look', args: { q: 'a', _findings: { basis: 'direct' } } },
      { id: 'c2', name: 'pay', args: { amount: 5000, _findings: { basis: 'exploratory' } } },
      { id: 'c3', name: 'look', args: { q: 'c', _findings: { basis: 'direct', expect: 'low' } } },
    ],
  };
  const payTool = (ran: Record<string, unknown>[]) =>
    defineTool({
      name: 'pay',
      description: 'pays',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      execute: (args: Record<string, unknown>) => {
        ran.push(args);
        return 'paid';
      },
    } as never);

  it('the paused call keeps the row filed before the pause; the resume door files nothing new for it', async () => {
    const ran: Record<string, unknown>[] = [];
    const chainSaw: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: scripted([], BATCH, 'done'), model: 'm' })
      .tool(recordingTool('look', ran) as never)
      .tool(payTool(ran) as never)
      .findings()
      .toolMiddleware({
        name: 'big-spend',
        onToolCall: (call) => {
          chainSaw.push({ ...call.args });
          return Number(call.args.amount) > 1000 ? ask({ question: 'approve?' }) : allow();
        },
      })
      .build();
    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) return expect.fail('expected an ask pause');

    // c1 ran, c2 asked: both rows are on the pre-pause partial commit.
    const before = (paused.checkpoint.sharedState as Partial<AgentState>).findingsLedger!;
    const basisRows = (rows: readonly FindingsRow[]): BasisRow[] =>
      rows.filter((r): r is BasisRow => r.kind === 'basis');
    expect(basisRows(before).map((r) => r.toolCallId)).toEqual(['c1', 'c2']);
    expect(ran).toEqual([{ q: 'a' }]);
    // The chain never saw the key on either call.
    for (const args of chainSaw) expect(args).not.toHaveProperty(RESERVED_ARGUMENT);

    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    // Exactly ONE row per call that reached the loop head: c1 (ran before the
    // pause) and c2 (asked). The sibling AFTER the asked call, c3, is never
    // dispatched on resume. Since 9.113.0 the resume door SETTLES it — a fixed
    // result, a bracket and a count (`toolCalls.ts` · `notDispatchedResult`) —
    // and it still files no row: its declaration lives only in the emission.
    // Never inferred from history, never filed by the resume door.
    expect(basisRows(ledgerOf(agent)!).map((r) => r.toolCallId)).toEqual(['c1', 'c2']);
    // The resume door filed nothing: no `findings.declared` at all on resume.
    expect(rows.filter((r) => r.type === 'agentfootprint.findings.declared')).toEqual([]);
    // The approved call ran with the PEELED args (the pause carrier was
    // `callArgs`); c3 never ran.
    expect(ran).toEqual([{ q: 'a' }, { amount: 5000 }]);
    // c3's result is the settlement's sentence, so the next request carried a
    // result for every call the batch proposed (9.113.0).
    const toolMessages = agent.checkpoint()!.history.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => m.toolCallId)).toEqual(['c1', 'c2', 'c3']);
    expect(toolMessages[2]!.content).toBe(
      notDispatchedResult('look', { toolName: 'pay', toolCallId: 'c2' }),
    );
    // The settled bracket carries the PEELED args, as the batch loop's would.
    const settledStart = rows.find(
      (r) => r.type === 'agentfootprint.stream.tool_start' && r.payload.toolCallId === 'c3',
    );
    expect(settledStart?.payload.args).toEqual({ q: 'c' });
  });
});

// ─── 11. a failed attempt keeps the raw emission; the record keeps both rows ─

describe(".findings() — a schema retry keeps the raw emission and files each attempt's standings", () => {
  it('outputAttempts is [retried, passed]; history keeps the raw; the ledger takes the last standing', async () => {
    const parser = {
      parse: (value: unknown) => {
        const v = value as Record<string, unknown>;
        if (typeof v?.down !== 'string') throw new Error('down must be a string');
        if (Object.keys(v).some((k) => k !== 'down')) throw new Error('unknown key');
        return v as { down: string };
      },
    };
    const FIRST = JSON.stringify({
      down: 42,
      _findings: { previous: [{ toolCallId: 'c1', standing: 'open', settles: 'a ping' }] },
    });
    const SECOND = JSON.stringify({
      down: 'p1',
      _findings: {
        previous: [{ toolCallId: 'c1', standing: 'fact', assertions: [FACT_ASSERTION] }],
      },
    });
    const agent = Agent.create({ provider: scripted([], CALL_ONE, FIRST, SECOND), model: 'm' })
      .tool(recordingTool('look', []) as never)
      .findings()
      .outputSchema(parser, { retries: 1 })
      .build();
    expect(await agent.runTyped<{ down: string }>({ message: 'q' })).toEqual({ down: 'p1' });

    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    expect(state.outputAttempts?.map((a) => a.outcome)).toEqual(['retried', 'passed']);
    // The failure charged to the model is the SHAPE, never the reserved key.
    expect(state.outputAttempts?.[0]?.error).not.toContain('_findings');
    // The failed answer turn the retry stage writes into history is the
    // EMISSION — the string the provider returned, reserved key and all. The
    // decider judged the PEELED answer (the error above names the shape) and
    // put the emission back before routing to the retry (`route.ts ·
    // buildEnforcingDecider · reAsk`), so history never holds a turn the
    // model did not send and the next request echoes what it did.
    const failedTurn = state.history.filter((m) => m.role === 'assistant').at(-1)!;
    expect(failedTurn.content).toBe(FIRST);
    expect(JSON.parse(failedTurn.content) as object).toHaveProperty(RESERVED_ARGUMENT);
    // The corrective message quotes the validator's complaint about the shape;
    // the reserved key never reaches it.
    const correction = state.history.at(-1)!;
    expect(correction.role).toBe('user');
    expect(correction.content).toContain('down must be a string');
    expect(correction.content).not.toContain(RESERVED_ARGUMENT);
    // Two standing rows for c1 — the earlier one is quotable history, the last is current.
    const standings = ledgerOf(agent)!.filter((r): r is StandingRow => r.kind === 'standing');
    expect(standings.map((r) => r.standing)).toEqual(['open', 'fact']);
    expect(standings.every((r) => r.toolCallId === 'c1')).toBe(true);
    expect(agent.findings()!.filter((r) => r.kind === 'conflict')).toEqual([]);
  });
});

// ─── 12. a policy halt hands the app what the call would have RUN with ───

describe('.findings() — a policy halt carries the peeled args', () => {
  it('PolicyHaltError.proposed.args and policyHaltArgs never carry the reserved key; the basis row stays', async () => {
    const checker: PermissionChecker = {
      name: 'halt-on-look',
      check: ({ target }) =>
        target === 'look' ? { result: 'halt', reason: 'policy:test' } : { result: 'allow' },
    };
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({
      provider: scripted([], CALL_ONE, 'done'),
      model: 'm',
      permissionChecker: checker,
    })
      .tool(recordingTool('look', ran) as never)
      .findings()
      .build();

    let caught: unknown;
    try {
      await agent.run({ message: 'which port is down?' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PolicyHaltError);
    const halt = caught as PolicyHaltError;
    // The carrier law: what the call would have run with — `callArgs`,
    // peeled — never the emission. The app is handed the arguments the policy
    // refused, not the model's declaration about them.
    expect(halt.proposed).toEqual({ name: 'look', args: { q: 'ports' } });
    expect(halt.sequence.at(-1)).toEqual({ name: 'look', args: { q: 'ports' }, iteration: 1 });
    expect(ran).toEqual([]);
    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    expect(state.policyHaltArgs).toEqual({ q: 'ports' });
    // The declaration is a fact about the emission: the basis row is filed
    // (before `tool_start`, before the gate) and history keeps the key.
    expect(ledgerOf(agent)?.map((r) => r.kind)).toEqual(['basis']);
    const emitted = halt.history.find((m) => m.role === 'assistant')?.toolCalls?.[0]?.args;
    expect(emitted).toHaveProperty(RESERVED_ARGUMENT);
  });
});

// ─── 13. a provider tool that OWNS the name keeps the author's argument ──

describe('.findings() — a provider tool that declares `_findings` itself', () => {
  it("is served undecorated, runs with the value as the author's argument, and files no row", async () => {
    const ranOwning: Record<string, unknown>[] = [];
    const ranPlain: Record<string, unknown>[] = [];
    const AUTHORS = { type: 'string', description: "the author's own flag" };
    const owning = defineTool<Record<string, unknown>, string>({
      name: 'owning',
      description: 'declares _findings itself',
      inputSchema: { type: 'object', properties: { q: { type: 'string' }, _findings: AUTHORS } },
      execute: (args) => {
        ranOwning.push(args);
        return 'own';
      },
    });
    const plain = defineTool<Record<string, unknown>, string>({
      name: 'plain',
      description: 'declares nothing',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: (args) => {
        ranPlain.push(args);
        return 'plain';
      },
    });
    const BATCH: Partial<LLMResponse> = {
      content: '',
      toolCalls: [
        { id: 'o1', name: 'owning', args: { q: 'a', _findings: 'mine' } },
        { id: 'p1', name: 'plain', args: { q: 'b', _findings: { basis: 'direct' } } },
      ],
    };
    const seen: Shot[] = [];
    const agent = Agent.create({ provider: scripted(seen, BATCH, 'done'), model: 'm' })
      .toolProvider(staticTools([owning, plain]))
      .findings()
      .build();
    const rows = await runCollecting(agent);

    // The wire: the author's property served as written (undecorated, by
    // reference); the plain tool decorated with the library's.
    const served = seen[0]!.tools;
    expect(served.find((t) => t.name === 'owning')!.inputSchema.properties).toEqual({
      q: { type: 'string' },
      _findings: AUTHORS,
    });
    expect(
      (served.find((t) => t.name === 'plain')!.inputSchema.properties as Record<string, unknown>)
        ._findings,
    ).toEqual(FINDINGS_ARGUMENT_SCHEMA);
    // Dispatch: the owner's value runs as the author's argument, unpeeled —
    // `tool_start` and `execute` both see it; the plain call is peeled.
    expect(ranOwning).toEqual([{ q: 'a', _findings: 'mine' }]);
    expect(ranPlain).toEqual([{ q: 'b' }]);
    expect(
      rows.filter((r) => r.type === 'agentfootprint.stream.tool_start').map((r) => r.payload.args),
    ).toEqual([{ q: 'a', _findings: 'mine' }, { q: 'b' }]);
    // The record: one basis row, the plain call's; nothing for the owner's.
    expect(ledgerOf(agent)).toEqual([
      { kind: 'basis', toolCallId: 'p1', toolName: 'plain', iteration: 1, basis: 'direct' },
    ]);
    expect(
      rows
        .filter((r) => r.type === 'agentfootprint.findings.declared')
        .map((r) => r.payload.toolCallId),
    ).toEqual(['p1']);
  });
});

// ─── 14. every re-ask exit quotes the emission ───────────────────────────

describe('.findings() — a re-ask exit quotes the emission, never the peeled form', () => {
  /** Refuses any key but `port` — passes only because the answer key was peeled. */
  const portParser = {
    parse: (value: unknown) => {
      const o = value as { port?: unknown };
      if (typeof o?.port !== 'string') throw new Error('port must be a string');
      if (Object.keys(o as object).some((k) => k !== 'port')) throw new Error('unknown key');
      return o as { port: string };
    },
  };

  it('evidence-recheck: the rejected draft the model is shown is the string it sent', async () => {
    const flogi = defineTool<Record<string, never>, string>({
      name: 'show_flogi',
      description: 'fabric logins for a switch',
      inputSchema: { type: 'object', properties: {} },
      execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
    });
    const CALL: Partial<LLMResponse> = {
      content: '',
      toolCalls: [{ id: 'f1', name: 'show_flogi', args: { _findings: { basis: 'direct' } } }],
    };
    // The invented value is nowhere in the tool result — the gate flags it.
    const INVENTED = JSON.stringify({
      port: '0xef0101',
      _findings: { previous: [{ toolCallId: 'f1', standing: 'open', settles: 'a second look' }] },
    });
    const GROUNDED = JSON.stringify({
      port: '0x650400',
      _findings: {
        previous: [
          {
            toolCallId: 'f1',
            standing: 'fact',
            assertions: [
              { subject: { kind: 'port', id: 'fc1/5' }, predicate: 'fcid', value: '0x650400' },
            ],
          },
        ],
      },
    });
    const seen: Shot[] = [];
    const agent = Agent.create({ provider: scripted(seen, CALL, INVENTED, GROUNDED), model: 'm' })
      .tool(flogi)
      .findings()
      .outputSchema(portParser, { retries: 0 })
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const answer = await agent.run({ message: 'which port?' });

    expect(
      rows
        .filter((r) => r.type === 'agentfootprint.agent.route_decided')
        .map((r) => r.payload.chosen),
    ).toEqual(['tool-calls', 'evidence-recheck', 'final']);
    // The schema judged the PEELED answer (it passed); the recovery the model
    // is served quotes the EMISSION, reserved key and all.
    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    expect(state.evidenceRecovery?.instruction).toContain(JSON.stringify(INVENTED));
    expect(seen[2]!.system).toContain(JSON.stringify(INVENTED));
    // The answer that STANDS is the peeled one; both answers' standings are on
    // the record, the last one current.
    expect(answer).toBe(JSON.stringify({ port: '0x650400' }));
    const standings = ledgerOf(agent)!.filter((r): r is StandingRow => r.kind === 'standing');
    expect(standings.map((r) => [r.toolCallId, r.standing, r.declaredOn])).toEqual([
      ['f1', 'open', 'answer'],
      ['f1', 'fact', 'answer'],
    ]);
  });

  it('step-nudge: the premature answer pushed into history is the string the model sent', async () => {
    const step = (name: string) =>
      defineTool<Record<string, never>, string>({
        name,
        description: `${name} tool`,
        inputSchema: { type: 'object', properties: {} },
        execute: () => `${name} ran`,
      });
    const refund = defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'Handle refunds carefully.',
      tools: [step('lookup'), step('charge'), step('export')] as never,
      steps: [
        { tool: 'lookup', note: 'find the order first' },
        { tool: 'charge', note: 'refund the charge' },
        { tool: 'export', note: 'file the receipt' },
      ],
    });
    const call = (
      name: string,
      id: string,
      args: Record<string, unknown> = {},
    ): Partial<LLMResponse> => ({ content: '', toolCalls: [{ id, name, args }] });
    const PREMATURE = JSON.stringify({
      port: 'done',
      _findings: { previous: [{ toolCallId: 't2', standing: 'noise' }] },
    });
    const agent = Agent.create({
      provider: scripted(
        [],
        call('read_skill', 't1', { id: 'refund', _findings: { basis: 'direct' } }),
        call('lookup', 't2', { _findings: { basis: 'direct' } }),
        PREMATURE, // steps 2–3 unrun: nudged, not final
        call('charge', 't3'),
        call('export', 't4'),
        JSON.stringify({ port: 'really done' }),
      ),
      model: 'm',
      maxIterations: 8,
    })
      .system('You are support.')
      .injection(refund)
      .findings()
      .outputSchema(portParser, { retries: 0 })
      .build();
    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const answer = await agent.run({ message: 'refund order 42' });

    expect(
      rows
        .filter((r) => r.type === 'agentfootprint.agent.route_decided')
        .map((r) => r.payload.chosen),
    ).toContain('step-nudge');
    // The teaching went back as the conversation: the premature answer AS
    // SENT, then the ask — the schema had judged the peeled form.
    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    const premature = state.history.find((m) => m.role === 'assistant' && m.content !== '');
    expect(premature?.content).toBe(PREMATURE);
    expect(answer).toBe(JSON.stringify({ port: 'really done' }));
    const standings = ledgerOf(agent)!.filter((r): r is StandingRow => r.kind === 'standing');
    expect(standings.map((r) => [r.toolCallId, r.standing, r.declaredOn])).toEqual([
      ['t2', 'noise', 'answer'],
    ]);
  });
});

// ─── 13. the offer: the ids the model may name (9.102.0) ─────────────────

describe('.findings() — the offer: every served schema lists the ids the model may name', () => {
  // The finding this answers (docs/design/2026-09-findings-ledger-real-model.md):
  // hosted models named results by ORDINAL ("0", "1"), recorded as `unknownId`
  // and settling nothing. So the reserved property's `previous[].toolCallId`
  // carries `enum: <the served results the model can still read — no
  // standing, fact or open; a noise or ruled-out result is a ticket and
  // leaves — newest first>`, computed at the Tools mount by
  // `findings/offer.ts · offeredResultIds` over `history` as served and the
  // ledger as it stands, bound at the ONE decoration site (`buildToolsSlot`),
  // committed as `dynamicToolSchemas`. And the rows resolve against the SAME
  // served history (`offer.ts · knownResults`), so every offered id files
  // with its toolName — whichever batch the result came from.
  const idProperty = (shot: Shot): Record<string, unknown> => {
    const look = shot.tools.find((t) => t.name === 'look')!;
    const findings = (look.inputSchema.properties as Record<string, unknown>)[
      RESERVED_ARGUMENT
    ] as { properties: { previous: { items: { properties: { toolCallId: unknown } } } } };
    return findings.properties.previous.items.properties.toolCallId as Record<string, unknown>;
  };
  const enumOf = (shot: Shot): unknown => idProperty(shot).enum;

  const CALL_THREE: Partial<LLMResponse> = {
    content: '',
    toolCalls: [{ id: 'c3', name: 'look', args: { q: 'p2', _findings: { basis: 'direct' } } }],
  };

  it('call 2 lists exactly call 1; after c1 is declared a fact it STAYS listed (revisable), so call 3 lists c2 then c1; the answer call lists all three newest first', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: scripted(seen, CALL_ONE, CALL_TWO, CALL_THREE, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', [], { required: ['q'] }) as never)
      .findings()
      .build();
    await agent.run({ message: 'which port is down?' });
    expect(seen.length).toBe(4);

    // Call 1: nothing served yet → no offer, the frozen base by value.
    expect(seen[0]!.toolIds).toEqual([]);
    expect(enumOf(seen[0]!)).toBeUndefined();
    const base = (
      seen[0]!.tools.find((t) => t.name === 'look')!.inputSchema.properties as Record<
        string,
        unknown
      >
    )[RESERVED_ARGUMENT];
    expect(base).toEqual(FINDINGS_ARGUMENT_SCHEMA);

    // Call 2: c1's result is on the wire and has no standing → the offer is
    // exactly ['c1'], and the property says what the list means.
    expect(seen[1]!.toolIds).toEqual(['c1']);
    expect(enumOf(seen[1]!)).toEqual(['c1']);
    expect(idProperty(seen[1]!).description).toContain('one of the ids listed');
    expect(idProperty(seen[1]!).description).toContain('a result not listed cannot be named');

    // Call 3: c1 was declared a fact ON call 2 (filed before c2 dispatched).
    // A fact is still served (verbatim on the wire, its assertions in the
    // piece), so it stays nameable — a later call may retire it; c2 has no
    // standing → ['c2', 'c1'], newest first.
    expect(seen[2]!.toolIds).toEqual(['c1', 'c2']);
    expect(enumOf(seen[2]!)).toEqual(['c2', 'c1']);

    // The answer call: c2 and c3 undeclared, c1 a fact → all three, NEWEST FIRST.
    expect(seen[3]!.toolIds).toEqual(['c1', 'c2', 'c3']);
    expect(enumOf(seen[3]!)).toEqual(['c3', 'c2', 'c1']);

    // The rest of the property is the base's: `required` untouched, the
    // reserved key never required, the tool's own property first.
    for (const shot of seen) {
      const look = shot.tools.find((t) => t.name === 'look')!;
      expect(Object.keys(look.inputSchema.properties as object)).toEqual(['q', RESERVED_ARGUMENT]);
      expect(look.inputSchema.required).toEqual(['q']);
    }
  });

  it('an id outside the offer still lands as unknownId — never resolved by position or by name', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: scripted(
        seen,
        { content: '', toolCalls: [{ id: 'c1', name: 'look', args: { q: 'a' } }] },
        {
          content: '',
          toolCalls: [
            {
              id: 'c2',
              name: 'look',
              args: {
                q: 'b',
                // The model counted ("0") and named the tool ("look") instead
                // of copying the offered id.
                _findings: {
                  basis: 'direct',
                  previous: [
                    { toolCallId: '0', standing: 'noise' },
                    { toolCallId: 'look', standing: 'fact' },
                  ],
                },
              },
            },
          ],
        },
        'done',
      ),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    await agent.run({ message: 'go' });

    // The offer at call 2 listed c1 and only c1: both names were outside it.
    expect(enumOf(seen[1]!)).toEqual(['c1']);
    const standings = ledgerOf(agent)!.filter((r): r is StandingRow => r.kind === 'standing');
    expect(standings.map((r) => [r.toolCallId, r.standing, r.unknownId])).toEqual([
      ['0', 'noise', true],
      ['look', 'fact', true],
    ]);
    for (const row of standings) expect(row).not.toHaveProperty('toolName');
    // c1 still has no standing, so it is still offered on the answer call —
    // the library resolved nothing on the model's behalf.
    expect(enumOf(seen[2]!)).toEqual(['c2', 'c1']);
  });

  it("the served view's tools.schemas equal the committed decorated schemas — offer included — at every epoch", async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: scripted(seen, CALL_ONE, CALL_TWO, CALL_THREE, 'p1 is down'),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    await agent.run({ message: 'which port is down?' });

    const views = servedViews(agent.getSnapshot()!);
    expect(views.map((v) => v.epoch)).toEqual([1, 2, 3, 4]);
    const expectedOffer: Record<number, readonly string[] | undefined> = {
      1: undefined,
      2: ['c1'],
      3: ['c2', 'c1'],
      4: ['c3', 'c2', 'c1'],
    };
    for (const view of views) {
      // The rebuild reads the committed `dynamicToolSchemas` — which hold the
      // offer — so it is byte-equal to the wire with no recomposition.
      expect(view.tools.schemas, `epoch ${view.epoch}`).toEqual(seen[view.epoch - 1]!.tools);
      const rebuilt: Shot = { tools: view.tools.schemas, system: undefined, toolIds: [] };
      expect(enumOf(rebuilt), `epoch ${view.epoch}`).toEqual(expectedOffer[view.epoch]);
    }
  });

  it('the offer is the SERVED history: a result the window evicted is not on it', async () => {
    const seen: Shot[] = [];
    const calls = ['c1', 'c2', 'c3', 'c4', 'c5'].map(
      (id): Partial<LLMResponse> => ({
        content: '',
        toolCalls: [{ id, name: 'look', args: { q: id, _findings: { basis: 'exploratory' } } }],
      }),
    );
    const agent = Agent.create({
      provider: scripted(seen, ...calls, 'done'),
      model: 'm',
      maxIterations: 8,
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    await agent.run({ message: 'go' });
    expect(seen.length).toBe(6);

    const last = seen[5]!;
    // The window left fewer results on the wire than were made…
    expect(last.toolIds.length).toBeLessThan(5);
    expect(last.toolIds.length).toBeGreaterThan(0);
    // …and the offer is exactly those, newest first — never an evicted id
    // the model could not see, never one more than the wire carries.
    expect(enumOf(last)).toEqual([...last.toolIds].reverse());
    expect(enumOf(last)).not.toContain('c1');
    // Every call's offer is its own wire's undeclared results, newest first.
    for (const shot of seen) {
      expect(enumOf(shot)).toEqual(
        shot.toolIds.length === 0 ? undefined : [...shot.toolIds].reverse(),
      );
    }
  });

  it('a result declared noise or ruled-out LEAVES the offer — it is a ticket on the wire, nothing left to re-judge', async () => {
    const seen: Shot[] = [];
    const callTwoNoise: Partial<LLMResponse> = {
      content: '',
      toolCalls: [
        {
          id: 'c2',
          name: 'look',
          args: {
            q: 'p1',
            _findings: { basis: 'direct', previous: [{ toolCallId: 'c1', standing: 'noise' }] },
          },
        },
      ],
    };
    const callThreeRuledOut: Partial<LLMResponse> = {
      content: '',
      toolCalls: [
        {
          id: 'c3',
          name: 'look',
          args: {
            q: 'p2',
            _findings: {
              basis: 'direct',
              previous: [{ toolCallId: 'c2', standing: 'ruled-out', line: 'p1 was up' }],
            },
          },
        },
      ],
    };
    const agent = Agent.create({
      provider: scripted(seen, CALL_ONE, callTwoNoise, callThreeRuledOut, 'done'),
      model: 'm',
    })
      .tool(recordingTool('look', []) as never)
      .findings()
      .build();
    await agent.run({ message: 'go' });
    expect(seen.map(enumOf)).toEqual([undefined, ['c1'], ['c2'], ['c3']]);
    // …and the wire agrees: the retired results are tickets, the offered one verbatim.
    const last = seen[3]!;
    expect(last.toolIds).toEqual(['c1', 'c2', 'c3']);
  });

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: EVERY id the offer lists resolves — a standing copied from the offer at call k files with its toolName and no unknownId, on a tool call and on the answer, whichever batch the result came from`, async () => {
      // The model does exactly what the enum invites: at every call it names
      // every offered id (open on the calls — so each stays listed — and fact
      // on the answer). Before 9.102.0's fix the rows resolved against the
      // LAST batch only, so an offered id from an earlier batch filed as
      // `unknownId` — the offer listed what the ledger could not identify.
      const seen: Shot[] = [];
      const offersSeen: unknown[] = [];
      let k = 0;
      const provider = mock({
        respond: (req: LLMRequest) => {
          seen.push(shotOf(req));
          const offer = (enumOf(seen[seen.length - 1]!) as readonly string[] | undefined) ?? [];
          offersSeen.push(offer.length === 0 ? undefined : offer);
          k += 1;
          if (k <= 3) {
            return {
              content: '',
              toolCalls: [
                {
                  id: `c${k}`,
                  name: 'look',
                  args: {
                    q: `p${k}`,
                    _findings: {
                      basis: 'direct',
                      previous: offer.map((toolCallId) => ({
                        toolCallId,
                        standing: 'open',
                        settles: 'a second read',
                      })),
                    },
                  },
                },
              ],
            };
          }
          return JSON.stringify({
            down: 'p1',
            _findings: {
              previous: offer.map((toolCallId) => ({
                toolCallId,
                standing: 'fact',
                assertions: [FACT_ASSERTION],
              })),
            },
          });
        },
      });
      const parser = {
        parse: (value: unknown) => {
          const keys = Object.keys(value as object).filter((key) => key !== 'down');
          if (keys.length > 0) throw new Error(`unknown keys: ${keys.join(',')}`);
          return value as { down: string };
        },
      };
      const agent = Agent.create({ provider, model: 'm', maxIterations: 8, reactMode })
        .tool(recordingTool('look', []) as never)
        .findings()
        .outputSchema(parser, { retries: 0 })
        .build();
      const typed = await agent.runTyped<{ down: string }>({ message: 'which port is down?' });
      expect(typed).toEqual({ down: 'p1' });

      // The offers: nothing, then c1, then c2+c1 (c1 still open), then all three.
      expect(offersSeen).toEqual([undefined, ['c1'], ['c2', 'c1'], ['c3', 'c2', 'c1']]);
      const standings = ledgerOf(agent)!.filter((r): r is StandingRow => r.kind === 'standing');
      // Every row resolved: a toolName from the served history, no unknownId —
      // including c1 on call 3 (two batches back) and on the answer.
      expect(standings.map((r) => [r.toolCallId, r.standing, r.toolName, r.unknownId])).toEqual([
        ['c1', 'open', 'look', undefined],
        ['c2', 'open', 'look', undefined],
        ['c1', 'open', 'look', undefined],
        ['c3', 'fact', 'look', undefined],
        ['c2', 'fact', 'look', undefined],
        ['c1', 'fact', 'look', undefined],
      ]);
      for (const row of standings) expect(row).not.toHaveProperty('unknownId');
      // The fold is the revision: open on the calls, fact on the answer — last wins.
      const standingOf = new Map(standings.map((r) => [r.toolCallId, r.standing]));
      expect([...standingOf.entries()]).toEqual([
        ['c1', 'fact'],
        ['c2', 'fact'],
        ['c3', 'fact'],
      ]);
      // Nothing was resolved by name or by position: the ids ARE the offered ids.
      const offered = new Set((offersSeen.flat() as (string | undefined)[]).filter(Boolean));
      for (const row of standings) expect(offered.has(row.toolCallId)).toBe(true);
    });
  }
});
