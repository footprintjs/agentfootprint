/**
 * Runs the actual public Agent API. The provider and lookup are deterministic
 * fixtures; the enforcing gate, scoped artifact read and stream are real.
 * Loaded by the homepage only when a visitor presses Run. No paid calls.
 */
import {
  Agent,
  AnswerValidationError,
  defineTool,
  inMemoryArtifacts,
  type AnswerCheck,
  type AnswerValidationReport,
  type LLMProvider,
  type OutputSchemaParser,
} from 'agentfootprint';
import {
  ANSWER_CHECK_GAP,
  ANSWER_CHECK_REQUEST,
  type AnswerCheckFixture,
  type RefundEvidence,
} from './answerCheckFixtures';

interface RefundAnswer extends RefundEvidence {
  readonly sourceRef: string | null;
}

function parseEvidence(value: unknown): RefundEvidence {
  if (value === null || typeof value !== 'object') throw new Error('Expected refund evidence.');
  const data = value as Partial<RefundEvidence>;
  if (
    typeof data.customerId !== 'string' ||
    typeof data.orderId !== 'string' ||
    typeof data.readAt !== 'string' ||
    (data.status !== 'completed' && data.status !== 'pending')
  )
    throw new Error('Invalid refund evidence.');
  return {
    customerId: data.customerId,
    orderId: data.orderId,
    status: data.status,
    readAt: data.readAt,
  };
}

const answerSchema: OutputSchemaParser<RefundAnswer> = {
  parse(value) {
    const evidence = parseEvidence(value);
    const { sourceRef } = value as { sourceRef?: unknown };
    if (sourceRef !== null && typeof sourceRef !== 'string')
      throw new Error('Expected a source ref.');
    return { ...evidence, sourceRef };
  },
};

export interface AnswerCheckDemoResult {
  readonly report: AnswerValidationReport;
  /** A page-owned template, rendered only from an accepted typed answer. */
  readonly customerAnswer: string;
  readonly delivered: boolean;
  readonly toolCalls: number;
  readonly providerCalls: number;
  readonly draftChunks: readonly string[];
  readonly servedTokens: readonly string[];
  readonly servedBeforeValidation: readonly string[];
  readonly turnEndContents: readonly string[];
}

