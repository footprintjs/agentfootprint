/**
 * The inputs layer's declared sources (honesty layer 2, step 5) — WHAT THE
 * MODEL IS SERVED, and the arm without the findings ledger. Round 1 of the
 * step-5 bench fixes (`bench/inputs/runs/haiku45-step5`): the paid run showed
 * the checks right and the served text wrong — the model left `from` for the
 * person's words unwritten (the `ask` sentence told it only to include or omit
 * the value; `from` read "Optional: … Leave an argument out rather than
 * guess"), re-sent an answered period with no source, paid for `from`'s
 * explanation twice (the property and an instruction line), and paid for the
 * whole findings ledger's schema on every tool to get it.
 *
 * Test types (Convention 3):
 *   - UNIT        — the `from` property (no "Optional", what the record keeps,
 *                   every source named), first and required beside the
 *                   ledger; the sources-only decoration and its decorator;
 *                   the decoration predicate; the `ask` sentence under the arm
 *                   (and step 4's, byte for byte, without it); the answered
 *                   note's `turn` clause (never for a hidden answer); no
 *                   instruction line; the `inputsLayer` option's reader;
 *   - FUNCTIONAL  — `.inputsLayer({ argumentSources: true })`: `_findings`
 *                   with `from` alone on RULED tools only, the unruled tool
 *                   and the system prompt as a plain agent's; a quoted value
 *                   traced and run, the tool handed its arguments without
 *                   `_findings`; an untraced value asked; no basis row, the
 *                   dropped `from` entries on the first argument row; an
 *                   answer cited as `turn` on the next turn runs unasked;
 *                   `.findings()` beside it serves exactly what
 *                   `.findings({ argumentSources: true })` serves;
 *   - INTEGRATION — the choice seam peels a ruled call's `_findings` under the
 *                   sources-only arm, so a result id or a source word in
 *                   `from` is never judged as an argument value — and its
 *                   enum fence strips the decoration, so a source word never
 *                   excuses one;
 *   - SECURITY    — a hidden answer's note offers no `turn` clause; a
 *                   REGISTERED ruled tool whose author owns `_findings` is
 *                   refused at build under either sources door (a skill's
 *                   scoped tool too); an unruled one, or one without the
 *                   sources arm, keeps its argument; a ToolProvider's ruled
 *                   tool that owns it is served and run as written — the
 *                   unarmed `ask` sentence, no `turn` clause — beside a
 *                   registered ruled tool that keeps both on the same wire;
 *                   `inputsLayer` refuses what it cannot read;
 *   - PERFORMANCE — what each arm serves per request (recorded, not claimed):
 *                   the sources-only arm adds nothing to the system prompt and
 *                   nothing to an unruled tool.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  isInputPause,
  isPaused,
  type AgentOutput,
  type RunnerPauseOutcome,
  type Tool,
} from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';
import {
  ANSWERED_SOURCE_CLAUSE,
  ASK_SENTENCE,
  ASK_SOURCES_SENTENCE,
  filledNote,
  withArgumentRules,
} from '../../../../src/core/agent/arguments/serve.js';
import {
  FINDINGS_ARGUMENT_SCHEMA,
  FINDINGS_FROM_ARGUMENT_DESCRIPTION,
  FINDINGS_INSTRUCTION,
  carriesFindingsDecoration,
  findingsFromProperty,
  findingsInstructionFor,
  findingsSourcesSchema,
  withFindingsArgument,
  withSourcesArgument,
  withoutFindingsArgument,
} from '../../../../src/core/agent/findings/reserved.js';
import { readInputsLayerOption } from '../../../../src/core/agent/honesty/armed.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import { staticTools } from '../../../../src/tool-providers/index.js';

// ─── the harness ─────────────────────────────────────────────────────

type Call = { id: string; name: string; args: Record<string, unknown> };
type Reply = { content: string; toolCalls?: Call[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'sources-served-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
          stopReason: (reply.toolCalls ?? []).length > 0 ? 'tool_use' : 'end_turn',
        };
      },
    },
  };
}

const batch = (...calls: Call[]): Reply => ({ content: '', toolCalls: calls });
const answer = (content: string): Reply => ({ content });

/** A log search whose period the PERSON is asked for, with phrases on two choices. */
function askingSearch(ran: Record<string, unknown>[], extra: Partial<Tool> = {}): Tool {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: ['1h', '24h', '7d'], description: 'Look-back period.' },
      },
    },
    askOrAssume: {
      window: {
        ask: 'Which period should the error search cover?',
        choices: [
          { value: '24h', said: ['last 24 hours', 'past day'] },
          { value: '7d', said: ['last week', 'past week'] },
          '1h',
        ],
      },
    },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, window: args.window, errors: 0 };
    },
  });
  return { ...tool, ...extra } as Tool;
}

/** The same search, its period ASSUMED (`2h`). */
function assumingSearch(): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        window: { type: 'string', enum: ['1h', '2h'], description: 'Look-back period.' },
      },
    },
    askOrAssume: { window: { assume: '2h' } },
    execute: async () => ({ errors: 0 }),
  });
}

