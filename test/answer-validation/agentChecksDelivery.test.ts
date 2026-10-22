/**
 * The agent's own checks govern delivery — `answerValidation({ agentChecks })`,
 * end to end. Scripted providers that really stream, synthetic build-job and
 * order data, no I/O and no model calls.
 *
 * The red this suite started from: an agent with an ENFORCING
 * `.answerValidation()` and a `.claims()` contract handed back an answer whose
 * typed field contradicted the fact its tool settled — the claim check filed
 * its finding and the answer was delivered. The `contract:` block below pins
 * that this is still exactly what happens when `agentChecks` is not set.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  UnsupportedValuesError,
  defineTool,
  describedResult,
  type AnswerValidationOptions,
  type LLMProvider,
  type LLMRequest,
  type OutputSchemaParser,
} from '../../src/index.js';
import type { Payloads } from '../../src/events.js';
import { known } from '../../src/doors/maps.js';

type Turn = { readonly content?: string; readonly toolCalls?: readonly ToolCall[] };
type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
};

/** A provider that streams each scripted turn in two chunks; `complete()` is never used. */
function scripted(turns: readonly Turn[]) {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'agent-checks-fixture',
    complete: async () => {
      throw new Error('the stream path must be used');
    },
    stream: async function* (request) {
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      const turn = turns[requests.length - 1];
      if (turn === undefined) throw new Error('unexpected provider call');
      const content = turn.content ?? '';
      const at = Math.ceil(content.length / 2);
      if (content.length > 0) {
        yield { tokenIndex: 0, content: content.slice(0, at), done: false };
        yield { tokenIndex: 1, content: content.slice(at), done: false };
      }
      const toolCalls = [...(turn.toolCalls ?? [])];
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: {
          content,
          toolCalls,
          usage: { input: 1, output: 1 },
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
        },
      };
    },
  };
  return { provider, requests };
}

/** What a person (or a page) could receive: stream tokens and the turn's final answer. */
function delivered(agent: Agent) {
  const tokens: string[] = [];
  const ends: string[] = [];
  const findings: Payloads.IntegrityContextErrorPayload[] = [];
  const grounding: Payloads.AgentEvidenceCheckedPayload[] = [];
  agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload.content));
  agent.on('agentfootprint.agent.turn_end', (e) => ends.push(e.payload.finalContent));
  agent.on('agentfootprint.integrity.context_error', (e) => findings.push(e.payload));
  agent.on('agentfootprint.agent.evidence_checked', (e) => grounding.push(e.payload));
  return { tokens, ends, findings, grounding };
}

const REACT_MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;

// ── Build jobs: a typed claim against a settled fact ─────────────────────

interface BuildAnswer {
  readonly job: string;
  readonly durationMs: number;
}
const buildAnswer: OutputSchemaParser<BuildAnswer> = {
  parse(value) {
    const candidate = value as Partial<BuildAnswer> | null;
    if (typeof candidate?.job !== 'string' || typeof candidate.durationMs !== 'number') {
      throw new Error('job and durationMs are required');
    }
    return { job: candidate.job, durationMs: candidate.durationMs };
  },
};

function readBuild(entity = 'build-job-72') {
  return defineTool({
    name: 'read_build',
    description: 'Read one build job.',
    inputSchema: { type: 'object', properties: { job: { type: 'string' } } },
    execute: () =>
      describedResult({
        facts: [{ entity, durationMs: 1250 }],
        provenance: { source: 'synthetic-ci', measuredAt: '2026-01-01T00:00:00Z' },
      }),
  });
}

/** The host's own check — something only the app knows: which job was asked about. */
const buildReport = (
  over: Partial<AnswerValidationOptions<BuildAnswer>> = {},
): AnswerValidationOptions<BuildAnswer> => ({
  id: 'build-report',
  version: '1',
  agentChecks: ['claims'],
  validate: (answer) => ({
    checks: [
      {
        id: 'asked-job',
        disposition: answer.job === 'build-job-72' ? 'checked-pass' : 'checked-fail',
      },
    ],
  }),
  ...over,
});

