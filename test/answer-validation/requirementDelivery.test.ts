/** Real provider drafts cross the public terminal boundary; host rules project
 * unsupported attribution, then validate the exact delivered answer separately. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RequirementReason } from 'foottrace';
import {
  Agent,
  AnswerValidationError,
  allow,
  checkClaimRequirements,
  defineTool,
  inMemoryArtifacts,
  type AnswerCheck,
  type ArtifactMeta,
  type ClaimRequirementPolicy,
  type LLMProvider,
} from '../../src/index.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
} from '../../src/memory/index.js';

const OWNER = { tenant: 'synthetic-estate', principal: 'reader', conversationId: 'triage' };
const TOOL = 'read_client_summary';
const VM = 'VM-UNPROVEN';
const WINDOW = 'window:2026-10-17T14:00Z/2026-10-17T16:00Z';
const POLICY: ClaimRequirementPolicy = {
  claimRef: 'claim:external-workload',
  findingRef: 'finding:client-latency',
  windowRef: WINDOW,
  requirementRefs: ['policy:client-workload-mapping'],
};
const Stats = z
  .object({ count: z.number(), meanMs: z.number(), peakMs: z.number(), node: z.number() })
  .strict();
const Answer = z
  .object({
    latency: Stats,
    source: z
      .object({ measurementRef: z.string(), queryRef: z.string(), windowRef: z.string() })
      .strict(),
    attribution: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('supported'),
          workload: z.string(),
          requirementResultRefs: z.array(z.string()),
        })
        .strict(),
      z
        .object({
          status: z.literal('unverified'),
          workload: z.null(),
          reason: z.string(),
          requirementResultRefs: z.array(z.string()),
        })
        .strict(),
    ]),
  })
  .strict();
type Answer = z.infer<typeof Answer>;
const Measurement = z
  .object({
    queryRef: z.string(),
    windowRef: z.string(),
    node: z.number(),
    samples: z.array(z.number()).min(1),
  })
  .strict();
type Mode = 'classic' | 'dynamic' | 'dynamic-grouped';
type Mapping =
  | 'missing'
  | 'satisfied'
  | 'omitted'
  | 'wrong-window'
  | 'old-run'
  | 'wrong-query'
  | 'wrong-producer'
  | 'denied'
  | 'malformed';
function requirement(query: string, mapping: Mapping) {
  return {
    id: `requirement-result:${query}`,
    requirementRef: POLICY.requirementRefs[0],
    findingRef: POLICY.findingRef,
    windowRef: mapping === 'wrong-window' ? 'window:previous' : WINDOW,
    affects: [POLICY.claimRef],
    ...(mapping === 'satisfied'
      ? { state: 'satisfied' }
      : { state: 'unresolved', reason: 'not-collected' }),
    evidenceRefs: [],
    checks: [],
    actionRefs: ['action:collect-mapping'],
  };
}

function fixture(
  options: {
    mode?: Mode;
    mapping?: Mapping;
    enabled?: boolean;
    bypassProjection?: boolean;
    changedMean?: boolean;
    modelForgedReceipt?: boolean;
    collectAgain?: boolean;
    tamperUnknown?: 'reason' | 'refs';
    sourceFailsAfterReceipt?: boolean;
  } = {},
) {
  const artifacts = inMemoryArtifacts();
  const memory = new InMemoryStore();
  const mapping = options.mapping ?? 'missing';
  type Issued = {
    queryRef: string;
    runId: string;
    producer: string;
    principal: string;
    results: unknown;
    stats: ArtifactMeta;
    mapping?: { client: string; workload: string };
  };
  let queryOrdinal = 0;
  let query = 'query:0';
  let callerPrincipal = OWNER.principal;
  let currentRun: string | undefined;
  let issued: Issued | undefined;
  let previous: Issued | undefined;
  let request = 0;
  const runs: string[] = [];
  const raw: string[] = [];
  const yielded: string[] = [];
  const provider: LLMProvider = {
    name: 'required-evidence-stream-fixture',
    complete: async () => {
      throw new Error('The streaming path must execute.');
    },
    stream: async function* () {
      const index = request++;
      if (index === 0 || (options.collectAgain === true && index % 2 === 0)) {
        yield {
          tokenIndex: 0,
          content: '',
          done: true,
          response: {
            content: '',
            toolCalls: [{ id: 'repeated-call-id', name: TOOL, args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          },
        };
        return;
      }
      if (previous === undefined) throw new Error('The tool must actually execute first.');
      const content = JSON.stringify({
        latency: { count: 3, meanMs: options.changedMean === true ? 999 : 20, peakMs: 30, node: 7 },
        source: {
          measurementRef: previous.stats.ref,
          queryRef: previous.queryRef,
          windowRef: WINDOW,
        },
        attribution: {
          ...(options.tamperUnknown === undefined
            ? {
                status: 'supported',
                workload: VM,
                requirementResultRefs: [`requirement-result:${previous.queryRef}`],
              }
            : {
                status: 'unverified',
                workload: null,
                reason: options.tamperUnknown === 'reason' ? 'invented-reason' : 'not-collected',
                requirementResultRefs:
                  options.tamperUnknown === 'refs'
                    ? ['requirement-result:invented']
                    : [`requirement-result:${previous.queryRef}`],
              }),
        },
        ...(options.modelForgedReceipt === true && {
          modelReceipt: requirement(previous.queryRef, 'satisfied'),
        }),
      });
      raw.push(content);
      const at = Math.ceil(content.length / 2);
      for (const [tokenIndex, part] of [content.slice(0, at), content.slice(at)].entries()) {
        yielded.push(part);
        yield { tokenIndex, content: part, done: false };
      }
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: {
          content,
          toolCalls: [],
          usage: { input: 1, output: 2 },
          stopReason: 'stop',
        },
      };
    },
  };
  const source = defineTool({
    name: TOOL,
    description: 'Read measured client latency and a separate workload inventory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, context) => {
      const stats = await context.artifacts.put({
        kind: 'test/client-measurements',
        mediaType: 'application/json',
        digest: 'sha-256',
        data: { queryRef: query, windowRef: WINDOW, node: 7, samples: [10, 20, 30] },
      });
      const nativeRun = stats.origin?.runId;
      if (nativeRun === undefined) throw new Error('Native artifact provenance is required.');
      currentRun = nativeRun;
      runs.push(nativeRun);
      issued = {
        queryRef: mapping === 'wrong-query' ? 'query:previous' : query,
        runId: mapping === 'old-run' ? 'run:previous' : nativeRun,
        producer: mapping === 'wrong-producer' ? 'other_producer' : TOOL,
        principal: OWNER.principal,
        stats,
        ...(mapping === 'satisfied' && { mapping: { client: 'client-1', workload: VM } }),
        results:
          mapping === 'omitted'
            ? []
            : mapping === 'malformed'
            ? [{ state: 'satisfied' }]
            : [requirement(query, mapping)],
      };
      previous = { ...issued, queryRef: query };
      if (options.sourceFailsAfterReceipt === true)
        throw new Error('SYNTHETIC_SOURCE_NOT_COMPLETED');
      // The VM is a real inventory value. Its presence is no client-to-VM relationship.
      return {
        statistics: { count: 3, meanMs: 20, peakMs: 30, node: 7 },
        inventory: [VM],
        sourceRef: stats.ref,
      };
    },
  });
  // Trusted producer admission is app-owned. No candidate refs select this
  // expected universe; same conversation and provider call id are insufficient.
  const refused = (reason: RequirementReason) => {
    const check: AnswerCheck = { id: POLICY.claimRef, disposition: 'unreachable', reason };
    return { check, pass: false, reason, refs: [] };
  };
  const assess = () => {
    if (mapping === 'denied') return refused('not-permitted');
    if (
      issued === undefined ||
      issued.queryRef !== query ||
      issued.runId !== currentRun ||
      issued.producer !== TOOL ||
      issued.principal !== callerPrincipal
    )
      return refused('unavailable');
    const assessment = checkClaimRequirements(POLICY, issued.results);
    return {
      check: assessment.check,
      pass: assessment.check.disposition === 'checked-pass',
      reason: assessment.check.reason ?? 'unavailable',
      refs: assessment.requirementResultRefs,
    };
  };
  let builder = Agent.create({
    provider,
    model: 'mock',
    reactMode: options.mode ?? 'dynamic',
    artifacts,
  })
    .tool(source)
    .outputSchema(Answer)
    .memory(
      defineMemory({
        id: 'triage-memory',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 4 },
        store: memory,
      }),
    );
  if (options.enabled !== false) {
    builder = builder
      .messageMiddleware({
        name: 'host-required-evidence-projection',
        onMessage: (message) => {
          if (message.phase === 'input') {
            query = `query:${++queryOrdinal}`;
            callerPrincipal = message.identity?.principal ?? '';
            issued = undefined;
            currentRun = undefined;
            return allow();
          }
          if (options.bypassProjection === true) return allow();
          const draft: unknown = JSON.parse(message.content);
          const candidate = Answer.omit({ attribution: true }).passthrough().parse(draft);
          const assessed = assess();
          const projected: Answer = {
            latency: candidate.latency,
            source: candidate.source,
            attribution: assessed.pass
              ? Answer.parse(draft).attribution
              : {
                  status: 'unverified',
                  workload: null,
                  reason: assessed.reason,
                  requirementResultRefs: [...assessed.refs],
                },
          };
          return allow(
            JSON.stringify(projected),
            'The host withheld an attribution whose required mapping is unresolved.',
          );
        },
      })
      .answerValidation<Answer>({
        id: 'measured-client-and-safe-attribution',
        version: '1',
        validate: async (candidate, context) => {
          // A minted parcel is not proof its source completed. The ledger is
          // only liveness; producer/run/query/scope/digest admission stays below.
          const calls = context.toolCalls;
          const sources = calls.calls.filter((call) => call.name === TOOL);
          const sourceCompleted =
            calls.complete &&
            sources.length === 1 &&
            sources[0].outcome === 'ok' &&
            sources[0].callId === issued?.stats.origin?.toolCallId;

          const resolved = await context.artifacts.resolve(candidate.source.measurementRef, {
            kind: 'test/client-measurements',
          });
          const measured = Measurement.safeParse(resolved.ok ? resolved.record.data : undefined);
          const samples = measured.success ? measured.data.samples : [];
          const measuredPass =
            issued !== undefined &&
            measured.success &&
            resolved.ok &&
            candidate.source.measurementRef === issued.stats.ref &&
            resolved.record.meta.digest === issued.stats.digest &&
            resolved.record.meta.origin?.runId === currentRun &&
            candidate.source.queryRef === query &&
            measured.data.queryRef === query &&
            candidate.source.windowRef === WINDOW &&
            measured.data.windowRef === WINDOW &&
            candidate.latency.count === samples.length &&
            candidate.latency.meanMs === samples.reduce((a, b) => a + b, 0) / samples.length &&
            candidate.latency.peakMs === Math.max(...samples) &&
            candidate.latency.node === measured.data.node;
          const assessed = assess();
          const unknown =
            !assessed.pass &&
            candidate.attribution.status === 'unverified' &&
            candidate.attribution.workload === null &&
            candidate.attribution.reason === assessed.reason &&
            JSON.stringify(candidate.attribution.requirementResultRefs) ===
              JSON.stringify(assessed.refs);
          const supported =
            candidate.attribution.status === 'supported' &&
            assessed.pass &&
            issued?.mapping?.client === 'client-1' &&
            candidate.attribution.workload === issued.mapping.workload &&
            JSON.stringify(candidate.attribution.requirementResultRefs) ===
              JSON.stringify(assessed.refs);
          const attributionChecks: AnswerCheck[] =
            candidate.attribution.status === 'supported'
              ? [
                  assessed.check,
                  {
                    id: 'mapping-value',
                    disposition: !assessed.pass
                      ? 'unreachable'
                      : supported
                      ? 'checked-pass'
                      : 'checked-fail',
                    ...(!assessed.pass && { reason: assessed.reason }),
                  },
                ]
              : [
                  {
                    id: 'attribution-is-permitted',
                    disposition: unknown ? 'not-applicable' : 'checked-fail',
                  },
                ];
          return {
            checks: [
              {
                id: 'measured-latency',
                disposition: measuredPass ? 'checked-pass' : 'checked-fail',
                ...(resolved.ok && { evidenceRefs: [resolved.record.meta.ref] }),
              },
              {
                id: 'source-call-completed',
                disposition: sourceCompleted ? 'checked-pass' : 'checked-fail',
              },
              ...attributionChecks,
            ],
          };
        },
      });
  }
  const newMessages: unknown[] = [];
  const agent = builder
    .watch({
      id: 'terminal-new-messages-witness',
      onWrite(event) {
        if (event.key === 'newMessages') newMessages.push(structuredClone(event.value));
      },
    })
    .build();
  const tokens: string[] = [];
  const ends: string[] = [];
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload.finalContent));
  return { agent, memory, tokens, ends, raw, yielded, runs, newMessages };
}

async function selective(mode: Mode, typed: boolean) {
  const setup = fixture({ mode });
  const input = { message: 'Triage the client and identify its workload.', identity: OWNER };
  const delivered = typed
    ? JSON.stringify(await setup.agent.runTyped<Answer>(input))
    : await setup.agent.run(input);
  if (typeof delivered !== 'string') throw new Error('Unexpected pause.');
  const answer = Answer.parse(JSON.parse(delivered));
  expect(answer.latency).toEqual({ count: 3, meanMs: 20, peakMs: 30, node: 7 });
  expect(answer.attribution).toMatchObject({
    status: 'unverified',
    workload: null,
    reason: 'not-collected',
  });
  expect(setup.yielded.join('')).toContain(VM);
  expect(setup.tokens).toEqual([delivered]);
  expect(setup.ends).toEqual([delivered]);
  expect(delivered).not.toContain(VM);
  expect(setup.agent.checkpoint()?.history.at(-1)?.content).toBe(delivered);
  expect(setup.newMessages.at(-1)).toEqual([
    { role: 'user', content: input.message },
    { role: 'assistant', content: delivered },
  ]);
  const stored = JSON.stringify((await setup.memory.list(OWNER)).entries);
  expect(stored).toContain('meanMs');
  expect(stored).not.toContain(VM);
  expect(setup.agent.answerValidation()).toMatchObject({
    status: 'passed',
    checked: 2,
    notApplicable: 1,
  });
}
for (const mode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`required evidence delivery — ${mode}`, () => {
    it('withholds an issued receipt when its producer later fails', async () => {
      const setup = fixture({ mode, sourceFailsAfterReceipt: true });
      await expect(setup.agent.run({ message: 'Triage.', identity: OWNER })).rejects.toBeInstanceOf(
        AnswerValidationError,
      );
      expect(setup.tokens).toEqual([]);
      expect(setup.ends).toEqual([]);
      expect((await setup.memory.list(OWNER)).entries).toEqual([]);
      expect(setup.agent.answerValidation()?.checks).toContainEqual({
        id: 'source-call-completed',
        disposition: 'checked-fail',
      });
    });
    it('preserves measured facts while withholding attribution across native sinks', () =>
      selective(mode, false));
    it('preserves the same canonical answer in typed delivery', () => selective(mode, true));
    it('rejects unsupported attribution if the projection is bypassed', async () => {
      const setup = fixture({ mode, bypassProjection: true });
      await expect(setup.agent.run({ message: 'Triage.', identity: OWNER })).rejects.toBeInstanceOf(
        AnswerValidationError,
      );
      expect(setup.yielded.join('')).toContain(VM);
      expect(setup.tokens).toEqual([]);
      expect(setup.ends).toEqual([]);
      expect((await setup.memory.list(OWNER)).entries).toEqual([]);
      expect(setup.agent.answerValidation()?.checks).toContainEqual(
        expect.objectContaining({ id: 'measured-latency', disposition: 'checked-pass' }),
      );
      expect(setup.agent.answerValidation()?.checks).toContainEqual({
        id: POLICY.claimRef,
        disposition: 'unreachable',
        reason: 'not-collected',
      });
      expect(setup.agent.answerValidation()?.status).toBe('unverified');
    });
    it('without the opt-in delivers the original streamed draft unchanged', async () => {
      const setup = fixture({ mode, enabled: false });
      expect(await setup.agent.run({ message: 'Triage.', identity: OWNER })).toBe(setup.raw[0]);
      expect(setup.tokens.join('')).toBe(setup.raw[0]);
      expect(setup.ends).toEqual([setup.raw[0]]);
      expect(setup.agent.answerValidation()).toBeUndefined();
    });
  });
}
describe('host receipt authority', () => {
  it.each(['reason', 'refs'] as const)(
    'rejects invented unknown-attribution %s at final validation',
    async (tamperUnknown) => {
      const setup = fixture({ bypassProjection: true, tamperUnknown });
      await expect(setup.agent.run({ message: 'Triage.', identity: OWNER })).rejects.toBeInstanceOf(
        AnswerValidationError,
      );
      expect(setup.agent.answerValidation()?.checks).toContainEqual(
        expect.objectContaining({ id: 'measured-latency', disposition: 'checked-pass' }),
      );
      expect(setup.agent.answerValidation()?.checks).toContainEqual({
        id: 'attribution-is-permitted',
        disposition: 'checked-fail',
      });
      expect(setup.tokens).toEqual([]);
    },
  );
  it.each([
    ['omitted', 'not-collected'],
    ['wrong-window', 'incompatible'],
    ['old-run', 'unavailable'],
    ['wrong-query', 'unavailable'],
    ['wrong-producer', 'unavailable'],
    ['denied', 'not-permitted'],
    ['malformed', 'invalid-data'],
  ] as const)('%s optional mapping cannot suppress measured latency', async (mapping, reason) => {
    const setup = fixture({ mapping });
    const answer = await setup.agent.runTyped<Answer>({ message: 'Triage.', identity: OWNER });
    expect(answer.latency).toEqual({ count: 3, meanMs: 20, peakMs: 30, node: 7 });
    expect(answer.attribution).toMatchObject({ status: 'unverified', workload: null, reason });
    expect(setup.tokens.join('')).not.toContain(VM);
  });
  it('does not grant authority to a model-invented satisfied receipt', async () => {
    const setup = fixture({ modelForgedReceipt: true });
    const answer = await setup.agent.runTyped<Answer>({ message: 'Triage.', identity: OWNER });
    expect(setup.raw[0]).toContain('"state":"satisfied"');
    expect(answer.attribution).toMatchObject({ status: 'unverified', reason: 'not-collected' });
    expect(setup.tokens.join('')).not.toContain('modelReceipt');
  });
  it('still rejects changed measurements when a prerequisite is satisfied', async () => {
    const setup = fixture({ mapping: 'satisfied', bypassProjection: true, changedMean: true });
    await expect(setup.agent.run({ message: 'Triage.', identity: OWNER })).rejects.toBeInstanceOf(
      AnswerValidationError,
    );
    expect(setup.agent.answerValidation()?.checks[0]?.disposition).toBe('checked-fail');
    expect(setup.tokens).toEqual([]);
  });
  it('can deliver the scoped connection when both host mapping and measured values agree', async () => {
    const setup = fixture({ mapping: 'satisfied' });
    const answer = await setup.agent.runTyped<Answer>({ message: 'Triage.', identity: OWNER });
    expect(answer.attribution).toMatchObject({ status: 'supported', workload: VM });
    expect(setup.agent.answerValidation()).toMatchObject({ status: 'passed', checked: 4 });
  });
  it('does not reuse earlier authority for a new run in the same conversation', async () => {
    const setup = fixture({ mapping: 'satisfied' });
    await setup.agent.run({ message: 'First triage.', identity: OWNER });
    setup.tokens.length = 0;
    setup.ends.length = 0;
    await expect(
      setup.agent.followUp('Answer a new query from old results.'),
    ).rejects.toBeInstanceOf(AnswerValidationError);
    expect(setup.tokens).toEqual([]);
    expect(setup.ends).toEqual([]);
  });
  it('collects fresh native run provenance even when the provider repeats its call ID', async () => {
    const setup = fixture({ collectAgain: true });
    const first = await setup.agent.runTyped<Answer>({ message: 'First triage.', identity: OWNER });
    const second = await setup.agent.runTyped<Answer>({ message: 'New triage.', identity: OWNER });
    expect(first.source.measurementRef).not.toBe(second.source.measurementRef);
    expect(first.source.queryRef).not.toBe(second.source.queryRef);
    expect(new Set(setup.runs).size).toBe(2);
  });
  it('isolates host authority across concurrently running Agent instances', async () => {
    const left = fixture();
    const right = fixture({ mapping: 'satisfied' });
    const [unknown, known] = await Promise.all([
      left.agent.runTyped<Answer>({ message: 'Left.', identity: OWNER }),
      right.agent.runTyped<Answer>({ message: 'Right.', identity: OWNER }),
    ]);
    expect(unknown.attribution.status).toBe('unverified');
    expect(known.attribution.status).toBe('supported');
    expect(unknown.source.measurementRef).not.toBe(known.source.measurementRef);
  });
});
