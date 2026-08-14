/**
 * The evidence gate through the REAL Agent loop (9.35.0):
 * `.namesAndNumbersFromEvidence()` — the three postures, the ONE bounded
 * revision, the branch that is an ordinary turn, how it composes with
 * `.outputSchema()`'s retry branch and with `.reliability()`, and the
 * zero-delta guards that pin "no gate = byte-identical".
 *
 * Sections follow Convention 3: Functional (assist / guard / rails) ·
 * Integration (both chart shapes, composition, the loop's own brackets) ·
 * Security & containment (the answer is withheld, the correction is framed) ·
 * Edge (nothing to check, the limit that refuses a revision) · Regression
 * (zero-delta, one revision only).
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool, UnsupportedValuesError } from '../../../src/index.js';
import { EVIDENCE_CHECK_FRAME_PREFIX } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import { TOOL_RESULTS } from './fixtures/sanEvidence.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** The SAN lookup the model calls before answering. Returns real JSON. */
const flogiTool = defineTool<Record<string, never>, string>({
  name: 'show_flogi',
  description: 'fabric logins for a switch',
  inputSchema: { type: 'object', properties: {} },
  execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
});

const callFlogi = {
  content: '',
  toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }],
  stopReason: 'tool_use' as const,
};

/** Every value here IS in show_flogi's result. */
const GROUNDED_ANSWER = 'fc1/5 is logged in with FCID 0x650400 and WWPN 50:00:09:72:08:60:2a:00.';
/** The field-observed invention: neither value appears in any tool result. */
const FABRICATED_ANSWER = 'The affected array port is SHPMAXDLVAP001-FA0 with FCID 0xef0101.';

type Ev = { name: string; payload: Record<string, unknown> };

const capture = () => {
  const checks: Array<Record<string, unknown>> = [];
  const routed: Array<Record<string, unknown>> = [];
  const iterationEnds: Array<Record<string, unknown>> = [];
  const all: Ev[] = [];
  const recorder = {
    id: 'capture-evidence',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
      if (e.name === 'agentfootprint.agent.evidence_checked') checks.push(e.payload ?? {});
      if (e.name === 'agentfootprint.agent.route_decided') routed.push(e.payload ?? {});
      if (e.name === 'agentfootprint.agent.iteration_end') iterationEnds.push(e.payload ?? {});
    },
  };
  return { checks, routed, iterationEnds, all, recorder };
};

const buildAgent = (
  replies: readonly unknown[],
  gate?: Parameters<Agent['run']> extends never
    ? never
    : Parameters<ReturnType<typeof Agent.create>['namesAndNumbersFromEvidence']>[0],
  opts: { reactMode?: 'dynamic' | 'dynamic-grouped' | 'classic'; system?: string } = {},
) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    maxIterations: 8,
    ...(opts.reactMode && { reactMode: opts.reactMode }),
  })
    .system(opts.system ?? 'You are a SAN engineer.')
    .tool(flogiTool);
  if (gate !== undefined) builder = builder.namesAndNumbersFromEvidence(gate);
  const agent = builder.watch(caps.recorder).build();
  return { agent, ...caps };
};