function buildAgent(
  final: BuildAnswer,
  options: {
    reactMode?: (typeof REACT_MODES)[number];
    validation?: AnswerValidationOptions<BuildAnswer>;
    toolEntity?: string;
  } = {},
) {
  const answer = JSON.stringify(final);
  const source = scripted([
    { toolCalls: [{ id: 'call-1', name: 'read_build', args: { job: 'build-job-72' } }] },
    { content: answer },
  ]);
  const agent = Agent.create({
    provider: source.provider,
    model: 'synthetic',
    maxIterations: 4,
    ...(options.reactMode !== undefined && { reactMode: options.reactMode }),
  })
    .tool(readBuild(options.toolEntity))
    .outputSchema(buildAnswer)
    .claims({ durationMs: { entity: 'build-job-72', field: 'durationMs' } })
    .answerValidation<BuildAnswer>(options.validation ?? buildReport())
    .build();
  return { agent, answer, source, seen: delivered(agent) };
}

const ASK = { message: 'How long did build-job-72 take?' };

for (const reactMode of REACT_MODES) {
  describe(`functional: a typed claim governs delivery — ${reactMode}`, () => {
    it('a contradicted claim is withheld: no token, no turn_end, a failed report naming the field', async () => {
      const { agent, seen } = buildAgent({ job: 'build-job-72', durationMs: 9750 }, { reactMode });

      const outcome = await agent.run(ASK).catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(AnswerValidationError);
      const report = (outcome as AnswerValidationError).report;
      expect(report).toMatchObject({ status: 'failed', checked: 2, failed: 1, mode: 'enforce' });
      expect(report.checks).toEqual([
        { id: 'asked-job', disposition: 'checked-pass' },
        {
          id: 'agent:claims:durationMs',
          disposition: 'checked-fail',
          path: 'durationMs',
          reason: "the answer's 'durationMs' contradicts the fact 'durationMs' a tool settled",
        },
      ]);
      // Detection is unchanged: the finding is still filed, with its witnesses.
      expect(seen.findings.map((f) => f.kind)).toEqual(['unsupported-claim']);
      // Nothing of the contradicted answer reached a consumer.
      expect(seen.tokens).toEqual([]);
      expect(seen.ends).toEqual([]);
      expect(agent.answerValidation()).toEqual(report);
    });

    it('an agreeing claim is delivered unchanged, once, as the canonical JSON', async () => {
      const { agent, answer, seen } = buildAgent(
        { job: 'build-job-72', durationMs: 1250 },
        { reactMode },
      );

      expect(await agent.run(ASK)).toBe(answer);

      expect(seen.tokens).toEqual([answer]);
      expect(seen.ends).toEqual([answer]);
      expect(seen.findings).toEqual([]);
      expect(agent.answerValidation()).toMatchObject({
        status: 'passed',
        checked: 2,
        failed: 0,
        checks: [
          { id: 'asked-job', disposition: 'checked-pass' },
          { id: 'agent:claims:durationMs', disposition: 'checked-pass', path: 'durationMs' },
        ],
      });
    });
  });
}

describe('contract: defaults are unchanged — without agentChecks the claim check only records', () => {
  it('the same contradicted answer is delivered beside its finding, as before', async () => {
    const { agent, answer, seen } = buildAgent(
      { job: 'build-job-72', durationMs: 9750 },
      { validation: buildReport({ agentChecks: undefined }) },
    );

    expect(await agent.run(ASK)).toBe(answer);

    expect(seen.findings.map((f) => f.kind)).toEqual(['unsupported-claim']);
    expect(seen.tokens).toEqual([answer]);
    const report = agent.answerValidation();
    expect(report).toMatchObject({ status: 'passed', checked: 1 });
    expect(report?.checks.map((c) => c.id)).toEqual(['asked-job']);
  });
});

describe('functional: observe mode records the agent rows and still delivers', () => {
  it('a contradicted claim is delivered with a failed report to inspect', async () => {
    const { agent, answer } = buildAgent(
      { job: 'build-job-72', durationMs: 9750 },
      { validation: buildReport({ mode: 'observe' }) },
    );

    expect(await agent.run(ASK)).toBe(answer);

    expect(agent.answerValidation()).toMatchObject({
      status: 'failed',
      mode: 'observe',
      failed: 1,
    });
  });
});

