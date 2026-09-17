/**
 * Integration — the judge on a real agent run (9.104.0, `.findings({ judge })`).
 *
 * Every test drives `Agent` end to end with the scripted mock provider and a
 * `mockClassifier`; nothing here calls a hosted classifier. What is pinned:
 *
 *   - WHEN: one classifier call per landed tool result, made BEFORE the next
 *     model call (the provider snapshots `judge.calls.length` on every call);
 *   - WHAT: a `JudgmentRow` per result on `agent.findings()`, `against:
 *     'proposition'` exactly when the call declared one, the user's message
 *     as the question, the judge's model string on the row;
 *   - the second-source law: the model's own standing and the judge's are
 *     two rows; `foldLedger` keeps them apart; the served piece reads the
 *     model's alone (policy A);
 *   - a failed call is a `JudgmentErrorRow` and the run still answers;
 *   - the events carry identities, enums and numbers — never the state;
 *   - an armed agent WITHOUT a judge makes no classifier call and files no
 *     judgment row; a non-Classifier `judge` is refused at build.
 *
 * Byte identity for the unarmed (and armed-without-judge) record is
 * `test/core/tools/byte-identity.test.ts`; the one armed-with-judge
 * reference is `agent-findings-judge` there.
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  type FindingsRow,
  type JudgmentErrorRow,
  type JudgmentRow,
} from '../../../src/index.js';
import { defineTool } from '../../../src/core/tools.js';
import { mock } from '../../../src/llm-providers.js';
import {
  ClassifierError,
  mockClassifier,
  type ClassifyRequest,
  type ClassifyResult,
} from '../../../src/classify/index.js';
import { foldLedger } from '../../../src/core/agent/findings/ledger.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMRequest, LLMResponse, PermissionChecker } from '../../../src/adapters/types.js';

type Row = { type: string; payload: Record<string, unknown> };

const verdict = (choice: string, extra: Partial<ClassifyResult> = {}): ClassifyResult => ({
  model: 'jev-1.13.0',
  answers: {
    standing: {
      type: 'choice',
      choice,
      confidence: 0.6,
      probabilities: { fact: 0.1, open: 0.1, noise: 0.7, 'ruled-out': 0.1 },
    },
    tests_subject: { type: 'noul', noul: 0.19 },
  },
  usage: { inputTokens: 100, outputTokens: 10 },
  latencyMs: 3,
  ...extra,
});

const lookup = defineTool({
  name: 'lookup',
  description: 'looks a thing up',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  execute: (args: { q?: string }) => `RESULT for ${args.q ?? ''}`,
} as never);

/** A provider that answers from a script and records, per call, how many judge calls had been made. */
function scripted(
  turns: readonly Partial<LLMResponse>[],
  judgeCallsSeen: number[],
  judge: { calls: readonly ClassifyRequest[] },
) {
  let i = 0;
  return mock({
    respond: (_req: LLMRequest) => {
      judgeCallsSeen.push(judge.calls.length);
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      return turn;
    },
  });
}

/** Two calls — the first declares a proposition, the second none — then a plain answer. */
const TWO_CALLS: readonly Partial<LLMResponse>[] = [
  {
    toolCalls: [
      {
        id: 'c1',
        name: 'lookup',
        args: {
          q: 'optic',
          _findings: { basis: 'exploratory', proposition: 'the optic was swapped' },
        },
      },
    ],
  },
  {
    toolCalls: [
      {
        id: 'c2',
        name: 'lookup',
        args: {
          q: 'port',
          _findings: {
            basis: 'direct',
            previous: [{ toolCallId: 'c1', standing: 'ruled-out', line: 'no swap' }],
          },
        },
      },
    ],
  },
  { content: 'the port is down' },
];

async function run(judge: ReturnType<typeof mockClassifier>, turns = TWO_CALLS) {
  const seen: number[] = [];
  const events: Row[] = [];
  const agent = Agent.create({
    provider: scripted(turns, seen, judge),
    model: 'mock',
    maxIterations: 6,
  })
    .tool(lookup)
    .findings({ judge })
    .build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  const answer = await agent.run({ message: 'why is fc1/7 down?' });
  return { agent, answer, seen, events, ledger: agent.findings() ?? [] };
}