const historyOf = (agent: Agent): readonly LLMMessage[] =>
  (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;

// ─────────────────────────────────────────────────────────────────────────
// Functional — assist: record and flag, change nothing
// ─────────────────────────────────────────────────────────────────────────

describe('functional: assist records and flags', () => {
  it('returns the answer UNCHANGED and files the verdict', async () => {
    const { agent, checks } = buildAgent([callFlogi, { content: FABRICATED_ANSWER }], {});
    const answer = await agent.run({ message: 'which array port is affected?' });

    expect(answer).toBe(FABRICATED_ANSWER);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.action).toBe('flagged');
    expect(checks[0]!.posture).toBe('assist');
    const values = (checks[0]!.unsupported as Array<{ value: string }>).map((v) => v.value);
    expect(values.sort()).toEqual(['0xef0101', 'shpmaxdlvap001-fa0']);

    const verdict = agent.unsupportedValues();
    expect(verdict?.refused).toBe(false);
    expect(verdict?.revised).toBe(false);
    expect(verdict?.posture).toBe('assist');
  });

  it('files a clean check as `grounded`, with nothing on the record', async () => {
    const { agent, checks } = buildAgent([callFlogi, { content: GROUNDED_ANSWER }], {});
    const answer = await agent.run({ message: 'what is on fc1/5?' });

    expect(answer).toBe(GROUNDED_ANSWER);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.action).toBe('grounded');
    expect(checks[0]!.unsupported).toEqual([]);
    expect(agent.unsupportedValues()).toBeUndefined();
  });

  it('never loops — assist mounts no branch', async () => {
    const { agent, routed } = buildAgent([callFlogi, { content: FABRICATED_ANSWER }], {});
    await agent.run({ message: 'which array port?' });
    expect(routed.map((r) => r.chosen)).toEqual(['tool-calls', 'final']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — guard: one bounded revision
// ─────────────────────────────────────────────────────────────────────────

describe('functional: guard corrects in the loop', () => {
  it('names the values back and accepts the corrected answer', async () => {
    const { agent, checks, routed } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: GROUNDED_ANSWER }],
      { posture: 'guard' },
    );
    const answer = await agent.run({ message: 'which array port is affected?' });

    expect(answer).toBe(GROUNDED_ANSWER);
    expect(routed.map((r) => r.chosen)).toEqual(['tool-calls', 'evidence-recheck', 'final']);
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'grounded']);
    // The second check knows it is judging a corrected answer — this is how a
    // reader tells "the revision fixed it" from "it did not".
    expect(checks[1]!.afterRevision).toBe(true);
    expect(agent.unsupportedValues()).toBeUndefined();
  });

  it('puts the failed answer AND the correction into the conversation', async () => {
    const { agent } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: GROUNDED_ANSWER }],
      { posture: 'guard' },
    );
    await agent.run({ message: 'which array port is affected?' });

    const history = historyOf(agent);
    const correction = history.find(
      (m) => m.role === 'user' && m.content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX),
    );
    expect(correction).toBeDefined();
    // Nothing else writes an answering turn into history, so a correction sent
    // alone would arrive at a model that cannot see what it said.
    const answerTurn = history.find(
      (m) => m.role === 'assistant' && m.content === FABRICATED_ANSWER,
    );
    expect(answerTurn).toBeDefined();
    expect(correction!.content).toContain('0xef0101');
    expect(correction!.content).toContain('shpmaxdlvap001-fa0');
    // It teaches rather than scolds: the honest "not collected" answer is
    // named as acceptable.
    expect(correction!.content).toContain('not collected');
  });

  it('does NOT exempt its own correction — the values stay flagged on pass two', async () => {
    // The correction is a `role: 'user'` turn that quotes the flagged values
    // back to the model, and user-supplied values are exempt. Index it and the
    // gate exempts exactly what it just challenged: pass two comes back clean,
    // `guard` congratulates a repeated fabrication and `rails` never refuses.
    // This was a real bug on the first end-to-end run; see evidence/frames.ts.
    const { agent, checks } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: FABRICATED_ANSWER }],
      { posture: 'guard' },
    );
    await agent.run({ message: 'which array port?' });

    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'flagged']);
    expect(checks[1]!.afterRevision).toBe(true);
    expect((checks[1]!.unsupported as unknown[]).length).toBe(2);
  });

  it('is ONE more ordinary turn: its own iteration bracket and budget tick', async () => {
    const { agent, iterationEnds } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: GROUNDED_ANSWER }],
      { posture: 'guard' },
    );
    await agent.run({ message: 'which array port?' });
    // tool-calls closed iteration 1, the RECHECK closed iteration 2 (the
    // bracket a recorder pairs per iterIndex), and the final turn closed 3.
    // Without the branch's own `iteration_end` the run would have one more
    // start than end and a crash checkpoint one turn behind the conversation.
    expect(iterationEnds.map((e) => e.iterIndex)).toEqual([1, 2, 3]);
  });

  it('spends the revision AT MOST once per turn', async () => {
    let calls = 0;
    const counting = {
      name: 'counting-mock',
      complete: async () => {
        calls += 1;
        const usage = { input: 0, output: 0 };
        return calls === 1
          ? { content: '', toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }], usage }
          : { content: FABRICATED_ANSWER, toolCalls: [], usage };
      },
    };
    const caps = capture();
    const agent = Agent.create({ provider: counting as never, model: 'm', maxIterations: 8 })
      .tool(flogiTool)
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .watch(caps.recorder)
      .build();

    const answer = await agent.run({ message: 'which array port?' });

    // One tool turn + one answer + exactly ONE corrected answer. A model that
    // cannot ground a value on its second try will not on its fifth, and the
    // retry storm this replaces is the failure the library exists to remove.
    expect(calls).toBe(3);
    expect(answer).toBe(FABRICATED_ANSWER);
    expect(caps.checks.map((c) => c.action)).toEqual(['revision-asked', 'flagged']);
    expect(agent.unsupportedValues()?.revised).toBe(true);
    expect(agent.unsupportedValues()?.refused).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional / security — rails: the answer is withheld