describe('security: an unsupported claim fails closed', () => {
  it('a value for a fact no tool result settled is unverified, and withheld', async () => {
    // The tool settled a DIFFERENT job: nothing backs the answer's durationMs.
    const { agent, seen } = buildAgent(
      { job: 'build-job-72', durationMs: 1250 },
      { toolEntity: 'build-job-73' },
    );

    const outcome = await agent.run(ASK).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(AnswerValidationError);
    expect((outcome as AnswerValidationError).report).toMatchObject({
      status: 'unverified',
      reason: 'unreachable-checks',
    });
    expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
      id: 'agent:claims:durationMs',
      disposition: 'unreachable',
    });
    // The detector files nothing for an uncollected fact; the governed row
    // still refuses to call the answer supported.
    expect(seen.findings).toEqual([]);
    expect(seen.tokens).toEqual([]);
  });

  it('report rows never carry the answer, the tool values or the declared entity', async () => {
    const { agent } = buildAgent({ job: 'build-job-72', durationMs: 9750 });
    const outcome = (await agent
      .run(ASK)
      .catch((error: unknown) => error)) as AnswerValidationError;
    const rows = JSON.stringify(outcome.report.checks);
    expect(rows).not.toContain('9750');
    expect(rows).not.toContain('1250');
    expect(rows).not.toContain('build-job-72'); // the entity a contract may declare per user
  });

  it("a host check cannot impersonate an agent row: an 'agent:' id is refused as invalid", async () => {
    const { agent } = buildAgent(
      { job: 'build-job-72', durationMs: 9750 },
      {
        validation: buildReport({
          validate: () => ({
            checks: [{ id: 'agent:claims:durationMs', disposition: 'checked-pass' }],
          }),
        }),
      },
    );
    const outcome = await agent.run(ASK).catch((error: unknown) => error);
    expect((outcome as AnswerValidationError).report).toMatchObject({
      status: 'unverified',
      reason: 'invalid-validator-result',
    });
  });
});

// ── Orders: names and numbers from evidence, and the repair turn ──────────

interface OrderAnswer {
  readonly order: string;
  readonly total: number;
}
const orderAnswer: OutputSchemaParser<OrderAnswer> = {
  parse(value) {
    const candidate = value as Partial<OrderAnswer> | null;
    if (typeof candidate?.order !== 'string' || typeof candidate.total !== 'number') {
      throw new Error('order and total are required');
    }
    return { order: candidate.order, total: candidate.total };
  },
};
const INVENTED = JSON.stringify({ order: 'ORD-99812', total: 1200 });
const READ = JSON.stringify({ order: 'ORD-44710', total: 1200 });
const FIND_ORDER: ToolCall = { id: 'find-1', name: 'find_order', args: {} };

function orderAgent(
  turns: readonly Turn[],
  posture: 'assist' | 'guard' | 'rails',
  reactMode: (typeof REACT_MODES)[number] = 'dynamic',
  extra: { readonly mode?: 'enforce' | 'observe'; readonly findings?: true } = {},
) {
  let lookups = 0;
  const source = scripted(turns);
  const builder = Agent.create({
    provider: source.provider,
    model: 'synthetic',
    maxIterations: 6,
    reactMode,
  })
    .tool(
      defineTool({
        name: 'find_order',
        description: 'Find the order that matches the question.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          lookups++;
          return READ;
        },
      }),
    )
    .outputSchema(orderAnswer)
    .namesAndNumbersFromEvidence({ posture })
    .answerValidation<OrderAnswer>({
      id: 'orders',
      version: '1',
      ...(extra.mode !== undefined && { mode: extra.mode }),
      agentChecks: ['names-and-numbers'],
      validate: (answer) => ({
        checks: [
          { id: 'total-positive', disposition: answer.total > 0 ? 'checked-pass' : 'checked-fail' },
        ],
      }),
    });
  // The findings ledger wraps the Route decider (withFindingsAdmission): the
  // gate's verdict must still reach the validation through that wrapper.
  if (extra.findings === true) builder.findings();
  const agent = builder.build();
  return { agent, source, seen: delivered(agent), lookups: () => lookups };
}

