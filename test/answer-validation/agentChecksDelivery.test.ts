/**
 * The agent's own checks govern delivery — end to end, scripted provider, no I/O.
 *
 * RED FIRST: an agent with an ENFORCING `.answerValidation()` and a `.claims()`
 * contract still hands back an answer whose typed field contradicts the fact a
 * tool settled — the claim check files its finding and the answer is delivered.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  defineTool,
  describedResult,
  type LLMProvider,
  type LLMRequest,
  type OutputSchemaParser,
} from '../../src/index.js';
import type { Payloads } from '../../src/events.js';

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

/** One tool call, then the scripted final answer. */
function scripted(final: string): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'agent-checks-fixture',
    async complete(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      const first = requests.length === 1;
      if (requests.length > 2) throw new Error('unexpected provider call');
      return {
        content: first ? '' : final,
        toolCalls: first ? [{ id: 'call-1', name: 'read_build', args: { job: 'build-job-72' } }] : [],
        usage: { input: 1, output: 1 },
        stopReason: first ? 'tool_use' : 'end_turn',
      };
    },
  };
  return { provider, requests };
}

const readBuild = defineTool({
  name: 'read_build',
  description: 'Read one build job.',
  inputSchema: { type: 'object', properties: { job: { type: 'string' } } },
  execute: () =>
    describedResult({
      facts: [{ entity: 'build-job-72', durationMs: 1250 }],
      provenance: { source: 'synthetic-ci', measuredAt: '2026-01-01T00:00:00Z' },
    }),
});

describe('functional: a contradicted typed claim under an enforcing answer validation', () => {
  it('is withheld, not delivered with a finding beside it', async () => {
    const { provider } = scripted(JSON.stringify({ job: 'build-job-72', durationMs: 9750 }));
    const agent = Agent.create({ provider, model: 'synthetic', maxIterations: 4 })
      .tool(readBuild)
      .outputSchema(buildAnswer)
      .claims({ durationMs: { entity: 'build-job-72', field: 'durationMs' } })
      .answerValidation<BuildAnswer>({
        id: 'build-report',
        version: '1',
        mode: 'enforce',
        validate: (answer) => ({
          checks: [
            {
              id: 'asked-job',
              disposition: answer.job === 'build-job-72' ? 'checked-pass' : 'checked-fail',
            },
          ],
        }),
      })
      .build();
    const findings: Payloads.IntegrityContextErrorPayload[] = [];
    agent.on('agentfootprint.integrity.context_error', (e) => findings.push(e.payload));

    const outcome = await agent
      .run({ message: 'How long did build-job-72 take?' })
      .catch((error: unknown) => error);

    // The claim check DID see the contradiction…
    expect(findings.map((f) => f.kind)).toEqual(['unsupported-claim']);
    // …and the enforcing boundary must therefore withhold the answer.
    expect(outcome).toBeInstanceOf(AnswerValidationError);
  });
});
