/**
 * Running out of action budget ends with an answer, not a fragment (9.56.0).
 *
 * THE DEFECT, from two recorded runs of the same shape: an agent hit
 * `maxIterations` mid-task and the turn's final answer was the last text
 * fragment it happened to emit before the loop stopped —
 *
 *   > "The third finding focus is not settling… Let me check what's on screen
 *   > now:"
 *
 * — delivered to the person as if it were the answer, under an `'ok'` status,
 * with nothing anywhere saying the budget had run out.
 *
 * THE FIX, and what this file pins:
 *
 *   1. one more LLM call, with the TOOLS WITHHELD, carrying one instruction;
 *   2. its answer is the turn's answer;
 *   3. the fact is on the record three ways — the committed `stoppedEarly`
 *      record (now with `wrappedUp`), `agent.budget_exhausted`, and a field on
 *      `turn_end` — and survives the recording envelope;
 *   4. a turn that never runs out of budget is byte-identical;
 *   5. `wrapUpAtMaxIterations: false` reproduces the old behaviour exactly.
 *
 * Everything here runs on the mock provider, so every assertion is
 * deterministic and no key is needed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import type { AgentState } from '../../src/core/agent/types.js';
import { WRAP_UP_INSTRUCTION } from '../../src/core/agent/stages/wrapUp.js';
import { recordRun } from '../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../src/recorders/observability/fileRecordingSink.js';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-wrap-up-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  vi.restoreAllMocks();
});

type Row = { type: string; payload: Record<string, unknown> };

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'RESULT',
} as never);

/** The fragment the defect delivered, verbatim from the recorded run. */
const FRAGMENT = "The third finding focus is not settling… Let me check what's on screen now:";
const WRAP_UP_ANSWER =
  'I checked two of the three findings and confirmed both. The third never settled, so it is ' +
  'unverified — re-run it before relying on the report.';

/**
 * One call, snapshotted.
 *
 * A SNAPSHOT and not the `LLMRequest`, deliberately: `request.messages` is the
 * live `scope.history` view (footprintjs hands recorders borrowed references),
 * so a stored request would report the END of the run at every index and this
 * whole file would assert against the same four messages three times.
 */
type Shot = {
  readonly tools: readonly string[];
  readonly messages: readonly { readonly role: string; readonly content: string }[];
};

const shotOf = (req: LLMRequest): Shot => ({
  tools: (req.tools ?? []).map((t) => t.name),
  messages: req.messages.map((m) => ({ role: m.role, content: String(m.content) })),
});

/** A provider that keeps asking for tools until the tools stop being offered. */
function neverFinishes(seen: Shot[]) {
  return mock({
    respond: (req: LLMRequest): string | Partial<LLMResponse> => {
      seen.push(shotOf(req));
      // The wrap-up call is the one with no tools on the wire — a provider
      // cannot ask for what it was not offered, which is what makes the last
      // call terminal by construction.
      if ((req.tools?.length ?? 0) === 0) return WRAP_UP_ANSWER;
      return {
        content: FRAGMENT,
        toolCalls: [{ id: `c${String(seen.length)}`, name: 'look', args: {} }],
      };
    },
  });
}

function agentThatRunsOut(seen: Shot[], opts: { wrapUp?: false } = {}): Agent {
  return Agent.create({
    provider: neverFinishes(seen),
    model: 'm',
    ...(opts.wrapUp === false && { wrapUpAtMaxIterations: false as const }),
  })
    .tool(looker as never)
    .maxIterations(2)
    .build();
}

function stoppedEarlyOf(agent: Agent): AgentState['stoppedEarly'] {
  return (agent.getLastSnapshot()?.sharedState as Pick<AgentState, 'stoppedEarly'>).stoppedEarly;
}

async function runCollecting(agent: Agent, message = 'audit the findings'): Promise<Row[]> {
  const rows: Row[] = [];
  agent.on('*', (e) => rows.push({ type: e.type, payload: e.payload as Record<string, unknown> }));
  await agent.run({ message });
  return rows;
}

// ─── 1. the wrap-up call itself ──────────────────────────────────────────