describe('functional: an invented value is withheld (posture assist: no repair turn)', () => {
  it('fails the report on the names-and-numbers row; the model is asked nothing more', async () => {
    const { agent, source, seen } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: INVENTED }],
      'assist',
    );

    const outcome = await agent
      .run({ message: 'Which order totals 1200?' })
      .catch((e: unknown) => e);

    expect(outcome).toBeInstanceOf(AnswerValidationError);
    const report = (outcome as AnswerValidationError).report;
    // Your check passed (1), the agent's row failed (1): two comparisons.
    expect(report).toMatchObject({ status: 'failed', checked: 2, failed: 1 });
    expect(report.checks[1]).toEqual({
      id: 'agent:names-and-numbers',
      disposition: 'checked-fail',
      reason: '1 value(s) the answer states appear in no tool result the run read',
    });
    expect(seen.grounding.map((g) => g.action)).toEqual(['flagged']);
    expect(source.requests).toHaveLength(2);
    expect(seen.tokens).toEqual([]);
    expect(seen.ends).toEqual([]);
  });
});

for (const reactMode of REACT_MODES) {
  describe(`functional: the repair turn comes first (posture guard) — ${reactMode}`, () => {
    it('the model fetches during its one repair turn; the repaired answer is delivered unchanged', async () => {
      const { agent, source, seen, lookups } = orderAgent(
        [
          { toolCalls: [FIND_ORDER] },
          { content: INVENTED }, // flagged → one repair turn, tools still on the wire
          { toolCalls: [{ ...FIND_ORDER, id: 'find-2' }] }, // the repair turn calls a tool
          { content: READ },
        ],
        'guard',
        reactMode,
      );

      expect(await agent.run({ message: 'Which order totals 1200?' })).toBe(READ);

      expect(seen.grounding.map((g) => [g.action, g.afterRevision])).toEqual([
        ['revision-asked', false],
        ['grounded', true],
      ]);
      expect(source.requests).toHaveLength(4);
      expect(source.requests[2]!.tools?.map((t) => t.name)).toContain('find_order');
      expect(lookups()).toBe(2);
      // Draft tokens were held throughout: only the delivered answer streamed.
      expect(seen.tokens).toEqual([READ]);
      expect(seen.ends).toEqual([READ]);
      expect(agent.answerValidation()).toMatchObject({
        status: 'passed',
        checks: [
          { id: 'total-positive', disposition: 'checked-pass' },
          { id: 'agent:names-and-numbers', disposition: 'not-applicable' },
        ],
      });
    });
  });
}

describe('functional: a repair that keeps the invented value is withheld', () => {
  it('the row says the repair turn ran', async () => {
    const { agent, seen } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: INVENTED }, { content: INVENTED }],
      'guard',
    );
    const outcome = await agent
      .run({ message: 'Which order totals 1200?' })
      .catch((e: unknown) => e);
    expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
      id: 'agent:names-and-numbers',
      disposition: 'checked-fail',
      reason:
        '1 value(s) the answer states appear in no tool result the run read, after the one repair turn',
    });
    expect(seen.tokens).toEqual([]);
  });
});

describe('integration: both checks listed — the repair turn can save a contradicted claim', () => {
  // `durationMs: 9750` is a contradicted claim AND a number no result carried,
  // so under 'guard' the gate asks for its one repair before anything is
  // judged for delivery. What comes back is what both rows judge.
  function bothChecks(answer: BuildAnswer, repair: BuildAnswer) {
    const source = scripted([
      { toolCalls: [{ id: 'call-1', name: 'read_build', args: { job: 'build-job-72' } }] },
      { content: JSON.stringify(answer) },
      { content: JSON.stringify(repair) },
    ]);
    const agent = Agent.create({ provider: source.provider, model: 'synthetic', maxIterations: 6 })
      .tool(readBuild())
      .outputSchema(buildAnswer)
      .claims({ durationMs: { entity: 'build-job-72', field: 'durationMs' } })
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .answerValidation<BuildAnswer>(buildReport({ agentChecks: ['names-and-numbers', 'claims'] }))
      .build();
    return { agent, source, seen: delivered(agent) };
  }

  it('repaired to the settled value: delivered, every row clear', async () => {
    const read = { job: 'build-job-72', durationMs: 1250 };
    const { agent, source, seen } = bothChecks({ ...read, durationMs: 9750 }, read);

    expect(await agent.run(ASK)).toBe(JSON.stringify(read));

    expect(source.requests).toHaveLength(3);
    expect(seen.tokens).toEqual([JSON.stringify(read)]);
    expect(agent.answerValidation()?.checks.map((c) => [c.id, c.disposition])).toEqual([
      ['asked-job', 'checked-pass'],
      ['agent:names-and-numbers', 'not-applicable'],
      ['agent:claims:durationMs', 'checked-pass'],
    ]);
  });

  it('kept after the repair: withheld, both rows failing', async () => {
    const invented = { job: 'build-job-72', durationMs: 9750 };
    const { agent, seen } = bothChecks(invented, invented);

    const outcome = await agent.run(ASK).catch((error: unknown) => error);

    expect(
      (outcome as AnswerValidationError).report.checks.map((c) => [c.id, c.disposition]),
    ).toEqual([
      ['asked-job', 'checked-pass'],
      ['agent:names-and-numbers', 'checked-fail'],
      ['agent:claims:durationMs', 'checked-fail'],
    ]);
    expect(seen.tokens).toEqual([]);
    expect(seen.ends).toEqual([]);
  });
});