// ─────────────────────────────────────────────────────────────────────────

describe('security: rails refuses rather than returns', () => {
  it('raises UnsupportedValuesError naming the values, after one revision', async () => {
    const { agent, checks } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: FABRICATED_ANSWER }],
      { posture: 'rails' },
    );

    await expect(agent.run({ message: 'which array port?' })).rejects.toThrow(
      UnsupportedValuesError,
    );
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'refused']);
  });

  it('the error teaches: the values, that a revision was spent, and the fix', async () => {
    const { agent } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: FABRICATED_ANSWER }],
      { posture: 'rails' },
    );
    const err = await agent.run({ message: 'which array port?' }).catch((e) => e);

    expect(err).toBeInstanceOf(UnsupportedValuesError);
    expect(err.message).toContain('0xef0101');
    expect(err.message).toContain('survived the revision');
    expect(err.message).toContain('appears in a tool result');
    expect(err.values.map((v: { value: string }) => v.value).sort()).toEqual([
      '0xef0101',
      'shpmaxdlvap001-fa0',
    ]);
    expect(err.revised).toBe(true);
    // The refused answer is NOT carried out on the error — it stays in the
    // commit log under whatever redaction the run configured.
    expect(err.message).not.toContain('The affected array port is');
  });

  it('returns normally when the revision fixed it', async () => {
    const { agent } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: GROUNDED_ANSWER }],
      { posture: 'rails' },
    );
    await expect(agent.run({ message: 'which array port?' })).resolves.toBe(GROUNDED_ANSWER);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the exemptions, in a real run
// ─────────────────────────────────────────────────────────────────────────