describe('the judge on a run — when and what', () => {
  it('spends one classifier call per landed result, before the next model call, and files a row each', async () => {
    const judge = mockClassifier([verdict('noise'), verdict('fact')]);
    const { answer, seen, ledger } = await run(judge);
    expect(answer).toBe('the port is down');
    // Model call 1: no result yet. Call 2: c1 judged. Call 3: c1 and c2 judged.
    expect(seen).toEqual([0, 1, 2]);
    expect(judge.calls).toHaveLength(2);
    const judgments = ledger.filter((r): r is JudgmentRow => r.kind === 'judgment');
    expect(judgments.map((r) => [r.toolCallId, r.standing, r.against])).toEqual([
      ['c1', 'noise', 'proposition'],
      ['c2', 'fact', 'question'],
    ]);
    expect(judgments[0]).toMatchObject({
      toolName: 'lookup',
      source: 'judge',
      judge: { name: 'mock', model: 'jev-1.13.0' },
      confidence: 0.6,
      testsSubject: 0.19,
      usage: { inputTokens: 100, outputTokens: 10 },
      latencyMs: 3,
      iteration: 1,
    });
    expect(judgments[1]!.iteration).toBe(2);
  });

  it('asks about the RESULT for the declared proposition — or the user question — never why the tool was called', async () => {
    const judge = mockClassifier([verdict('noise'), verdict('fact')]);
    await run(judge);
    expect(judge.calls[0]!.state).toEqual({
      proposition: 'the optic was swapped',
      question: 'why is fc1/7 down?',
      tool: 'lookup',
      result: 'RESULT for optic',
    });
    // c2 declared a basis but no proposition: the question is the subject and nothing else is added.
    expect(judge.calls[1]!.state).toEqual({
      question: 'why is fc1/7 down?',
      tool: 'lookup',
      result: 'RESULT for port',
    });
    // The state carries the RESULT as the tool returned it — the peeled args never enter it.
    expect(JSON.stringify(judge.calls[0])).not.toContain('_findings');
  });

  it('the row order on the ledger: basis(c1) · judgment(c1) · standing(c1 by the model) · basis(c2) · judgment(c2)', async () => {
    const { ledger } = await run(mockClassifier([verdict('noise'), verdict('fact')]));
    expect(ledger.map((r) => `${r.kind}:${r.toolCallId}`)).toEqual([
      'basis:c1',
      'judgment:c1',
      'standing:c1',
      'basis:c2',
      'judgment:c2',
    ]);
  });
});