describe('integration: the hand-off survives every Route wrapper', () => {
  it('with .findings() armed, an invented value still FAILS the row — never unreachable', async () => {
    const { agent, seen } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: INVENTED }],
      'assist',
      'dynamic',
      { findings: true },
    );
    const outcome = await agent
      .run({ message: 'Which order totals 1200?' })
      .catch((e: unknown) => e);
    expect((outcome as AnswerValidationError).report).toMatchObject({ status: 'failed' });
    expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
      id: 'agent:names-and-numbers',
      disposition: 'checked-fail',
    });
    expect(seen.tokens).toEqual([]);
  });

  it('with .findings() armed, a grounded answer is delivered', async () => {
    const { agent } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: READ }],
      'assist',
      'dynamic',
      {
        findings: true,
      },
    );
    expect(await agent.run({ message: 'Which order totals 1200?' })).toBe(READ);
    expect(agent.answerValidation()?.checks[1]).toMatchObject({
      id: 'agent:names-and-numbers',
      disposition: 'not-applicable',
    });
  });
});

describe('functional: observe under guard repairs first, then records and delivers', () => {
  it('the kept value is delivered with a failed row naming the repair turn', async () => {
    const { agent, source, seen } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: INVENTED }, { content: INVENTED }],
      'guard',
      'dynamic',
      { mode: 'observe' },
    );
    expect(await agent.run({ message: 'Which order totals 1200?' })).toBe(INVENTED);
    expect(source.requests).toHaveLength(3);
    expect(seen.tokens).toEqual([INVENTED]);
    expect(agent.answerValidation()).toMatchObject({ mode: 'observe', status: 'failed' });
    expect(agent.answerValidation()?.checks[1]?.reason).toMatch(/after the one repair turn$/);
  });
});

// ── The delivered candidate, not the draft, is what every row judges ────

/**
 * An output schema whose parse CHANGES a value: the draft the Route decider
 * judged says what the tool said, the answer delivered says something else.
 */
function transformingAgent(
  reactMode: (typeof REACT_MODES)[number],
  check: 'names-and-numbers' | 'claims',
  transform: (answer: { order: string; total: number }) => Record<string, unknown>,
  exempt?: readonly string[],
) {
  const parser: OutputSchemaParser<Record<string, unknown>> = {
    parse(value) {
      const candidate = value as Partial<OrderAnswer> | null;
      if (typeof candidate?.order !== 'string' || typeof candidate.total !== 'number') {
        throw new Error('order and total are required');
      }
      return transform({ order: candidate.order, total: candidate.total });
    },
  };
  const source = scripted([{ toolCalls: [FIND_ORDER] }, { content: READ }]);
  const builder = Agent.create({
    provider: source.provider,
    model: 'synthetic',
    maxIterations: 4,
    reactMode,
  })
    .tool(
      defineTool({
        name: 'find_order',
        description: 'Find the order that matches the question.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          check === 'claims'
            ? describedResult({
                facts: [{ entity: 'ORD-44710', total: 1200 }],
                provenance: { source: 'synthetic-orders', measuredAt: '2026-01-01T00:00:00Z' },
              })
            : READ,
      }),
    )
    .outputSchema(parser);
  if (check === 'claims') builder.claims({ total: { entity: 'ORD-44710', field: 'total' } });
  else builder.namesAndNumbersFromEvidence(exempt !== undefined ? { exempt } : undefined);
  const agent = builder
    .answerValidation<Record<string, unknown>>({
      id: 'orders',
      version: '1',
      agentChecks: [check],
      validate: () => ({ checks: [{ id: 'shape', disposition: 'checked-pass' }] }),
    })
    .build();
  return { agent, seen: delivered(agent) };
}