describe('the exhausted turn spends one more call, with the tools withheld', () => {
  it('offers ZERO tools on the last call — the whole reason it cannot loop', async () => {
    const seen: Shot[] = [];
    await agentThatRunsOut(seen).run({ message: 'audit the findings' });

    // 3 calls: iteration 0, iteration 1 (the cap), then the wrap-up.
    expect(seen).toHaveLength(3);
    expect(seen[0]!.tools).toEqual(['look']);
    expect(seen[1]!.tools).toEqual(['look']);
    expect(seen[2]!.tools).toEqual([]);
  });

  it('carries the instruction VERBATIM, as the last message, framework-authored', async () => {
    const seen: Shot[] = [];
    await agentThatRunsOut(seen).run({ message: 'audit the findings' });

    const last = seen[2]!.messages[seen[2]!.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe(WRAP_UP_INSTRUCTION);
    // The exact sentence, pinned here so a reword has to be deliberate.
    expect(WRAP_UP_INSTRUCTION).toBe(
      'Your action budget for this turn is exhausted. Do not request tools. ' +
        'Give your best final answer from what you have: what you completed, ' +
        'what remains undone, and anything the person should know.',
    );
  });

  it('adds ONLY the ask — the unrun turn is not replayed as an assistant message', async () => {
    const seen: Shot[] = [];
    await agentThatRunsOut(seen).run({ message: 'audit the findings' });

    // The tool-running turns round-tripped their assistant messages as they
    // always do. The turn the budget REFUSED did not run a tool, so nothing
    // round-tripped it — and the wrap-up deliberately does not put the
    // fragment back, which would invite the model to continue it.
    expect(seen[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(seen[2]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(seen[2]!.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('hands back the wrap-up answer, not the fragment — the defect, closed', async () => {
    const seen: Shot[] = [];
    const answer = await agentThatRunsOut(seen).run({ message: 'audit the findings' });
    expect(answer).toBe(WRAP_UP_ANSWER);
    expect(answer).not.toContain('Let me check');
  });

  it('asks at most ONCE — a provider that keeps asking for tools does not buy a second', async () => {
    const seen: Shot[] = [];
    // This provider ignores the withholding and asks for a tool anyway. The
    // latch, not the empty tool list, is what stops the second wrap-up.
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest): Partial<LLMResponse> => {
          seen.push(shotOf(req));
          return {
            content: FRAGMENT,
            toolCalls: [{ id: `c${String(seen.length)}`, name: 'look', args: {} }],
          };
        },
      }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await agent.run({ message: 'audit the findings' });
    expect(seen).toHaveLength(3);
  });
});

// ─── 2. the fact on the record ───────────────────────────────────────────

describe('the record says the budget ran out AND what the run did about it', () => {
  it('commits stoppedEarly with wrappedUp — answered vs answered-after-exhaustion', async () => {
    const seen: Shot[] = [];
    const agent = agentThatRunsOut(seen);
    await agent.run({ message: 'audit the findings' });

    const cut = stoppedEarlyOf(agent);
    expect(cut).toEqual({
      reason: 'max-iterations',
      iteration: 2,
      pendingToolCalls: 1,
      answerWasEmpty: false,
      wrappedUp: true,
    });
    expect(agent.stoppedEarly()).toEqual(cut);
  });

  it('emits agent.budget_exhausted ONCE, action wrapped-up', async () => {
    const rows = await runCollecting(agentThatRunsOut([]));
    const hits = rows.filter((r) => r.type === 'agentfootprint.agent.budget_exhausted');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload).toEqual({
      reason: 'max-iterations',
      iteration: 2,
      limit: 2,
      pendingToolCalls: 1,
      action: 'wrapped-up',
    });
  });

  it('still emits cost.limit_hit exactly once — one crossing, one report', async () => {
    const rows = await runCollecting(agentThatRunsOut([]));
    expect(rows.filter((r) => r.type === 'agentfootprint.cost.limit_hit')).toHaveLength(1);
  });

  it('stamps turn_end, the event a dashboard already reads for the outcome', async () => {
    const rows = await runCollecting(agentThatRunsOut([]));
    const end = rows.find((r) => r.type === 'agentfootprint.agent.turn_end');
    expect(end?.payload.finalContent).toBe(WRAP_UP_ANSWER);
    expect(end?.payload.stoppedEarly).toEqual({
      reason: 'max-iterations',
      iteration: 2,
      pendingToolCalls: 1,
      wrappedUp: true,
    });
  });

  it('routes wrap-up, then final — route_decided names the branch really taken', async () => {
    const rows = await runCollecting(agentThatRunsOut([]));
    const chosen = rows
      .filter((r) => r.type === 'agentfootprint.agent.route_decided')
      .map((r) => r.payload.chosen);
    expect(chosen).toEqual(['tool-calls', 'wrap-up', 'final']);
  });

  it('does NOT warn — the answer handed back is a real one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await agentThatRunsOut([]).run({ message: 'audit the findings' });
    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('stopped at')),
    ).toEqual([]);
  });

  it('warns when even the wrap-up comes back empty — then the answer IS a bug', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest): Partial<LLMResponse> =>
          (req.tools?.length ?? 0) === 0
            ? { content: '' }
            : { content: '', toolCalls: [{ id: 'c', name: 'look', args: {} }] },
      }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();

    const answer = await agent.run({ message: 'audit the findings' });
    expect(answer).toBe('');
    expect(stoppedEarlyOf(agent)).toMatchObject({ answerWasEmpty: true, wrappedUp: true });
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('stopped at'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('came back EMPTY');
  });
});