describe('the second-source law', () => {
  it('the model said ruled-out, the judge said noise — two rows, the fold keeps both, the piece serves the model', async () => {
    const seen: LLMRequest[] = [];
    const judge = mockClassifier([verdict('noise'), verdict('fact')]);
    let i = 0;
    const provider = mock({
      respond: (req: LLMRequest) => {
        seen.push(req);
        return TWO_CALLS[Math.min(i++, TWO_CALLS.length - 1)]!;
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
      .tool(lookup)
      .findings({ judge })
      .build();
    await agent.run({ message: 'q' });
    const fold = foldLedger(agent.findings() ?? []);
    expect(fold.standingOf.get('c1')?.standing).toBe('ruled-out');
    expect(fold.judgments.get('c1')?.standing).toBe('noise');
    // Policy A: the served piece on the answer call quotes the MODEL's ruled-out; the judge's noise
    // is nowhere on the wire.
    const system = seen[2]!.systemPrompt ?? '';
    expect(system).toContain('ruled out (lookup, tool:c1): no swap');
    expect(system).not.toMatch(/judge|0\.69|0\.7\b/);
  });
});

describe('a failed judgment', () => {
  it('files a JudgmentErrorRow with the status and the run still answers', async () => {
    const judge = mockClassifier((_req, index) => {
      if (index === 0)
        throw new ClassifierError('typesafe: HTTP 529 — overloaded', {
          status: 529,
          retryable: true,
        });
      return verdict('fact');
    });
    const { answer, ledger, events } = await run(judge);
    expect(answer).toBe('the port is down');
    const errors = ledger.filter((r): r is JudgmentErrorRow => r.kind === 'judgment-error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      toolCallId: 'c1',
      toolName: 'lookup',
      source: 'judge',
      judge: { name: 'mock' },
      status: 529,
      message: 'typesafe: HTTP 529 — overloaded',
      iteration: 1,
    });
    expect(ledger.filter((r) => r.kind === 'judgment').map((r) => r.toolCallId)).toEqual(['c2']);
    const failed = events.filter((e) => e.type === 'agentfootprint.findings.judge_failed');
    expect(failed).toHaveLength(1);
    expect(Object.keys(failed[0]!.payload).sort()).toEqual(
      ['iteration', 'latencyMs', 'status', 'toolCallId', 'toolName'].sort(),
    );
  });
});

describe('the events', () => {
  it('`findings.judged` carries identities, enums and numbers — never `agrees` (the model has no standing yet)', async () => {
    const { events } = await run(mockClassifier([verdict('noise'), verdict('fact')]));
    const judged = events.filter((e) => e.type === 'agentfootprint.findings.judged');
    expect(judged).toHaveLength(2);
    // c1 is judged before the model's standing on it exists (that lands with call 2): no `agrees`.
    expect(judged[0]!.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'lookup',
      iteration: 1,
      against: 'proposition',
      standing: 'noise',
      confidence: 0.6,
      latencyMs: 3,
      inputTokens: 100,
      outputTokens: 10,
    });
    for (const e of judged) {
      const text = JSON.stringify(e.payload);
      expect(text).not.toContain('RESULT for');
      expect(text).not.toContain('optic was swapped');
      expect(text).not.toContain('probabilities');
      expect(e.payload).not.toHaveProperty('agrees');
    }
  });

  it('`agrees` rides `findings.standing`: the model declares ruled-out on the NEXT call, the judge said noise → false; a match → true', async () => {
    // The disagreement: the judge said `noise` on c1 when it landed; the
    // model calls c1 `ruled-out` on the next call. Both readings exist at
    // the standing event, and only there.
    const disagree = await run(mockClassifier([verdict('noise'), verdict('fact')]));
    const standing = disagree.events.filter((e) => e.type === 'agentfootprint.findings.standing');
    expect(standing).toHaveLength(1);
    expect(standing[0]!.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'lookup',
      iteration: 2,
      standing: 'ruled-out',
      declaredOn: 'tool-call',
      assertionCount: 0,
      agrees: false,
    });
    expect(
      disagree.events.filter((e) => e.type === 'agentfootprint.findings.judged')[0]!.payload,
    ).not.toHaveProperty('agrees');
    // The record stays two rows — `agrees` is on no row.
    for (const row of disagree.ledger) expect(row).not.toHaveProperty('agrees');

    // The agreement: the judge said `ruled-out` too.
    const agree = await run(mockClassifier([verdict('ruled-out'), verdict('fact')]));
    const agreed = agree.events.filter((e) => e.type === 'agentfootprint.findings.standing');
    expect(agreed[0]!.payload).toMatchObject({
      toolCallId: 'c1',
      standing: 'ruled-out',
      agrees: true,
    });
  });

  it('`agrees` is absent on the standing event when the judgment failed (no judgment row) and on an unarmed run', async () => {
    const failing = mockClassifier((_req, index) => {
      if (index === 0)
        throw new ClassifierError('typesafe: HTTP 529', { status: 529, retryable: true });
      return verdict('fact');
    });
    const { events } = await run(failing);
    const standing = events.filter((e) => e.type === 'agentfootprint.findings.standing');
    expect(standing).toHaveLength(1);
    expect(standing[0]!.payload).not.toHaveProperty('agrees');

    const seen: number[] = [];
    const unarmedEvents: Row[] = [];
    const agent = Agent.create({
      provider: scripted(TWO_CALLS, seen, mockClassifier([verdict('noise')])),
      model: 'mock',
      maxIterations: 6,
    })
      .tool(lookup)
      .findings()
      .build();
    agent.on('*', (e) =>
      unarmedEvents.push({
        type: e.type,
        payload: e.payload as unknown as Record<string, unknown>,
      }),
    );
    await agent.run({ message: 'q' });
    const unarmed = unarmedEvents.filter((e) => e.type === 'agentfootprint.findings.standing');
    expect(unarmed).toHaveLength(1);
    expect(unarmed[0]!.payload).not.toHaveProperty('agrees');
  });
});