export async function runAnswerCheckDemo(
  fixture: AnswerCheckFixture,
): Promise<AnswerCheckDemoResult> {
  // The request's subject is app-owned; neither the model nor a result can change it.
  const request = ANSWER_CHECK_REQUEST;
  let issuedRef: string | null = null;
  let toolCalls = 0;
  let providerCalls = 0;
  let validationFinished = false;
  const draftChunks: string[] = [];
  const servedTokens: string[] = [];
  const servedBeforeValidation: string[] = [];
  const turnEndContents: string[] = [];

  const lookup = defineTool({
    name: 'lookup_refund',
    description: 'Read the refund ledger for the customer and order selected by the app.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, context) => {
      toolCalls += 1;
      if (fixture.evidence === null) throw new Error('Fixture lookup unavailable.');
      const artifact = await context.artifacts.put({
        kind: 'demo/refund-status',
        mediaType: 'application/json',
        digest: 'sha-256',
        data: fixture.evidence,
      });
      issuedRef = artifact.ref;
      return { ...fixture.evidence, sourceRef: artifact.ref, notChecked: [ANSWER_CHECK_GAP] };
    },
  });

  // Scripted provider: genuinely streams a draft, including the two wrong drafts.
  // No provider SDK or network transport is used by this fixture.
  const provider: LLMProvider = {
    name: 'homepage-scripted-fixture',
    complete: async () => {
      throw new Error('This demo requires the streaming path.');
    },
    stream: async function* () {
      providerCalls += 1;
      if (providerCalls > 2) throw new Error('Unexpected extra fixture call.');
      const toolCalls =
        providerCalls === 1 ? [{ id: 'lookup-1', name: 'lookup_refund', args: {} }] : [];
      const content =
        providerCalls === 1 ? '' : JSON.stringify({ ...fixture.draft, sourceRef: issuedRef });
      if (content) {
        const midpoint = Math.ceil(content.length / 2);
        for (const [tokenIndex, part] of [
          content.slice(0, midpoint),
          content.slice(midpoint),
        ].entries()) {
          draftChunks.push(part);
          yield { tokenIndex, content: part, done: false };
        }
      }
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: {
          content,
          toolCalls,
          usage: { input: 0, output: 0 },
          stopReason: toolCalls.length ? 'tool_use' : 'stop',
        },
      };
    },
  };

  const agent = Agent.create({ provider, model: 'fixture', artifacts: inMemoryArtifacts() })
    .tool(lookup)
    .maxIterations(3)
    .outputSchema(answerSchema)
    .answerValidation<RefundAnswer>({
      id: 'refund-status-for-request',
      version: '1',
      mode: 'enforce',
      async validate(answer, { artifacts }) {
        // Binding is app-owned: a model pointer cannot select a different read.
        const missing = () => ({
          checks: [
            {
              id: 'lookup-evidence',
              disposition: 'unreachable',
              reason: 'No usable lookup evidence.',
            } as const,
          ],
        });
        if (!issuedRef || answer.sourceRef !== issuedRef) {
          validationFinished = true;
          return missing();
        }
        const sourceRef = issuedRef;
        const resolution = await artifacts.resolve(sourceRef, { kind: 'demo/refund-status' });
        if (!resolution.ok) {
          validationFinished = true;
          return missing();
        }
        const evidence = parseEvidence(resolution.record.data);
        const age = Date.parse(request.now) - Date.parse(evidence.readAt);
        const check = (id: string, holds: boolean, reason: string): AnswerCheck => ({
          id,
          disposition: holds ? 'checked-pass' : 'checked-fail',
          reason,
          evidenceRefs: [sourceRef],
        });
        const checks = [
          check(
            'customer-and-order',
            evidence.customerId === request.customerId &&
              evidence.orderId === request.orderId &&
              answer.customerId === request.customerId &&
              answer.orderId === request.orderId,
            'Both the lookup and answer must match the app-selected customer and order.',
          ),
          check(
            'freshness',
            Number.isFinite(age) && age >= 0 && age <= request.maxAgeMs,
            'The recorded lookup must be no more than five minutes old at the fixture clock.',
          ),
          check(
            'refund-status',
            answer.status === evidence.status && answer.readAt === evidence.readAt,
            'The answer must match the recorded status and lookup time.',
          ),
        ];
        validationFinished = true;
        return { checks };
      },
    })
    .build();

  agent.on('agentfootprint.stream.token', ({ payload }) => {
    servedTokens.push(payload.content);
    if (!validationFinished) servedBeforeValidation.push(payload.content);
  });
  agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
    turnEndContents.push(payload.finalContent),
  );

  let accepted: RefundAnswer | undefined;
  try {
    const output = await agent.run({
      message: `What is the recorded refund status for order ${request.orderId}?`,
      identity: {
        tenant: 'demo-shop',
        principal: request.customerId,
        conversationId: 'refund-demo',
      },
    });
    if (typeof output !== 'string') throw new Error('Unexpected fixture pause.');
    accepted = agent.parseOutput(output);
  } catch (error) {
    if (!(error instanceof AnswerValidationError)) throw error;
  }
  const report = agent.answerValidation();
  if (!report) throw new Error('The fixture did not reach answer validation.');

  // This is the demo APP's rendering/fallback policy, not a library-written
  // universal guarantee or a new fact established by saying "I don't know".
  const customerAnswer = accepted
    ? `For order ${accepted.orderId}, the refund ledger records “${accepted.status}” as of ${accepted.readAt}. ${ANSWER_CHECK_GAP}`
    : `I don’t know whether the refund is completed for order ${request.orderId}. ${
        report.status === 'failed'
          ? 'The draft did not pass the checks against the recorded lookup.'
          : 'The lookup returned no usable evidence.'
      } ${ANSWER_CHECK_GAP}`;
  return {
    report,
    customerAnswer,
    delivered: accepted !== undefined,
    toolCalls,
    providerCalls,
    draftChunks,
    servedTokens,
    servedBeforeValidation,
    turnEndContents,
  };
}