// ─── 3. the archive ──────────────────────────────────────────────────────

describe('the fact survives the recording envelope', () => {
  it('a written-and-reread envelope still says the turn was wrapped up', async () => {
    const agent = agentThatRunsOut([]);
    const rec = recordRun(agent);
    await agent.run({ message: 'audit the findings' });
    const directory = tempDir();
    await persistRecording(rec, {
      sink: fileRecordingSink({ directory }),
      run: { complete: true },
    });
    rec.stop();

    const files = readdirSync(directory).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const envelope = JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as {
      recording: { events: Row[] };
    };
    const exhausted = envelope.recording.events.filter(
      (e) => e.type === 'agentfootprint.agent.budget_exhausted',
    );
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.payload.action).toBe('wrapped-up');

    const end = envelope.recording.events.find((e) => e.type === 'agentfootprint.agent.turn_end');
    expect(end?.payload.stoppedEarly).toMatchObject({ wrappedUp: true });
    expect(end?.payload.finalContent).toBe(WRAP_UP_ANSWER);
  });
});

// ─── 4. the opt-out reproduces the old behaviour exactly ─────────────────

describe('wrapUpAtMaxIterations: false — the pre-9.56.0 turn, byte for byte', () => {
  it('spends no extra call and hands back the fragment', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Shot[] = [];
    const answer = await agentThatRunsOut(seen, { wrapUp: false }).run({
      message: 'audit the findings',
    });
    expect(seen).toHaveLength(2);
    expect(answer).toBe(FRAGMENT);
  });

  it('records the crossing as cut-short, with no wrappedUp on the committed record', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = agentThatRunsOut([], { wrapUp: false });
    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as Record<string, unknown> }),
    );
    await agent.run({ message: 'audit the findings' });

    const hits = rows.filter((r) => r.type === 'agentfootprint.agent.budget_exhausted');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload.action).toBe('cut-short');
    expect(stoppedEarlyOf(agent)).toEqual({
      reason: 'max-iterations',
      iteration: 2,
      pendingToolCalls: 1,
      answerWasEmpty: false,
    });
    expect(stoppedEarlyOf(agent)).not.toHaveProperty('wrappedUp');
  });

  it('mounts no WrapUp node — a branch that can never run is not on the chart', () => {
    const off = agentThatRunsOut([], { wrapUp: false });
    const on = agentThatRunsOut([]);
    const idsOf = (a: Agent): string[] =>
      JSON.stringify(a.getSpec()).match(/"wrap-up"/g) ?? ([] as string[]);
    expect(idsOf(off)).toEqual([]);
    expect(idsOf(on).length).toBeGreaterThan(0);
  });

  it('an agent with no tool surface mounts no WrapUp node either', () => {
    const toolless = Agent.create({ provider: mock({ reply: 'hi' }), model: 'm' }).build();
    expect(JSON.stringify(toolless.getSpec()).includes('"wrap-up"')).toBe(false);
  });
});

// ─── 5. a turn that never runs out is byte-identical ─────────────────────