/** A tool with no rules — never decorated by the sources-only arm. */
const listServices = defineTool({
  name: 'list_services',
  description: 'Every service.',
  execute: async () => ({ services: ['checkout', 'payments'] }),
});

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');

const replyTo = (out: AgentOutput | RunnerPauseOutcome, values: Record<string, unknown>) => {
  if (!isInputPause(out)) throw new Error(`expected the library's ask, got ${JSON.stringify(out)}`);
  return { requestId: out.awaitingInput.requestId, values };
};

const stored = (out: AgentOutput | RunnerPauseOutcome) => {
  if (!isPaused(out)) throw new Error('expected a pause');
  return JSON.parse(JSON.stringify(out.checkpoint)) as RunnerPauseOutcome['checkpoint'];
};

type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  description?: string;
};
const toolOf = (req: LLMRequest, name: string) => req.tools!.find((t) => t.name === name)!;
const propertiesOf = (req: LLMRequest, name: string) =>
  toolOf(req, name).inputSchema.properties as Record<string, Record<string, unknown>>;

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── UNIT — the served text ──────────────────────────────────────────

/** The served `from` of a tool whose ruled argument is `window` (the fixtures' one rule). */
const WINDOW_FROM = findingsFromProperty(['window']);
/** The sources-only decoration of that tool. */
const WINDOW_SOURCES = findingsSourcesSchema(['window']);

describe('UNIT — `from` is explained once, positively, in its own property', () => {
  const text = JSON.stringify(WINDOW_FROM);

  it('carries no "Optional" and no "leave an argument out" — and says what the record keeps', () => {
    expect(text).not.toMatch(/optional/i);
    expect(text).not.toMatch(/leave an argument out/i);
    expect(WINDOW_FROM.description).toMatch(/one entry per value/);
    expect(WINDOW_FROM.description).toMatch(
      /a value with no entry has no declared source on the record/,
    );
    expect(Object.isFrozen(WINDOW_FROM)).toBe(true);
  });

  it('names every source the reader accepts, and no longer points at `previous[]`', () => {
    const items = WINDOW_FROM.items as Schema;
    const source = items.properties.source!;
    for (const kind of source.enum as string[]) {
      expect(source.description as string).toContain(`'${kind}'`);
    }
    expect(text).not.toContain('previous[]');
    expect(items.required).toEqual(['argument', 'source']);
  });

  it('beside the ledger, `from` comes FIRST and joins `required` — the base keeps its own shape', () => {
    const schema = {
      name: 'search_logs',
      description: 'Error lines.',
      inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    };
    const planted = (
      withFindingsArgument(schema, [], { from: ['window'] }).inputSchema.properties as any
    )._findings as Schema;
    expect(Object.keys(planted.properties)).toEqual([
      'from',
      ...Object.keys(FINDINGS_ARGUMENT_SCHEMA.properties as object),
    ]);
    expect(planted.required).toEqual(['basis', 'from']);
    expect(planted.description).toBe(FINDINGS_ARGUMENT_SCHEMA.description);
    // …with an offer too — the offer's enum still rides `previous[].toolCallId`.
    const offered = (
      withFindingsArgument(schema, ['t1'], { from: ['window'] }).inputSchema.properties as any
    )._findings as Schema;
    expect(Object.keys(offered.properties)[0]).toBe('from');
    expect(offered.required).toEqual(['basis', 'from']);
    expect((offered.properties.previous as any).items.properties.toolCallId.enum).toEqual(['t1']);
    // A tool with no `from` keeps the frozen base BY REFERENCE (the `.findings()`-only bytes).
    expect((withFindingsArgument(schema).inputSchema.properties as any)._findings).toBe(
      FINDINGS_ARGUMENT_SCHEMA,
    );
    expect(FINDINGS_ARGUMENT_SCHEMA.required).toEqual(['basis']);
  });

  it('no instruction line: `findingsInstructionFor` is the ledger’s own, with or without the gate', () => {
    expect(findingsInstructionFor({ contingent: false })).toBe(FINDINGS_INSTRUCTION);
    expect(findingsInstructionFor({ contingent: true })).not.toContain('_findings.from');
  });
});