describe('integration: values the run itself supplied are exempt', () => {
  it('a value from the USER message is not a fabrication', async () => {
    const answer = 'I found no login for SHPMAXDLVAP001-FA0 on this fabric.';
    const { agent, checks } = buildAgent([callFlogi, { content: answer }], {});
    await agent.run({ message: 'is SHPMAXDLVAP001-FA0 logged in?' });

    expect(checks[0]!.action).toBe('grounded');
    expect(await agent.run).toBeDefined();
  });

  it('the guard branch loops in the GROUPED chart too (byte-twin mounts)', async () => {
    // The two chart builders mount this branch separately; a drift between
    // them is invisible until someone runs the non-default shape.
    const { agent, checks, routed } = buildAgent(
      [callFlogi, { content: FABRICATED_ANSWER }, { content: GROUNDED_ANSWER }],
      { posture: 'guard' },
      { reactMode: 'dynamic-grouped' },
    );
    const answer = await agent.run({ message: 'which array port?' });

    expect(answer).toBe(GROUNDED_ANSWER);
    expect(routed.map((r) => r.chosen)).toEqual(['tool-calls', 'evidence-recheck', 'final']);
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'grounded']);
  });

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`a value from the SYSTEM PROMPT is not a fabrication (${reactMode})`, async () => {
      // The grouped chart composes the system prompt inside sf-llm-call, so
      // this is the test that pins the boundary mapper bubbling the records
      // back out — without it the gate flags the app's own prompt.
      const { agent, checks } = buildAgent(
        [callFlogi, { content: 'Escalate this to queue Q-4471-OPS.' }],
        {},
        { reactMode, system: 'Escalate storage faults to queue Q-4471-OPS.' },
      );
      await agent.run({ message: 'what next?' });
      expect(checks[0]!.action).toBe('grounded');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — composition
// ─────────────────────────────────────────────────────────────────────────

describe('integration: composes with the output-schema retry branch', () => {
  const parser = {
    parse: (v: unknown) => {
      const o = v as { port?: string };
      if (typeof o?.port !== 'string') throw new Error('port must be a string');
      return o;
    },
  };

  it('the schema is judged FIRST; the evidence gate judges what it let stand', async () => {
    const { agent, checks, routed } = (() => {
      const caps = capture();
      const a = Agent.create({
        provider: mock({
          replies: [
            callFlogi,
            { content: 'not json at all' }, // fails the schema → output-retry
            { content: JSON.stringify({ port: '0xef0101' }) }, // shape ok, value invented
            { content: JSON.stringify({ port: '0x650400' }) }, // grounded
          ] as never,
        }),
        model: 'mock',
        maxIterations: 8,
      })
        .system('You are a SAN engineer.')
        .tool(flogiTool)
        .outputSchema(parser, { retries: 1 })
        .namesAndNumbersFromEvidence({ posture: 'guard' })
        .watch(caps.recorder)
        .build();
      return { agent: a, ...caps };
    })();

    const answer = await agent.run({ message: 'which port?' });

    expect(routed.map((r) => r.chosen)).toEqual([
      'tool-calls',
      'output-retry', // shape first — a broken answer is replaced wholesale
      'evidence-recheck', // then grounding, on an answer the schema accepted
      'final',
    ]);
    expect(checks.map((c) => c.action)).toEqual(['revision-asked', 'grounded']);
    expect(answer).toBe(JSON.stringify({ port: '0x650400' }));
  });

  it('does not judge an answer that exhausted its schema retries', async () => {
    const { agent, checks } = (() => {
      const caps = capture();
      const a = Agent.create({
        provider: mock({ replies: [{ content: 'still not json' }] as never }),
        model: 'mock',
        maxIterations: 4,
      })
        .system('s')
        .outputSchema(parser)
        .namesAndNumbersFromEvidence({ posture: 'guard' })
        .watch(caps.recorder)
        .build();
      return { agent: a, ...caps };
    })();

    await agent.run({ message: 'which port?' });
    // The contract is already unmet and the caller is being told so; a second
    // verdict about a string nobody will use buys nothing.
    expect(checks).toEqual([]);
    expect(agent.outputContractUnmet()).toBeDefined();
  });
});

describe('integration: composes with .reliability()', () => {
  it('an in-stage retry happens first; the gate still judges the answer', async () => {
    let attempts = 0;
    const flaky = {
      name: 'flaky-mock',
      complete: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return { content: FABRICATED_ANSWER, toolCalls: [], usage: { input: 0, output: 0 } };
      },
    };
    const caps = capture();
    const agent = Agent.create({ provider: flaky as never, model: 'm', maxIterations: 4 })
      .reliability({
        postDecide: [
          {
            when: (s: { error?: unknown; attempt: number }) =>
              s.error !== undefined && s.attempt < 3,
            then: 'retry' as const,
            kind: 'retry-on-error',
          },
        ],
      })
      .namesAndNumbersFromEvidence({})
      .watch(caps.recorder)
      .build();

    const answer = await agent.run({ message: 'which array port?' });

    // Reliability governs what a CALL does before the response is committed;
    // the gate governs an answer that WAS committed. Two layers, no collision.
    expect(attempts).toBe(2);
    expect(answer).toBe(FABRICATED_ANSWER);
    expect(caps.checks.map((c) => c.action)).toEqual(['flagged']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: nothing to check, and limits that refuse a revision', () => {
  it('an answer with no data asserts nothing and is grounded by definition', async () => {
    const { agent, checks } = buildAgent(
      [{ content: 'I replaced the transceiver and the link came back.' }],
      { posture: 'rails' },
    );
    await expect(agent.run({ message: 'what did you do?' })).resolves.toContain('transceiver');
    expect(checks[0]!.candidates).toBe(0);
    expect(checks[0]!.action).toBe('grounded');
  });

  it('maxIterations cutting the turn short suppresses the revision, not the record', async () => {
    const caps = capture();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { ...callFlogi, content: FABRICATED_ANSWER },
          { ...callFlogi, content: FABRICATED_ANSWER },
        ] as never,
      }),
      model: 'mock',
      maxIterations: 1,
    })
      .system('s')
      .tool(flogiTool)
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .watch(caps.recorder)
      .build();

    await agent.run({ message: 'which array port?' });

    // A correction would spend an iteration the limit just refused, so the
    // turn goes straight to `final` — but the verdict is still filed.
    expect(caps.routed.map((r) => r.chosen)).toEqual(['final']);
    expect(caps.checks.map((c) => c.action)).toEqual(['flagged']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — zero delta when unused
// ─────────────────────────────────────────────────────────────────────────

describe('regression: an agent without the gate is byte-identical', () => {
  const runPlain = async (reactMode: 'dynamic' | 'dynamic-grouped') => {
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ replies: [callFlogi, { content: FABRICATED_ANSWER }] as never }),
      model: 'mock',
      maxIterations: 8,
      reactMode,
    })
      .system('You are a SAN engineer.')
      .tool(flogiTool)
      .watch(caps.recorder)
      .build();
    const answer = await agent.run({ message: 'which array port?' });
    return { agent, answer, ...caps };
  };

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`emits no evidence event and writes no evidence key (${reactMode})`, async () => {
      const { agent, answer, all } = await runPlain(reactMode);
      expect(answer).toBe(FABRICATED_ANSWER);
      expect(all.some((e) => e.name.includes('evidence'))).toBe(false);
      const state = agent.getLastSnapshot()!.sharedState as Record<string, unknown>;
      expect('unsupportedValues' in state).toBe(false);
      expect('evidenceUnsupported' in state).toBe(false);
      expect('evidenceRevisionSpent' in state).toBe(false);
      expect(agent.unsupportedValues()).toBeUndefined();
    });
  }

  it('mounts no branch in the chart', () => {
    const plain = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
      .system('s')
      .build();
    const gated = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
      .system('s')
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    const assist = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
      .system('s')
      .namesAndNumbersFromEvidence()
      .build();

    const ids = (a: Agent) => JSON.stringify(a.getSpec()).includes('evidence-recheck');
    expect(ids(plain)).toBe(false);
    // `'assist'` records and never loops, so it gets no branch either.
    expect(ids(assist)).toBe(false);
    expect(ids(gated)).toBe(true);
  });

  it('refuses a second gate on one agent', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .namesAndNumbersFromEvidence()
        .namesAndNumbersFromEvidence({ posture: 'guard' }),
    ).toThrow(/already set/);
  });
});