describe('a turn that finishes inside its budget is byte-identical either way', () => {
  const script = (seen: Shot[]) =>
    mock({
      respond: (req: LLMRequest): string | Partial<LLMResponse> => {
        seen.push(shotOf(req));
        return seen.length === 1
          ? { content: '', toolCalls: [{ id: 'c1', name: 'look', args: {} }] }
          : 'Both findings check out.';
      },
    });

  const build = (seen: Shot[], wrapUp: boolean): Agent =>
    Agent.create({
      provider: script(seen),
      model: 'm',
      ...(wrapUp ? {} : { wrapUpAtMaxIterations: false as const }),
    })
      .tool(looker as never)
      .maxIterations(5)
      .build();

  it('same answer, same event sequence, same committed key set', async () => {
    const seenOn: Shot[] = [];
    const seenOff: Shot[] = [];
    const on = build(seenOn, true);
    const off = build(seenOff, false);

    const rowsOn = await runCollecting(on, 'check the findings');
    const rowsOff = await runCollecting(off, 'check the findings');

    expect(rowsOn.map((r) => r.type)).toEqual(rowsOff.map((r) => r.type));
    expect(seenOn.map((r) => r.tools.length)).toEqual(seenOff.map((r) => r.tools.length));

    const keys = (a: Agent): string[] => Object.keys(a.getLastSnapshot()?.sharedState ?? {}).sort();
    expect(keys(on)).toEqual(keys(off));
    // The whole feature is invisible: not one new committed key.
    expect(keys(on)).not.toContain('wrapUpAsked');
    expect(keys(on)).not.toContain('stoppedEarly');
  });

  it('emits no budget_exhausted and stamps no stoppedEarly on turn_end', async () => {
    const rows = await runCollecting(build([], true), 'check the findings');
    expect(rows.filter((r) => r.type === 'agentfootprint.agent.budget_exhausted')).toEqual([]);
    const end = rows.find((r) => r.type === 'agentfootprint.agent.turn_end');
    expect(end?.payload).not.toHaveProperty('stoppedEarly');
  });
});

// ─── 6. the grouped chart, where callLLM lives behind a boundary ─────────

describe("reactMode 'dynamic-grouped' — the withholding crosses the sf-llm-call boundary", () => {
  it('offers zero tools on the wrap-up call in the grouped chart too', async () => {
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: neverFinishes(seen),
      model: 'm',
      reactMode: 'dynamic-grouped',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();

    // callLLM runs INSIDE `sf-llm-call` in this shape, and a subflow only sees
    // what its inputMapper hands it — so this is the one site where the flag
    // can be silently missing while every flat-chart test still passes.
    const answer = await agent.run({ message: 'audit the findings' });
    expect(seen).toHaveLength(3);
    expect(seen[2]!.tools).toEqual([]);
    expect(answer).toBe(WRAP_UP_ANSWER);
    expect(agent.stoppedEarly()).toMatchObject({ wrappedUp: true });
  });
});

// ─── 6. the line the wrap-up does not cross ──────────────────────────────

describe('a halting costBudget is NOT wrapped up — the person capped the money', () => {
  it('cuts short, reports cut-short, and spends no extra call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Shot[] = [];
    const agent = Agent.create({
      provider: neverFinishes(seen),
      model: 'm',
      pricingTable: { pricePerToken: () => 1 },
      costBudget: { usd: 0.01, onExceed: 'halt' },
    })
      .tool(looker as never)
      .maxIterations(20)
      .build();

    const rows: Row[] = [];
    agent.on('*', (e) =>
      rows.push({ type: e.type, payload: e.payload as Record<string, unknown> }),
    );
    const answer = await agent.run({ message: 'audit the findings' });

    expect(answer).toBe(FRAGMENT);
    expect(seen.every((r) => r.tools.length === 1)).toBe(true);
    const hits = rows.filter((r) => r.type === 'agentfootprint.agent.budget_exhausted');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload).toMatchObject({ reason: 'cost-budget', action: 'cut-short' });
    // No `limit`: the run holds the cumulative SPEND, not the cap, and
    // reporting one as the other is how a number starts lying.
    expect(hits[0]!.payload).not.toHaveProperty('limit');
    expect(stoppedEarlyOf(agent)).not.toHaveProperty('wrappedUp');
  });
});