describe('UNIT — the sources-only decoration (declared sources without the findings ledger)', () => {
  const ruled = {
    name: 'search_logs',
    description: 'Error lines.',
    inputSchema: {
      type: 'object',
      required: ['service'],
      additionalProperties: false,
      properties: { service: { type: 'string' } },
    },
  };

  it('`_findings` carries `from` alone, required, under the versioned marker', () => {
    expect(findingsSourcesSchema(['service'])).toEqual({
      type: 'object',
      description: 'Findings v1 (reserved by the agent runtime).',
      properties: { from: findingsFromProperty(['service']) },
      required: ['from'],
    });
    expect(Object.isFrozen(findingsSourcesSchema(['service']))).toBe(true);
  });

  it('`withSourcesArgument` rebuilds the schema — `required` and `additionalProperties` as the author wrote them', () => {
    const served = withSourcesArgument(ruled, ['service']);
    expect(served).not.toBe(ruled);
    expect((served.inputSchema.properties as any)._findings).toEqual(
      findingsSourcesSchema(['service']),
    );
    expect(served.inputSchema.required).toEqual(['service']);
    expect(served.inputSchema.additionalProperties).toBe(false);
    expect((ruled.inputSchema.properties as any)._findings).toBeUndefined();
  });

  it('SECURITY: an author’s own `_findings` wins — the SAME reference back', () => {
    const owned = {
      name: 'notes',
      description: 'Notes.',
      inputSchema: { type: 'object', properties: { _findings: { type: 'string' } } },
    };
    expect(withSourcesArgument(owned, ['_findings'])).toBe(owned);
    expect(carriesFindingsDecoration(owned.inputSchema)).toBe(false);
    expect(withoutFindingsArgument(owned.inputSchema)).toBe(owned.inputSchema);
  });

  it('every library decoration is recognised — also through a committed clone — and taken off for the enum fence', () => {
    const variants = [
      withFindingsArgument(ruled),
      withFindingsArgument(ruled, ['t1']),
      withFindingsArgument(ruled, [], { from: ['service'] }),
      withSourcesArgument(ruled, ['service']),
    ].map((s) => structuredClone(s).inputSchema);
    for (const input of variants) {
      expect(carriesFindingsDecoration(input)).toBe(true);
      const bare = withoutFindingsArgument(input) as { properties: Record<string, unknown> };
      expect(Object.keys(bare.properties)).toEqual(['service']);
    }
    expect(carriesFindingsDecoration(ruled.inputSchema)).toBe(false);
    expect(carriesFindingsDecoration(undefined)).toBe(false);
  });
});

describe('UNIT — where the model decides: the `ask` sentence, and the answered note', () => {
  const asking = askingSearch([]);

  it('under the arm an `ask` property names `_findings.from`; without it, step 4’s sentence byte for byte', () => {
    const armed = withArgumentRules(asking.schema, asking as never, { sources: true });
    const plain = withArgumentRules(asking.schema, asking as never);
    const off = withArgumentRules(asking.schema, asking as never, { sources: false });
    const window = (s: typeof armed) =>
      (s.inputSchema.properties as Record<string, { description: string }>).window!.description;
    expect(window(armed)).toBe(`Look-back period. ${ASK_SOURCES_SENTENCE}`);
    expect(window(plain)).toBe(`Look-back period. ${ASK_SENTENCE}`);
    expect(window(off)).toBe(window(plain));
    expect(ASK_SOURCES_SENTENCE.startsWith(ASK_SENTENCE.slice(0, -1))).toBe(true);
    expect(ASK_SOURCES_SENTENCE).toContain('quote their words');
  });

  it('an `assume` property says the same thing under the arm — its value is filled, never asked', () => {
    const tool = assumingSearch();
    const armed = withArgumentRules(tool.schema, tool as never, { sources: true });
    expect(armed).toEqual(withArgumentRules(tool.schema, tool as never));
  });

  it('under the arm an answered clause says a later call may cite the answer as `turn` — never for a hidden one', () => {
    const shown = { argument: 'window', value: '24h', hidden: false, source: 'answered' as const };
    const armed = filledNote('search_logs', [shown], { sources: true });
    expect(armed).toBe(
      '\n\n[window = "24h" in the search_logs call this result answers was chosen by the person ' +
        `when asked (the call had left it out)${ANSWERED_SOURCE_CLAUSE}.]`,
    );
    // Without the arm: step 4's note, byte for byte.
    expect(filledNote('search_logs', [shown])).toBe(
      '\n\n[window = "24h" in the search_logs call this result answers was chosen by the person ' +
        'when asked (the call had left it out).]',
    );
    // A hidden answer is 'REDACTED' on the record — a `turn` claim for it cannot be checked.
    const hidden = filledNote('search_logs', [{ ...shown, hidden: true }], { sources: true });
    expect(hidden).not.toContain(ANSWERED_SOURCE_CLAUSE);
    // An assumed fill is not the person's answer: no clause either.
    const assumed = filledNote(
      'search_logs',
      [{ argument: 'window', value: '2h', hidden: false }],
      {
        sources: true,
      },
    );
    expect(assumed).toBe(
      filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }]),
    );
  });
});

describe('UNIT — `AgentOptions.inputsLayer`, read once', () => {
  it('reads absent, `false`, `true` and the object form', () => {
    expect(readInputsLayerOption(undefined)).toBeUndefined();
    expect(readInputsLayerOption(false)).toBeUndefined();
    expect(readInputsLayerOption(true)).toEqual({});
    expect(readInputsLayerOption({})).toEqual({});
    expect(readInputsLayerOption({ argumentSources: false })).toEqual({});
    expect(readInputsLayerOption({ argumentSources: true })).toEqual({ argumentSources: true });
  });

  it('SECURITY: refuses what it cannot read, naming the value — never silently inert', () => {
    expect(() => readInputsLayerOption('yes')).toThrow(/inputsLayer must be true, false or/);
    expect(() => readInputsLayerOption(null)).toThrow(/inputsLayer must be true, false or/);
    expect(() => readInputsLayerOption([])).toThrow(/inputsLayer must be true, false or/);
    expect(() => readInputsLayerOption({ argumentSources: 'yes' })).toThrow(
      /inputsLayer\.argumentSources must be true or false, got "yes"/,
    );
    expect(() => readInputsLayerOption({ sources: true })).toThrow(/unknown key 'sources'/);
  });
});

