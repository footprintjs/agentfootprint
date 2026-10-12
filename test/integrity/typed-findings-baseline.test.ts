/**
 * Public-run characterization before optional typed findings are designed.
 * These are today's boundaries, not promises of positive evidence support:
 * .claims() joins entity + field, observes raw schema-accepted JSON, and never
 * enforces delivery. The existing unsupportedClaim and answer-validation suites
 * own the pure algebra, missing-fact cases and standalone delivery contracts.
 * Every response and measurement below is synthetic; no provider is contacted.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  defineTool,
  describedResult,
  type AnswerValidationOptions,
  type LLMProvider,
  type OutputSchemaParser,
  type SemanticFact,
} from '../../src/index.js';
import type { Payloads } from '../../src/events.js';
import { unknown as unknownFact } from '../../src/doors/maps.js';

interface Answer {
  scope: string;
  value?: string | number | null;
}

const answerParser: OutputSchemaParser<Answer> = {
  parse(input: unknown): Answer {
    if (
      input === null ||
      typeof input !== 'object' ||
      !('scope' in input) ||
      typeof input.scope !== 'string'
    ) {
      throw new Error('An answer with a scope is required.');
    }
    if (!('value' in input)) return { scope: input.scope };
    if (
      input.value !== null &&
      typeof input.value !== 'number' &&
      typeof input.value !== 'string'
    ) {
      throw new Error('The optional value must be a scalar or null.');
    }
    return { scope: input.scope, value: input.value };
  },
};

interface Reading {
  scope: string;
  fact: SemanticFact;
  measuredAt: string;
}

const west = (value: unknown): Reading => ({
  scope: 'west',
  fact: { entity: 'fleet', count: value },
  measuredAt: '2026-01-02T00:00:00Z',
});
const east = (value: unknown): Reading => ({
  scope: 'east',
  fact: { entity: 'fleet', count: value },
  // Deliberately older measurement, returned by the later tool occurrence.
  measuredAt: '2026-01-01T00:00:00Z',
});

function runFixture(options: {
  readings: readonly Reading[];
  answer: Answer;
  parser?: OutputSchemaParser<Answer>;
  validation?: AnswerValidationOptions<Answer>;
  reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped';
}) {
  const executed: string[] = [];
  const requestResults: string[][] = [];
  const sourceChunks: string[] = [];
  const findings: Payloads.IntegrityContextErrorPayload[] = [];
  const dispositions: Payloads.IntegrityDispositionPayload[] = [];
  const declarations: Payloads.ToolSemanticsDeclaredPayload[] = [];
  const tokens: string[] = [];
  const ends: string[] = [];
  const raw = JSON.stringify(options.answer, null, 2);
  const provider: LLMProvider = {
    name: 'typed-findings-baseline',
    async complete() {
      throw new Error('This fixture must take the actual streaming path.');
    },
    async *stream(request) {
      const index = requestResults.length;
      if (index > options.readings.length) throw new Error('Unexpected retry or provider call.');
      // A later call cannot be supplied before the earlier tool really ran.
      expect(executed).toHaveLength(index);
      requestResults.push(
        request.messages
          .filter((message) => message.role === 'tool')
          .map((message) => message.content),
      );
      const reading = options.readings[index];
      if (reading) {
        yield {
          tokenIndex: 0,
          content: '',
          done: true,
          response: {
            content: '',
            toolCalls: [
              { id: `read-${index + 1}`, name: 'read_count', args: { scope: reading.scope } },
            ],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          },
        };
        return;
      }
      const middle = Math.ceil(raw.length / 2);
      for (const [tokenIndex, content] of [raw.slice(0, middle), raw.slice(middle)].entries()) {
        sourceChunks.push(content);
        yield { tokenIndex, content, done: false };
      }
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: {
          content: raw,
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        },
      };
    },
  };
  const builder = Agent.create({
    provider,
    model: 'synthetic',
    reactMode: options.reactMode ?? 'dynamic',
    maxIterations: options.readings.length + 2,
    integrityPosture: 'observe',
  })
    .system('Read the requested scopes in order, then report the west fleet count.')
    .tool(
      defineTool({
        name: 'read_count',
        description: 'Read a synthetic count within the requested scope.',
        inputSchema: {
          type: 'object',
          properties: { scope: { type: 'string' } },
          required: ['scope'],
        },
        execute(args) {
          const reading = options.readings[executed.length];
          if (!reading) throw new Error('Unexpected tool execution.');
          expect(args).toEqual({ scope: reading.scope });
          executed.push(reading.scope);
          return describedResult({
            facts: [reading.fact],
            provenance: { measuredAt: reading.measuredAt, source: `synthetic-${reading.scope}` },
          });
        },
      }),
    )
    .outputSchema(options.parser ?? answerParser)
    .claims({ value: { entity: 'fleet', field: 'count' } });
  if (options.validation) builder.answerValidation(options.validation);
  const agent = builder.build();
  agent.on('agentfootprint.integrity.context_error', (event) => findings.push(event.payload));
  agent.on('agentfootprint.integrity.disposition', (event) => dispositions.push(event.payload));
  agent.on('agentfootprint.tools.semantics_declared', (event) => declarations.push(event.payload));
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload.finalContent));
  return {
    agent,
    findings,
    declarations,
    sourceChunks,
    tokens,
    ends,
    raw,
    row() {
      expect(executed).toEqual(options.readings.map((reading) => reading.scope));
      expect(requestResults).toHaveLength(options.readings.length + 1);
      for (let i = 0; i < options.readings.length; i++) {
        expect(requestResults[i + 1]!.join('\n')).toContain(
          `synthetic-${options.readings[i]!.scope}`,
        );
      }
      expect(declarations).toHaveLength(options.readings.length);
      expect(dispositions).toHaveLength(1);
      expect(dispositions[0]).toMatchObject({ posture: 'observe', workExisted: true });
      const row = dispositions[0]!.rows.find((entry) => entry.check === 'unsupported-claim');
      if (!row) throw new Error('The public claim disposition was not emitted.');
      expect(row.synthetic).toBe(0);
      return row;
    },
  };
}

const QUESTION = {
  message: 'Report the count for west, even if another scope is read afterwards.',
};

describe('functional: existing typed-claim accounting through an actual run', () => {
  it.each([
    { fact: 30, answer: '30', failures: 0 },
    { fact: '30', answer: 30, failures: 1 },
  ])(
    'numeric leniency is one-way: fact $fact, answer $answer',
    async ({ fact, answer, failures }) => {
      const fixture = runFixture({
        readings: [west(fact)],
        answer: { scope: 'west', value: answer },
      });
      expect(await fixture.agent.run(QUESTION)).toBe(fixture.raw);
      expect(fixture.findings).toHaveLength(failures);
      if (failures) {
        expect(fixture.findings[0]!.witnesses.map((witness) => witness.value)).toEqual([
          fact,
          answer,
        ]);
        expect(fixture.findings[0]!.advisory).toBeUndefined();
      }
      expect(fixture.row()).toMatchObject({
        checked: 1,
        findings: failures,
        notApplicable: 0,
        unreachable: 0,
      });
    },
  );

  it.each([null, 'unknown'])(
    'doubt %s is delivered with an advisory but counted as checked',
    async (value) => {
      const fixture = runFixture({ readings: [west(30)], answer: { scope: 'west', value } });
      expect(await fixture.agent.run(QUESTION)).toBe(fixture.raw);
      expect(fixture.findings).toHaveLength(1);
      expect(fixture.findings[0]).toMatchObject({
        kind: 'unsupported-claim',
        advisory: true,
        predicate: 'count',
      });
      expect(fixture.findings[0]!.witnesses.map((witness) => witness.value)).toEqual([30]);
      expect(fixture.row()).toMatchObject({
        checked: 1,
        findings: 0,
        notApplicable: 0,
        unreachable: 0,
      });
    },
  );

  it('a schema-permitted omitted answer field is not-applicable, not a checked agreement', async () => {
    const fixture = runFixture({ readings: [west(30)], answer: { scope: 'west' } });
    expect(await fixture.agent.run(QUESTION)).toBe(fixture.raw);
    expect(fixture.findings).toEqual([]);
    expect(fixture.row()).toMatchObject({
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 0,
    });
  });
});

describe('functional: latest entity + field is not scoped source selection', () => {
  it.each([30, 40])(
    'after west=30 then east=40, a west-labelled answer of %s uses the later row',
    async (value) => {
      const fixture = runFixture({
        readings: [west(30), east(40)],
        answer: { scope: 'west', value },
      });
      expect(await fixture.agent.run(QUESTION)).toBe(fixture.raw);
      expect(
        fixture.declarations.map(({ toolCallId, iteration, semantics }) => ({
          toolCallId,
          iteration,
          source: semantics.provenance?.source,
          measuredAt: semantics.provenance?.measured_at,
        })),
      ).toEqual([
        {
          toolCallId: 'read-1',
          iteration: 1,
          source: 'synthetic-west',
          measuredAt: west(30).measuredAt,
        },
        {
          toolCallId: 'read-2',
          iteration: 2,
          source: 'synthetic-east',
          measuredAt: east(40).measuredAt,
        },
      ]);
      const failures = value === 30 ? 1 : 0;
      expect(fixture.findings).toHaveLength(failures);
      expect(fixture.row()).toMatchObject({
        checked: 1,
        findings: failures,
        notApplicable: 0,
        unreachable: 0,
      });
      if (value === 30) {
        expect(fixture.findings[0]!.witnesses).toMatchObject([
          {
            value: 40,
            stratum: 'asserted',
            provenance: 'read_count (call read-2, iteration 2), measured_at 2026-01-01T00:00:00Z',
          },
          { value: 30, stratum: 'asserted', provenance: "answer field 'value'" },
          { value: 30, stratum: 'quoted', provenance: 'read_count (call read-1, iteration 1)' },
        ]);
      }
      // No scope field is declared in .claims(). Neither executed args nor source
      // provenance make it choose west; a pass here is not proof of that scope.
    },
  );

  it('a later unknown reading shadows an earlier known value instead of falling back', async () => {
    const fixture = runFixture({
      readings: [west(30), east(unknownFact('The later reading is unavailable.'))],
      answer: { scope: 'west', value: 30 },
    });
    expect(await fixture.agent.run(QUESTION)).toBe(fixture.raw);
    expect(fixture.findings).toEqual([]);
    expect(fixture.row()).toMatchObject({
      checked: 0,
      findings: 0,
      notApplicable: 0,
      unreachable: 1,
    });
  });
});

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`functional: raw claim versus canonical answer — ${reactMode}`, () => {
    it.each(['observe', 'enforce'] as const)(
      '%s sees a changed value although the earlier claim check passed',
      async (mode) => {
        const seen: Answer[] = [];
        const canonical = JSON.stringify({ scope: 'west', value: 40 });
        const fixture = runFixture({
          reactMode,
          readings: [west(30)],
          answer: { scope: 'west', value: 30 },
          parser: {
            parse(input) {
              return { ...answerParser.parse(input), value: 40 };
            },
          },
          validation: {
            id: 'canonical-count',
            version: '1',
            mode,
            validate(candidate) {
              seen.push({ ...candidate });
              return {
                checks: [
                  {
                    id: 'count-remains-thirty',
                    disposition: candidate.value === 30 ? 'checked-pass' : 'checked-fail',
                  },
                ],
              };
            },
          },
        });
        if (mode === 'observe') {
          expect(await fixture.agent.run(QUESTION)).toBe(canonical);
          expect(fixture.tokens).toEqual([canonical]);
          expect(fixture.ends).toEqual([canonical]);
          expect(fixture.agent.checkpoint()?.history.at(-1)?.content).toBe(canonical);
        } else {
          await expect(fixture.agent.run(QUESTION)).rejects.toBeInstanceOf(AnswerValidationError);
          expect(fixture.tokens).toEqual([]);
          expect(fixture.ends).toEqual([]);
          expect(
            fixture.agent.checkpoint()?.history.some((message) => message.content === canonical),
          ).toBe(false);
        }
        expect(fixture.sourceChunks.join('')).toBe(fixture.raw);
        expect(seen).toEqual([{ scope: 'west', value: 40 }]);
        expect(fixture.findings).toEqual([]);
        expect(fixture.row()).toMatchObject({
          checked: 1,
          findings: 0,
          notApplicable: 0,
          unreachable: 0,
        });
        expect(fixture.agent.answerValidation()).toMatchObject({
          mode,
          status: 'failed',
          checked: 1,
          failed: 1,
          schemaAccepted: true,
          candidateDigest: `sha-256:${createHash('sha256').update(canonical).digest('hex')}`,
        });
      },
    );
  });
}
