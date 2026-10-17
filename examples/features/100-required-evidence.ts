/** 100 — keep measured facts while withholding an unsupported connection.
 * Run: npm run example examples/features/100-required-evidence.ts
 * This scripted example makes no network or model calls. */
import { z } from 'zod';
import {
  Agent,
  allow,
  checkClaimRequirements,
  defineTool,
  inMemoryArtifacts,
  type AnswerCheck,
  type AnswerValidationOptions,
  type ArtifactMeta,
  type ClaimRequirementPolicy,
  type MessageMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/100-required-evidence',
  title: 'Measured latency without an invented workload connection',
  group: 'features',
  providerSlots: [],
  tags: ['features', 'tools', 'security'],
  description:
    'Use producer-owned required evidence to withhold attribution while measured facts remain available.',
  defaultInput: 'Triage this client and identify its workload.',
};
const Reply = z
  .object({
    meanMs: z.number(),
    count: z.number(),
    observedNode: z.number(),
    measurementRef: z.string(),
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
type Reply = z.infer<typeof Reply>;
const Samples = z
  .object({
    queryRef: z.string(),
    windowRef: z.string(),
    node: z.number(),
    values: z.array(z.number()).min(1),
  })
  .strict();

export async function run(input: string): Promise<string> {
  // Fresh instance and producer state for every run. A reusable host must reset
  // this authority at each run and authenticate retained parcels before use.
  const identity = {
    tenant: 'example-estate',
    principal: 'reader',
    conversationId: 'client-triage',
  };
  const queryRef = 'query:synthetic-client';
  const toolName = 'read_client_summary';
  const policy: ClaimRequirementPolicy = {
    claimRef: 'claim:external-workload',
    findingRef: 'finding:client-latency',
    windowRef: 'window:2026-10-17T14:00Z/2026-10-17T16:00Z',
    requirementRefs: ['policy:client-workload-mapping'],
  };
  let issued:
    | {
        measurement: ArtifactMeta;
        queryRef: string;
        producer: string;
        runId: string;
        requirements: unknown;
      }
    | undefined;
  let calls = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: () => {
      if (calls++ === 0) return { toolCalls: [{ id: 'summary-call', name: toolName, args: {} }] };
      if (issued === undefined) throw new Error('The summary source did not run.');
      // VM-UNPROVEN exists in inventory, but no connection to this client exists.
      return {
        content: JSON.stringify({
          meanMs: 20,
          count: 3,
          observedNode: 7,
          measurementRef: issued.measurement.ref,
          attribution: { status: 'supported', workload: 'VM-UNPROVEN', requirementResultRefs: [] },
        }),
      };
    },
  });
  const source = defineTool({
    name: toolName,
    description: 'Read the synthetic client samples and separate inventory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, context) => {
      const measurement = await context.artifacts.put({
        kind: 'example/client-samples',
        mediaType: 'application/json',
        digest: 'sha-256',
        data: { queryRef, windowRef: policy.windowRef, node: 7, values: [10, 20, 30] },
      });
      if (measurement.origin?.runId === undefined)
        throw new Error('Missing native run provenance.');
      issued = {
        measurement,
        queryRef,
        producer: toolName,
        runId: measurement.origin.runId,
        requirements: [
          {
            id: 'requirement-result:missing-mapping',
            requirementRef: policy.requirementRefs[0],
            findingRef: policy.findingRef,
            windowRef: policy.windowRef,
            affects: [policy.claimRef],
            state: 'unresolved',
            reason: 'not-collected',
            evidenceRefs: [],
            checks: [],
            actionRefs: ['action:collect-mapping'],
          },
        ],
      };
      return {
        samples: [10, 20, 30],
        observedNode: 7,
        inventory: ['VM-UNPROVEN'],
        measurementRef: measurement.ref,
      };
    },
  });
  const assess = () =>
    checkClaimRequirements(
      policy,
      issued?.queryRef === queryRef &&
        issued.producer === toolName &&
        issued.measurement.origin?.runId === issued.runId
        ? issued.requirements
        : [],
    );

  const projection: MessageMiddleware = {
    name: 'host-required-evidence',
    onMessage(message) {
      if (message.phase !== 'output') return allow();
      const candidate = Reply.parse(JSON.parse(message.content));
      const assessment = assess();
      // The host builds a closed answer. It never forwards arbitrary model prose
      // or accepts model-supplied requirement states as evidence.
      const safe: Reply = {
        meanMs: candidate.meanMs,
        count: candidate.count,
        observedNode: candidate.observedNode,
        measurementRef: candidate.measurementRef,
        attribution: {
          status: 'unverified',
          workload: null,
          reason: assessment.check.reason ?? 'unavailable',
          requirementResultRefs: [...assessment.requirementResultRefs],
        },
      };
      return allow(JSON.stringify(safe), 'No client-to-workload mapping was collected.');
    },
  };
  const validation: AnswerValidationOptions<Reply> = {
    id: 'measured-facts-and-honest-attribution',
    version: '1',
    async validate(answer, context) {
      // Liveness is separate from producer authority and measured value truth.
      const calls = context.toolCalls;
      const sources = calls.calls.filter((call) => call.name === toolName);
      const sourceCompleted =
        calls.complete &&
        sources.length === 1 &&
        sources[0].outcome === 'ok' &&
        sources[0].callId === issued?.measurement.origin?.toolCallId;

      const parcel = await context.artifacts.resolve(answer.measurementRef, {
        kind: 'example/client-samples',
      });
      const measured = Samples.safeParse(parcel.ok ? parcel.record.data : undefined);
      const values = measured.success ? measured.data.values : [];
      const matches =
        issued !== undefined &&
        parcel.ok &&
        measured.success &&
        answer.measurementRef === issued.measurement.ref &&
        parcel.record.meta.digest === issued.measurement.digest &&
        parcel.record.meta.origin?.runId === issued.runId &&
        measured.data.queryRef === queryRef &&
        measured.data.windowRef === policy.windowRef &&
        answer.meanMs === values.reduce((sum, value) => sum + value, 0) / values.length &&
        answer.count === values.length &&
        answer.observedNode === measured.data.node;
      const assessment = assess();
      const honestUnknown =
        assessment.check.disposition !== 'checked-pass' &&
        answer.attribution.status === 'unverified' &&
        answer.attribution.workload === null &&
        answer.attribution.reason === assessment.check.reason &&
        JSON.stringify(answer.attribution.requirementResultRefs) ===
          JSON.stringify(assessment.requirementResultRefs);
      // A prerequisite check concerns only the asserted connection. Its
      // unavailable disposition must survive unchanged; it is not a conflict.
      // This source collected no mapping value, so even a satisfied wire
      // prerequisite could not supply that separate factual comparison.
      const attributionChecks: AnswerCheck[] =
        answer.attribution.status === 'supported'
          ? [
              assessment.check,
              { id: 'mapping-value', disposition: 'unreachable', reason: 'not-collected' },
            ]
          : [
              {
                id: 'no-unsupported-attribution',
                disposition: honestUnknown ? 'not-applicable' : 'checked-fail',
              },
            ];
      return {
        checks: [
          {
            id: 'measured-latency',
            disposition: matches ? 'checked-pass' : 'checked-fail',
            ...(parcel.ok && { evidenceRefs: [parcel.record.meta.ref] }),
          },
          {
            id: 'source-call-completed',
            disposition: sourceCompleted ? 'checked-pass' : 'checked-fail',
          },
          ...attributionChecks,
        ],
      };
    },
  };

  // #region required-evidence
  // Compose the host projection with validation of the exact delivered answer.
  const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
    .tool(source)
    .messageMiddleware(projection)
    .outputSchema(Reply)
    .answerValidation<Reply>(validation)
    .build();
  // #endregion required-evidence
  const answer = await agent.runTyped<Reply>({ message: input, identity });
  if (answer.meanMs !== 20 || answer.attribution.status !== 'unverified')
    throw new Error('Unexpected example outcome.');
  return JSON.stringify(answer, null, 2);
}
if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