// ─── UNIT + FUNCTIONAL — `from[].argument` is a NAME from THE TOOL'S list ──

/** A second ruled tool, two rules in declared order — `host_id` asked, `limit` assumed. */
const topTalkers = defineTool({
  name: 'top_talkers',
  description: 'The busiest ports on one host.',
  inputSchema: {
    type: 'object',
    properties: {
      host_id: { type: 'string', description: 'Host id.' },
      limit: { type: 'integer', description: 'How many ports.' },
      detail: { type: 'boolean' },
    },
  },
  askOrAssume: { host_id: { ask: 'Which host?' }, limit: { assume: 10 } },
  execute: async () => ({ ports: [] }),
});

/** The served `from[].argument` of one tool on one request. */
const argumentOf = (req: LLMRequest, name: string): Record<string, unknown> => {
  const findings = propertiesOf(req, name)._findings as unknown as Schema;
  const from = findings.properties.from as unknown as { items: Schema };
  return from.items.properties.argument!;
};

describe('`from[].argument` is an enum of the tool’s own ruled argument names (step 5, bench v2)', () => {
  it('UNIT: the enum is the list handed, in its order, with the one-line description — a copy, frozen', () => {
    const names = ['window', 'limit'];
    const built = findingsFromProperty(names);
    const argument = (built.items as Schema).properties.argument!;
    expect(argument).toEqual({
      type: 'string',
      enum: ['window', 'limit'],
      description: 'The name of the argument this entry is for.',
    });
    expect(FINDINGS_FROM_ARGUMENT_DESCRIPTION).toBe('The name of the argument this entry is for.');
    names.push('later');
    expect(argument.enum).toEqual(['window', 'limit']);
    expect(Object.isFrozen(argument.enum)).toBe(true);
    // Everything but the enum is the same bytes on every tool.
    const other = findingsFromProperty(['host_id']);
    const strip = (v: object) =>
      JSON.stringify(v, (key, value) => (key === 'argument' ? { ...value, enum: [] } : value));
    expect(strip(other)).toBe(strip(built));
  });

  it('UNIT: no ruled names plants no `from` — the base by reference, the schema by reference', () => {
    const schema = {
      name: 'x',
      description: 'X.',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
    };
    expect(
      (withFindingsArgument(schema, [], { from: [] }).inputSchema.properties as any)._findings,
    ).toBe(FINDINGS_ARGUMENT_SCHEMA);
    expect(withSourcesArgument(schema, [])).toBe(schema);
  });

  it.each([
    ['without the ledger (`.inputsLayer`)', false],
    ['beside the ledger (`.findings`)', true],
  ])(
    'FUNCTIONAL %s: each ruled tool is served ITS names; an unruled tool no `from`',
    async (_label, ledger) => {
      const m = scripted([answer('hi')]);
      let b = Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(askingSearch([]))
        .tool(topTalkers)
        .tool(listServices);
      b = ledger ? b.findings({ argumentSources: true }) : b.inputsLayer({ argumentSources: true });
      await b.build().run({ message: 'hello' });
      const req = m.requests[0]!;
      expect(argumentOf(req, 'search_logs').enum).toEqual(['window']);
      expect(argumentOf(req, 'top_talkers').enum).toEqual(['host_id', 'limit']);
      expect(argumentOf(req, 'top_talkers').description).toBe(FINDINGS_FROM_ARGUMENT_DESCRIPTION);
      const unruled = propertiesOf(req, 'list_services')._findings as unknown as Schema | undefined;
      expect(unruled?.properties?.from).toBeUndefined();
    },
  );
});

// ─── FUNCTIONAL — declared sources without the findings ledger ─────────