for (const reactMode of REACT_MODES) {
  describe(`security: rows judge the delivered candidate, never the draft — ${reactMode}`, () => {
    const inflate = (a: { order: string; total: number }) => ({ ...a, total: a.total * 8 + 150 });

    it('names-and-numbers: a draft that read 1200, delivered as 9750 by the schema, is withheld', async () => {
      const { agent, seen } = transformingAgent(reactMode, 'names-and-numbers', inflate);
      const outcome = await agent
        .run({ message: 'Which order totals 1200?' })
        .catch((e: unknown) => e);
      expect(outcome).toBeInstanceOf(AnswerValidationError);
      expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
        id: 'agent:names-and-numbers',
        disposition: 'checked-fail',
      });
      // The draft itself was grounded: only the delivered candidate carries 9750.
      expect(seen.grounding.map((g) => g.action)).toEqual(['grounded']);
      expect(seen.tokens).toEqual([]);
    });

    it('claims: a draft that agreed, delivered contradicting by the schema, is withheld', async () => {
      const { agent, seen } = transformingAgent(reactMode, 'claims', inflate);
      const outcome = await agent
        .run({ message: 'Which order totals 1200?' })
        .catch((e: unknown) => e);
      expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
        id: 'agent:claims:total',
        disposition: 'checked-fail',
      });
      expect(seen.tokens).toEqual([]);
    });

    it('a transform that adds no value is judged as delivered, and delivered', async () => {
      const label = (a: { order: string; total: number }) => ({ ...a, currency: 'USD' });
      for (const check of ['names-and-numbers', 'claims'] as const) {
        const { agent } = transformingAgent(reactMode, check, label);
        expect(await agent.run({ message: 'Which order totals 1200?' })).toBe(
          JSON.stringify({ order: 'ORD-44710', total: 1200, currency: 'USD' }),
        );
      }
    });
  });
}

describe('functional: a value the schema adds is judged too — declare it exempt', () => {
  const tag = (a: { order: string; total: number }) => ({ ...a, source: 'crm-2024' });

  it('withheld while undeclared: no tool result and no person said crm-2024', async () => {
    const { agent } = transformingAgent('dynamic', 'names-and-numbers', tag);
    const outcome = await agent
      .run({ message: 'Which order totals 1200?' })
      .catch((e: unknown) => e);
    expect((outcome as AnswerValidationError).report.checks[1]).toMatchObject({
      id: 'agent:names-and-numbers',
      disposition: 'checked-fail',
    });
  });

  it('delivered once the app declares its own constant exempt', async () => {
    const { agent } = transformingAgent('dynamic', 'names-and-numbers', tag, ['crm-2024']);
    expect(await agent.run({ message: 'Which order totals 1200?' })).toBe(
      JSON.stringify({ order: 'ORD-44710', total: 1200, source: 'crm-2024' }),
    );
  });
});

// ── Agreement on doubt: the tool established no value, the answer gives none ──

interface StatusAnswer {
  readonly job: string;
  readonly status: string | null;
}
const statusAnswer: OutputSchemaParser<StatusAnswer> = {
  parse(value) {
    const candidate = value as Partial<StatusAnswer> | null;
    if (typeof candidate?.job !== 'string' || candidate.status === undefined) {
      throw new Error('job and status are required');
    }
    return { job: candidate.job, status: candidate.status };
  },
};