describe('only a result the TOOL produced is judged', () => {
  it('a permission-denied call gets no judgment row and no classifier call; the executed call is still judged', async () => {
    const checker: PermissionChecker = {
      name: 'deny-optic',
      check: ({ target, context }) =>
        target === 'lookup' && (context as { q?: string } | undefined)?.q === 'optic'
          ? { result: 'deny', reason: 'policy:test' }
          : { result: 'allow' },
    };
    const judge = mockClassifier([verdict('fact')]);
    const seen: number[] = [];
    const events: Row[] = [];
    const agent = Agent.create({
      provider: scripted(TWO_CALLS, seen, judge),
      model: 'mock',
      maxIterations: 6,
      permissionChecker: checker,
    })
      .tool(lookup)
      .findings({ judge })
      .build();
    agent.on('*', (e) =>
      events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const answer = await agent.run({ message: 'why is fc1/7 down?' });
    expect(answer).toBe('the port is down');
    // c1 was denied: the denial text is not a tool result — one classifier
    // call in the whole run, for c2, the call that ran.
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]!.state).toMatchObject({ tool: 'lookup', result: 'RESULT for port' });
    const ledger = agent.findings() ?? [];
    const judged = ledger.filter((r): r is JudgmentRow => r.kind === 'judgment');
    expect(judged.map((r) => r.toolCallId)).toEqual(['c2']);
    expect(ledger.some((r) => r.kind === 'judgment-error')).toBe(false);
    expect(
      events
        .filter((e) => e.type === 'agentfootprint.findings.judged')
        .map((e) => e.payload.toolCallId),
    ).toEqual(['c2']);
    // The model's own standing on the denied call is still filed — and,
    // with no judgment to compare against, carries no `agrees`.
    const standing = events.filter((e) => e.type === 'agentfootprint.findings.standing');
    expect(standing).toHaveLength(1);
    expect(standing[0]!.payload).toMatchObject({ toolCallId: 'c1', standing: 'ruled-out' });
    expect(standing[0]!.payload).not.toHaveProperty('agrees');
  });
});

describe('the resume doors', () => {
  it("a `pauseHere` tool resumed with a person's answer is judged exactly once, on the resumed call", async () => {
    const PAUSING: Partial<LLMResponse> = {
      content: '',
      toolCalls: [
        {
          id: 'p1',
          name: 'ask_person',
          args: {
            topic: 'refund',
            _findings: { basis: 'direct', proposition: 'they want a refund' },
          },
        },
      ],
    };
    const judge = mockClassifier([verdict('fact')]);
    const seen: number[] = [];
    const agent = Agent.create({
      provider: scripted([PAUSING, { content: 'all done' }], seen, judge),
      model: 'mock',
      maxIterations: 6,
    })
      .tool({
        schema: { name: 'ask_person', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'what should I tell them?' });
          return '';
        },
      })
      .findings({ judge })
      .build();
    const events: Row[] = [];
    agent.on('*', (e) =>
      events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
    );
    const paused = await agent.run({ message: 'hi' });
    if (!isPaused(paused)) return expect.fail('expected paused');
    // The tool threw out of `execute`: nothing landed, nothing was judged.
    expect(judge.calls).toHaveLength(0);
    const answer = await agent.resume(paused.checkpoint, 'tell them yes');
    expect(answer).toBe('all done');
    // The person's answer IS the tool's result by the handler's contract:
    // ONE judgment, filed through the resume door before the next model call.
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]!.state).toEqual({
      proposition: 'they want a refund',
      question: 'hi',
      tool: 'ask_person',
      result: 'tell them yes',
    });
    const judged = (agent.findings() ?? []).filter((r): r is JudgmentRow => r.kind === 'judgment');
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ toolCallId: 'p1', against: 'proposition', standing: 'fact' });
    expect(events.filter((e) => e.type === 'agentfootprint.findings.judged')).toHaveLength(1);
    // The model call after the resume saw the judgment already filed.
    expect(seen.at(-1)).toBe(1);
  });
});

describe('the gates', () => {
  it('an armed agent without a judge makes no classifier call and files no judgment row', async () => {
    const judge = mockClassifier([verdict('noise')]);
    const seen: number[] = [];
    const agent = Agent.create({
      provider: scripted(TWO_CALLS, seen, judge),
      model: 'mock',
      maxIterations: 6,
    })
      .tool(lookup)
      .findings()
      .build();
    await agent.run({ message: 'q' });
    expect(judge.calls).toHaveLength(0);
    const kinds = (agent.findings() ?? []).map((r: FindingsRow) => r.kind);
    expect(kinds).toEqual(['basis', 'standing', 'basis']);
  });

  it('a `judge` that is not a Classifier is refused at build, naming the door', () => {
    for (const bad of [
      {},
      { name: 'x' },
      { classify: () => undefined },
      { name: '', classify: () => undefined },
      'typesafe',
    ]) {
      expect(() =>
        Agent.create({ provider: mock({ respond: () => ({ content: 'x' }) }), model: 'mock' })
          .findings({ judge: bad as never })
          .build(),
      ).toThrow(/judge must be a Classifier/);
    }
  });
});