describe('FUNCTIONAL — `.inputsLayer({ argumentSources: true })`: `from` on ruled tools, and nothing else', () => {
  it('serves `_findings` with `from` alone on the ruled tool; the unruled tool and the system prompt are a plain agent’s', async () => {
    const serve = async (sources: boolean) => {
      const m = scripted([answer('hi')]);
      let b = Agent.create({ provider: m.provider as never, model: 'm' })
        .system('You help with logs.')
        .tool(askingSearch([]))
        .tool(listServices);
      if (sources) b = b.inputsLayer({ argumentSources: true });
      const agent = b.build();
      await agent.run({ message: 'hello' });
      return { req: m.requests[0]!, agent };
    };
    const { req, agent } = await serve(true);
    const plain = (await serve(false)).req;
    expect(propertiesOf(req, 'search_logs')._findings).toEqual(WINDOW_SOURCES);
    expect(propertiesOf(req, 'search_logs').window!.description).toBe(
      `Look-back period. ${ASK_SOURCES_SENTENCE}`,
    );
    // The unruled tool is served the bytes a plain agent serves — no `_findings` at all.
    expect(toolOf(req, 'list_services')).toEqual(toolOf(plain, 'list_services'));
    // No findings instruction, no sources line: the system prompt is a plain agent's.
    expect(req.systemPrompt).toBe(plain.systemPrompt);
    expect(req.systemPrompt ?? '').not.toContain('Findings v1');
    // The run constant says what was armed; the ledger's own constant is absent.
    const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
    // (+ `results: true`, honesty step 7b: search_logs declares a ToolPeriod.)
    expect(state.honestyLayers).toEqual({ inputs: true, argumentSources: true, results: true });
    expect(state.findingsServe).toBeUndefined();
  });

  it('a quoted value is traced and runs; the tool is handed its arguments WITHOUT `_findings`; no basis row is filed', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          // A model may still write a basis — without the ledger nothing files it.
          _findings: {
            basis: 'direct',
            from: [{ argument: 'window', source: 'user', quote: 'over the last week' }],
          },
        },
      }),
      answer('No errors.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .inputsLayer({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'Any errors on checkout over the last week?' });
    expect(out).toBe('No errors.');
    expect(ran).toEqual([{ service: 'checkout', window: '7d' }]);
    const ledger = agent.findings() ?? [];
    // (+ the results layer's `period` row, honesty step 7b: a ToolPeriod tool.)
    expect(ledger.map((r) => r.kind)).toEqual(['argument', 'period']);
    expect(argumentRows(agent)[0]).toMatchObject({
      source: 'said',
      claimed: 'user',
      matched: 'phrase',
      quote: 'over the last week',
    });
    // No argument reason fires; the one left is honesty step 7b's
    // `period-undeclared` (a ToolPeriod tool whose result declares no period).
    expect((await agent.assessment())?.reasons.map((r) => r.reason)).toEqual(['period-undeclared']);
  });

  it('an untraced value is asked, exactly as under the ledger’s door', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout', window: '24h' } }),
      answer('No errors in the last hour.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .inputsLayer({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Any errors on checkout?' });
    expect(ran).toEqual([]);
    expect(argumentRows(agent)).toEqual([
      expect.objectContaining({ asked: 'unverified', proposed: '24h', claimed: 'none' }),
    ]);
    const done = await agent.resume(stored(paused), replyTo(paused, { f1: '1h' }));
    expect(done).toBe('No errors in the last hour.');
    expect(ran).toEqual([{ service: 'checkout', window: '1h' }]);
  });

  it('the dropped `from` entries ride the first argument row — even when the call declared a basis', async () => {
    const m = scripted([
      batch({
        id: 'c1',
        name: 'search_logs',
        args: {
          service: 'checkout',
          window: '7d',
          _findings: {
            basis: 'direct',
            from: [
              { argument: 'window', source: 'user', quote: 'the last week' },
              { argument: 'window', source: 'assumed' }, // a second entry for one argument
              { argument: 'nope', source: 'app' }, // not an argument of the call
            ],
          },
        },
      }),
      answer('ok'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .inputsLayer({ argumentSources: true })
      .build();
    await agent.run({ message: 'errors on checkout over the last week?' });
    expect(argumentRows(agent)[0]).toMatchObject({ source: 'said', malformed: 2 });
  });

  it('an answer the person gave when asked is cited as `turn` on the next turn: traced, run, not asked again', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('No errors on checkout.'),
      batch({
        id: 'c2',
        name: 'search_logs',
        args: {
          service: 'payments',
          window: '24h',
          _findings: { from: [{ argument: 'window', source: 'turn' }] },
        },
      }),
      answer('No errors on payments.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch(ran))
      .inputsLayer({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Any errors on checkout?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    // The note on turn 1's result says the answer may be cited — the model reads it on turn 2.
    const note = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(note.content).toContain(`(the call had left it out)${ANSWERED_SOURCE_CLAUSE}.]`);
    const second = await agent.followUp('And on payments?');
    expect(second).toBe('No errors on payments.');
    expect(ran).toEqual([
      { service: 'checkout', window: '24h' },
      { service: 'payments', window: '24h' },
    ]);
    const turn2 = argumentRows(agent).filter((r) => r.turn === 2);
    expect(turn2).toEqual([
      expect.objectContaining({ source: 'answered', claimed: 'turn', earlier: true }),
    ]);
    expect(turn2[0]!.asked).toBeUndefined();
  });

  it('one owner of the arm: `.findings()` + `.inputsLayer({ argumentSources: true })` serves exactly what `.findings({ argumentSources: true })` serves', async () => {
    const serve = async (spelling: 'one-door' | 'two-doors') => {
      const m = scripted([answer('hi')]);
      const base = Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(askingSearch([]))
        .tool(listServices);
      const agent =
        spelling === 'one-door'
          ? base.findings({ argumentSources: true }).build()
          : base.findings().inputsLayer({ argumentSources: true }).build();
      await agent.run({ message: 'hello' });
      const req = m.requests[0]!;
      return { tools: req.tools, system: req.systemPrompt };
    };
    expect(await serve('two-doors')).toEqual(await serve('one-door'));
  });

  it('`.inputsLayer()` without the option serves step 4’s sentence — declared sources stay off', async () => {
    const m = scripted([answer('hi')]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .inputsLayer()
      .build();
    await agent.run({ message: 'hello' });
    const req = m.requests[0]!;
    expect(propertiesOf(req, 'search_logs').window!.description).toBe(
      `Look-back period. ${ASK_SENTENCE}`,
    );
    expect(propertiesOf(req, 'search_logs')._findings).toBeUndefined();
    const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
    // (+ `results: true`, honesty step 7b: search_logs declares a ToolPeriod.)
    expect(state.honestyLayers).toEqual({ inputs: true, results: true });
  });

  it('SECURITY: the builder door refuses what it cannot read', () => {
    const m = scripted([answer('hi')]);
    const b = () =>
      Agent.create({ provider: m.provider as never, model: 'm' }).tool(askingSearch([]));
    expect(() => b().inputsLayer({ argumentSources: 'yes' as never })).toThrow(
      /inputsLayer: argumentSources must be true or false/,
    );
    expect(() => b().inputsLayer(null as never)).toThrow(/expected an options object or nothing/);
    expect(() => b().inputsLayer({ argumentSources: true }).inputsLayer()).toThrow(/already set/);
    // The option form, handed to `Agent.create` directly, is read by the same reader —
    // also when the builder's door is called beside it (never silently replaced).
    const withOption = (inputsLayer: unknown) =>
      Agent.create({
        provider: m.provider as never,
        model: 'm',
        inputsLayer: inputsLayer as never,
      }).tool(askingSearch([]));
    expect(() => withOption({ argumentSources: 'yes' }).build()).toThrow(
      /inputsLayer\.argumentSources must be true or false/,
    );
    expect(() => withOption({ argumentSources: 'yes' }).inputsLayer().build()).toThrow(
      /inputsLayer\.argumentSources must be true or false/,
    );
  });

  it('the door MERGES with an `inputsLayer` option: sources armed by either stay armed', async () => {
    const m = scripted([answer('hi')]);
    const agent = Agent.create({
      provider: m.provider as never,
      model: 'm',
      inputsLayer: { argumentSources: true },
    })
      .tool(askingSearch([]))
      .inputsLayer()
      .build();
    await agent.run({ message: 'hello' });
    expect(propertiesOf(m.requests[0]!, 'search_logs')._findings).toEqual(WINDOW_SOURCES);
    const state = agent.getSnapshot()!.sharedState as Record<string, unknown>;
    // (+ `results: true`, honesty step 7b: search_logs declares a ToolPeriod.)
    expect(state.honestyLayers).toEqual({ inputs: true, argumentSources: true, results: true });
  });
});

// ─── INTEGRATION — the choice seam ─────────────────────────────────────

describe('INTEGRATION — the choice seam reads a ruled call’s arguments without its `_findings`', () => {
  const listHosts = () =>
    defineTool({
      name: 'list_hosts',
      description: 'Hosts of one service.',
      inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
      execute: async () => ({ hosts: ['srv-4417', 'srv-2210'] }),
    });
  /** A ruled flows tool whose arguments come from `list_hosts` — the choice seam's subject. */
  const flows = () =>
    defineTool({
      name: 'net_flows',
      description: 'Flows for one host.',
      inputSchema: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          range: { type: 'string', enum: ['-1h', '-24h', '-7d'] },
        },
      },
      askOrAssume: {
        range: {
          ask: 'Which period should the flow search cover?',
          choices: [{ value: '-24h', said: ['past day'] }, '-1h', '-7d'],
        },
      },
      period: { argument: 'range', spelling: 'signed-lookback' },
      argumentsFrom: ['list_hosts'],
      execute: async (args: Record<string, unknown>) => ({ host: args.host, flows: 3 }),
    } as never) as Tool;
  const runFlows = async (host: string) => {
    const m = scripted([
      batch({ id: 'lookup-hosts-1', name: 'list_hosts', args: { service: 'checkout' } }),
      batch({
        id: 'flows-2',
        name: 'net_flows',
        args: {
          host,
          range: '-24h',
          _findings: {
            from: [
              { argument: 'host', source: 'result', id: 'lookup-hosts-1' },
              { argument: 'range', source: 'user', quote: 'past day' },
            ],
          },
        },
      }),
      answer('3 flows.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(listHosts())
      .tool(flows())
      .inputsLayer({ argumentSources: true })
      .build();
    const errors: Array<Record<string, unknown>> = [];
    agent.on('agentfootprint.integrity.context_error', (e) =>
      errors.push(e.payload as unknown as Record<string, unknown>),
    );
    const out = await agent.run({ message: 'Flows on the checkout host over the past day?' });
    return { agent, out, unsupported: errors.filter((e) => e.kind === 'unsupported-argument') };
  };

  it('a result id and the source words in `from` are never judged as argument values', async () => {
    const { agent, out, unsupported } = await runFlows('srv-4417');
    expect(out).toBe('3 flows.');
    expect(unsupported).toEqual([]);
    // The ruled argument's row, then the free one a `from` entry named.
    expect(argumentRows(agent).map((r) => [r.argument, r.source])).toEqual([
      ['range', 'said'],
      ['host', 'result'],
    ]);
  });

  it('the declaration’s own vocabulary never excuses an argument value (the enum fence reads the schema without it)', async () => {
    // `assumed` is one of `from`'s source words — never a value the run served for `host`.
    const { unsupported } = await runFlows('assumed');
    expect(unsupported).toHaveLength(1);
    expect(String(unsupported[0]!.message)).toContain('assumed');
  });
});

// ─── SECURITY ─────────────────────────────────────────────────────────

describe('SECURITY — the author’s `_findings` and a hidden answer', () => {
  /** A ruled tool whose AUTHOR declares an argument named `_findings` — the reserved name. */
  const owningTool = (ran: Record<string, unknown>[] = []): Tool =>
    defineTool({
      name: 'annotate',
      description: 'Adds a note for one service over a period.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          window: { type: 'string', enum: ['1h', '24h', '7d'], description: 'Look-back period.' },
          _findings: { type: 'string', description: 'The author’s own note.' },
        },
      },
      askOrAssume: {
        window: { ask: 'Which period should the note cover?', choices: ['1h', '24h', '7d'] },
      },
      execute: async (args) => {
        ran.push({ ...args });
        return 'noted';
      },
    });
  const refusedBySources =
    /tool 'annotate' declares the reserved argument '_findings' — with declared sources \(argumentSources: true\)/;

  it('a REGISTERED ruled tool whose author owns `_findings` is refused at build under the sources-only door, naming the tool', () => {
    // Served, it would read "…quote their words for it in `_findings.from`" beside the author's
    // own `_findings` — and the model's declaration would run as the author's argument.
    const m = scripted([answer('hi')]);
    const create = (options: Record<string, unknown> = {}) =>
      Agent.create({ provider: m.provider as never, model: 'm', ...options });
    expect(() =>
      create().tool(owningTool()).inputsLayer({ argumentSources: true }).build(),
    ).toThrow(refusedBySources);
    // The option form of the same door.
    expect(() =>
      create({ inputsLayer: { argumentSources: true } })
        .tool(owningTool())
        .build(),
    ).toThrow(refusedBySources);
    // A skill's SCOPED tool is decorated when its skill is active — it is not on the static list,
    // and it is refused all the same.
    const notes = defineSkill({
      id: 'notes',
      description: 'Service notes.',
      body: 'Note what the person says.',
      tools: [owningTool()] as never,
      autoActivate: 'currentSkill',
    });
    expect(() => create().skill(notes).inputsLayer({ argumentSources: true }).build()).toThrow(
      refusedBySources,
    );
    // The ledger's door refuses it too — by the ledger's own refusal: it decorates every tool.
    expect(() => create().tool(owningTool()).findings({ argumentSources: true }).build()).toThrow(
      /tool 'annotate' declares the reserved argument '_findings' — with \.findings\(\)/,
    );
  });

  it('nothing plants `_findings` on the tool, so the author keeps it: the layer without sources, or an UNRULED tool under them', async () => {
    const m = scripted([answer('hi')]);
    const create = () => Agent.create({ provider: m.provider as never, model: 'm' });
    expect(() => create().tool(owningTool()).inputsLayer().build()).not.toThrow();
    const jot = defineTool({
      name: 'jot',
      description: 'Jots a line.',
      inputSchema: {
        type: 'object',
        properties: { _findings: { type: 'string', description: 'The author’s own line.' } },
      },
      execute: async () => 'ok',
    });
    const agent = create()
      .tool(askingSearch([]))
      .tool(jot)
      .inputsLayer({ argumentSources: true })
      .build();
    await agent.run({ message: 'hello' });
    expect(propertiesOf(m.requests[0]!, 'jot')._findings).toEqual({
      type: 'string',
      description: 'The author’s own line.',
    });
  });

  it('a ToolProvider’s ruled tool whose author owns `_findings` is served and run as written: the unarmed `ask` sentence, no `turn` clause', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({ id: 'c1', name: 'annotate', args: { service: 'checkout', _findings: 'mine' } }),
      answer('Noted.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(askingSearch([]))
      .toolProvider(staticTools([owningTool(ran)]))
      .inputsLayer({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Note that checkout is fine.' });
    const first = m.requests[0]!;
    // Served as its author wrote it — the author's `_findings`, and a sentence that names no
    // `_findings.from` — while the registered ruled tool beside it on the SAME wire keeps the
    // armed sentence and the decoration: the choice is per tool.
    expect(propertiesOf(first, 'annotate')._findings).toEqual({
      type: 'string',
      description: 'The author’s own note.',
    });
    expect(propertiesOf(first, 'annotate').window!.description).toBe(
      `Look-back period. ${ASK_SENTENCE}`,
    );
    expect(propertiesOf(first, 'search_logs').window!.description).toBe(
      `Look-back period. ${ASK_SOURCES_SENTENCE}`,
    );
    expect(propertiesOf(first, 'search_logs')._findings).toEqual(WINDOW_SOURCES);
    await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    // Run as written: the value is the author's argument, never peeled, and nothing was declared.
    expect(ran).toEqual([{ service: 'checkout', window: '24h', _findings: 'mine' }]);
    expect(argumentRows(agent).map((r) => [r.asked ?? r.source, r.claimed])).toEqual([
      ['missing', undefined],
      ['answered', undefined],
    ]);
    // The answered note is step 4's: that tool carries no `_findings.from` to cite the answer in.
    const message = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    expect(message.content).toContain(
      'window = "24h" in the annotate call this result answers was chosen by the person when ' +
        'asked (the call had left it out).]',
    );
    expect(message.content).not.toContain(ANSWERED_SOURCE_CLAUSE);
  });

  it('…and a value that tool’s call carries runs as sent, filed `model` — it had nowhere to declare a source, so it is not asked about', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = scripted([
      batch({
        id: 'c1',
        name: 'annotate',
        args: { service: 'checkout', window: '7d', _findings: 'mine' },
      }),
      answer('Noted.'),
    ]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .toolProvider(staticTools([owningTool(ran)]))
      .inputsLayer({ argumentSources: true })
      .build();
    const out = await agent.run({ message: 'Note that checkout is fine.' });
    expect(out).toBe('Noted.');
    expect(ran).toEqual([{ service: 'checkout', window: '7d', _findings: 'mine' }]);
    expect(argumentRows(agent)).toEqual([
      expect.objectContaining({ argument: 'window', source: 'model' }),
    ]);
    expect(argumentRows(agent)[0]!.claimed).toBeUndefined();
  });

  it('a hidden answer’s note offers no `turn` clause — the record keeps no value to check it against', async () => {
    const m = scripted([
      batch({ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }),
      answer('ok'),
    ]);
    const hiding = askingSearch([], {
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as never);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(hiding)
      .inputsLayer({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Any errors on checkout?' });
    await agent.resume(stored(paused), replyTo(paused, { f1: '24h' }));
    const message = m.requests[1]!.messages.find((msg) => msg.role === 'tool')!;
    // The library's note, after the tool's own bytes (which the tool itself chose to echo).
    const note = message.content.slice(message.content.indexOf('\n\n['));
    expect(note).toContain('hidden by the tool');
    expect(note).not.toContain(ANSWERED_SOURCE_CLAUSE);
    expect(note).not.toContain('24h');
  });
});

// ─── PERFORMANCE ──────────────────────────────────────────────────────

describe('PERFORMANCE — what each arm serves per request (recorded, not claimed)', () => {
  it('the sources-only arm adds `_findings.from` to the ruled tool and nothing else', async () => {
    const serve = async (arm: 'plain' | 'sources-only' | 'ledger' | 'ledger+sources') => {
      const m = scripted([answer('hi')]);
      let b = Agent.create({ provider: m.provider as never, model: 'm' })
        .tool(askingSearch([]))
        .tool(listServices);
      if (arm === 'sources-only') b = b.inputsLayer({ argumentSources: true });
      if (arm === 'ledger') b = b.findings();
      if (arm === 'ledger+sources') b = b.findings({ argumentSources: true });
      await b.build().run({ message: 'hello' });
      const req = m.requests[0]!;
      return {
        system: (req.systemPrompt ?? '').length,
        ruled: JSON.stringify(toolOf(req, 'search_logs')).length,
        unruled: JSON.stringify(toolOf(req, 'list_services')).length,
      };
    };
    const plain = await serve('plain');
    const sources = await serve('sources-only');
    const ledger = await serve('ledger');
    const both = await serve('ledger+sources');
    // eslint-disable-next-line no-console
    console.log(
      `[declared sources] served chars per request — ruled tool: plain ${plain.ruled}, ` +
        `sources-only ${sources.ruled} (+${sources.ruled - plain.ruled}), .findings() ${
          ledger.ruled
        }, ` +
        `.findings({ argumentSources }) ${both.ruled} (+${both.ruled - ledger.ruled}); ` +
        `unruled tool: plain ${plain.unruled}, .findings() ${ledger.unruled}; system prompt: ` +
        `plain ${plain.system}, .findings() ${ledger.system}`,
    );
    expect(sources.system).toBe(plain.system);
    expect(sources.unruled).toBe(plain.unruled);
    expect(sources.ruled).toBeGreaterThan(plain.ruled);
    expect(both.system).toBe(ledger.system);
    expect(both.unruled).toBe(ledger.unruled);
    // The sources-only arm costs the ruled tool less than the ledger's decoration alone does.
    expect(sources.ruled - plain.ruled).toBeLessThan(ledger.ruled - plain.ruled);
  });
});