/** A tool that settles `status` — by default the literal 'unknown': it could not establish it. */
function statusAgent(mode: 'enforce' | 'observe', status: unknown = 'unknown') {
  const source = scripted([
    { toolCalls: [{ id: 'call-1', name: 'read_status', args: {} }] },
    { content: JSON.stringify({ job: 'build-job-72', status: null }) },
  ]);
  const agent = Agent.create({ provider: source.provider, model: 'synthetic', maxIterations: 4 })
    .tool(
      defineTool({
        name: 'read_status',
        description: 'Read the build status.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          describedResult({
            facts: [{ entity: 'build-job-72', status: status as never }],
            provenance: { source: 'synthetic-ci', measuredAt: '2026-01-01T00:00:00Z' },
          }),
      }),
    )
    .outputSchema(statusAnswer)
    .claims({ status: { entity: 'build-job-72', field: 'status' } })
    // No host check at all: the claim row is the only thing that could pass.
    .answerValidation<StatusAnswer>({
      id: 'status-report',
      version: '1',
      mode,
      agentChecks: ['claims'],
      validate: () => ({ checks: [] }),
    })
    .build();
  return { agent, seen: delivered(agent) };
}

describe('security: agreement on doubt is never verified support', () => {
  it("enforce withholds a null answer about a status the tool reported as 'unknown'", async () => {
    const { agent, seen } = statusAgent('enforce');
    const outcome = await agent.run({ message: 'Did build-job-72 pass?' }).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(AnswerValidationError);
    expect((outcome as AnswerValidationError).report).toMatchObject({
      status: 'unverified',
      checked: 0,
    });
    expect((outcome as AnswerValidationError).report.checks).toEqual([
      expect.objectContaining({ id: 'agent:claims:status', disposition: 'unreachable' }),
    ]);
    expect(seen.tokens).toEqual([]);
  });

  it('an absence the tool DECLARED (known(null)) is established: null agreeing with it is delivered', async () => {
    const { agent } = statusAgent('enforce', known(null, 'the job never ran'));
    expect(await agent.run({ message: 'Did build-job-72 pass?' })).toBe(
      JSON.stringify({ job: 'build-job-72', status: null }),
    );
    expect(agent.answerValidation()?.checks).toEqual([
      expect.objectContaining({ id: 'agent:claims:status', disposition: 'checked-pass' }),
    ]);
  });

  it('observe delivers it, and the answer reads "not sure" — never "known"', async () => {
    const { agent } = statusAgent('observe');
    expect(await agent.run({ message: 'Did build-job-72 pass?' })).toBe(
      JSON.stringify({ job: 'build-job-72', status: null }),
    );
    expect(agent.answerValidation()).toMatchObject({ status: 'unverified' });
    const assessed = await agent.assessment();
    expect(assessed?.assessment).not.toBe('known');
    expect(assessed?.standing).toBe('not-sure');
    expect(assessed?.support).toBeUndefined();
  });
});

describe("contract: posture 'rails' keeps its own refusal", () => {
  it('UnsupportedValuesError, as without agentChecks', async () => {
    const { agent, seen } = orderAgent(
      [{ toolCalls: [FIND_ORDER] }, { content: INVENTED }, { content: INVENTED }],
      'rails',
    );
    const outcome = await agent
      .run({ message: 'Which order totals 1200?' })
      .catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(UnsupportedValuesError);
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      reason: 'prior-refusal',
    });
    expect(seen.tokens).toEqual([]);
  });
});

describe('contract: a listed check with nothing to judge is refused at build()', () => {
  const provider = scripted([]).provider;
  const validate = () => ({ checks: [] });

  it("'claims' without a .claims() contract", () => {
    const builder = Agent.create({ provider, model: 'synthetic' })
      .outputSchema(buildAnswer)
      .answerValidation({ id: 'v', version: '1', agentChecks: ['claims'], validate });
    expect(() => builder.build()).toThrow(
      /agentChecks: \['claims'\] }\) needs a \.claims\(\) contract/,
    );
  });

  it("'names-and-numbers' without .namesAndNumbersFromEvidence()", () => {
    const builder = Agent.create({ provider, model: 'synthetic' })
      .outputSchema(buildAnswer)
      .answerValidation({ id: 'v', version: '1', agentChecks: ['names-and-numbers'], validate });
    expect(() => builder.build()).toThrow(/needs \.namesAndNumbersFromEvidence\(\)/);
  });

  it('an unknown name, at the .answerValidation() call', () => {
    expect(() =>
      Agent.create({ provider, model: 'synthetic' }).answerValidation({
        id: 'v',
        version: '1',
        agentChecks: ['schema' as never],
        validate,
      }),
    ).toThrow(/agentChecks must list 'claims' and\/or 'names-and-numbers'/);
  });
});
