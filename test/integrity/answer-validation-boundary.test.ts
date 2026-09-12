/**
 * Current answer-validation boundaries, through public doors and a real run.
 *
 * These characterize the feature-request baseline, not an unimplemented gate:
 * schema validity, token grounding, typed-claim detection and an explicit host
 * refusal are different outcomes. The existing unsupportedClaim suite owns the
 * checker algebra; this suite pins what a caller actually receives. All evidence
 * and provider replies are synthetic (build jobs and commerce), with no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  MessageDeniedError,
  RunCheckpointError,
  allow,
  defineTool,
  deny,
  semantic,
  type LLMProvider,
  type LLMRequest,
  type SemanticFact,
} from '../../src/index.js';
import type { Payloads } from '../../src/events.js';
import { unknown as unknownFact } from '../../src/doors/maps.js';

type Answer = { entity: string; value: string | number };
const answerParser = {
  parse(value: unknown): Answer {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected an answer object.');
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.entity !== 'string' ||
      (typeof record.value !== 'string' && typeof record.value !== 'number')
    ) {
      throw new Error('Expected an entity and a scalar value.');
    }
    return { entity: record.entity, value: record.value };
  },
};

type ProbeOptions = {
  facts: readonly SemanticFact[];
  answer: Answer | string;
  claim?: { entity: string; field: string };
  groundValues?: boolean;
  instructions?: string;
  verify?: (answer: Answer, executedFacts: readonly SemanticFact[]) => boolean;
};

function probe(options: ProbeOptions) {
  const requests: LLMRequest[] = [];
  const findings: Payloads.IntegrityContextErrorPayload[] = [];
  const dispositions: Payloads.IntegrityDispositionPayload[] = [];
  const grounding: Payloads.AgentEvidenceCheckedPayload[] = [];
  let declarations = 0;
  let executedFacts: readonly SemanticFact[] = [];
  let verifications = 0;
  const finalText =
    typeof options.answer === 'string' ? options.answer : JSON.stringify(options.answer);
  const provider: LLMProvider = {
    name: 'synthetic-answer-boundary',
    async complete(request) {
      // Requests may contain scope-backed values: capture immediately, not after
      // the run has advanced. No provider or customer data enters this fixture.
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      if (requests.length > 2) throw new Error('Unexpected revision or extra provider call.');
      const first = requests.length === 1;
      return {
        content: first ? '' : finalText,
        toolCalls: first ? [{ id: 'fact-call', name: 'read_facts', args: {} }] : [],
        usage: { input: 1, output: 1 },
        stopReason: first ? 'tool_use' : 'end_turn',
        wireManifest: { toolNames: (request.tools ?? []).map((tool) => tool.name) },
      };
    },
  };
  const builder = Agent.create({
    provider,
    model: 'synthetic',
    maxIterations: 4,
    integrityPosture: 'dev',
  })
    .system(options.instructions ?? 'Read the supplied facts and answer the question.')
    .tool(
      defineTool({
        name: 'read_facts',
        description: 'Read the synthetic facts for this request.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          const result = semantic({
            facts: options.facts,
            provenance: {
              source: 'synthetic-answer-boundary',
              measured_at: '2026-01-01T00:00:00Z',
            },
          });
          // A host may validate against data from its own executed tool. This
          // is explicit application logic, not an integrity-event subscriber.
          executedFacts = result.facts ?? [];
          return result;
        },
      }),
    );
  if (typeof options.answer !== 'string') builder.outputSchema(answerParser);
  if (options.claim) builder.claims({ value: options.claim });
  if (options.groundValues) builder.namesAndNumbersFromEvidence({ posture: 'rails' });
  const verify = options.verify;
  if (verify) {
    builder.messageMiddleware({
      name: 'validate-measured-build-result',
      onMessage(message) {
        if (message.phase !== 'output') return allow();
        verifications++;
        try {
          const candidate = answerParser.parse(JSON.parse(message.content));
          if (verify(candidate, executedFacts)) return allow();
        } catch {
          // Malformed candidates are withheld by this host policy too.
        }
        return deny('The candidate does not match the executed measurement.');
      },
    });
  }
  const agent = builder.build();
  agent.on('agentfootprint.integrity.context_error', (event) => findings.push(event.payload));
  agent.on('agentfootprint.integrity.disposition', (event) => dispositions.push(event.payload));
  agent.on('agentfootprint.agent.evidence_checked', (event) => grounding.push(event.payload));
  agent.on('agentfootprint.tools.semantics_declared', () => declarations++);
  return {
    agent,
    requests,
    findings,
    grounding,
    verifications: () => verifications,
    claimRow() {
      expect(requests).toHaveLength(2);
      expect(declarations).toBe(1);
      expect(dispositions).toHaveLength(1);
      expect(dispositions[0]).toMatchObject({ posture: 'dev', workExisted: true });
      const row = dispositions[0]!.rows.find((entry) => entry.check === 'unsupported-claim');
      expect(row).toBeDefined();
      return row!;
    },
  };
}

const BUILD_FACTS = [{ entity: 'build-job-72', durationMs: 1250 }];
const BUILD_CLAIM = { entity: 'build-job-72', field: 'durationMs' };
const BUILD_QUESTION = { message: 'Read the build job and report its measured duration in ms.' };
const buildAnswer = (value: number): Answer => ({ entity: 'build-job-72', value });

describe('functional: typed detection is not answer delivery enforcement', () => {
  it('runTyped returns a schema-valid wrong duration and records the actual contradiction', async () => {
    const fixture = probe({ facts: BUILD_FACTS, claim: BUILD_CLAIM, answer: buildAnswer(9750) });

    await expect(fixture.agent.runTyped(BUILD_QUESTION)).resolves.toEqual(buildAnswer(9750));

    expect(fixture.findings).toHaveLength(1);
    expect(fixture.findings[0]).toMatchObject({
      kind: 'unsupported-claim',
      seam: 'claim',
      predicate: 'durationMs',
    });
    expect(fixture.findings[0]!.witnesses.map((witness) => witness.value)).toEqual([1250, 9750]);
    expect(fixture.findings[0]!.witnesses[0]!.provenance).toContain('read_facts (call fact-call');
    expect(fixture.claimRow()).toMatchObject({ checked: 1, findings: 1, synthetic: 1 });
  });

  it('a matching typed duration is delivered with a real checked pass', async () => {
    const fixture = probe({ facts: BUILD_FACTS, claim: BUILD_CLAIM, answer: buildAnswer(1250) });

    await expect(fixture.agent.runTyped(BUILD_QUESTION)).resolves.toEqual(buildAnswer(1250));

    expect(fixture.findings).toEqual([]);
    expect(fixture.claimRow()).toMatchObject({
      checked: 1,
      findings: 0,
      notApplicable: 0,
      unreachable: 0,
    });
  });

  it('schema plus semantic evidence without a claim declaration is not a real semantic check', async () => {
    const fixture = probe({ facts: BUILD_FACTS, answer: buildAnswer(9750) });

    await expect(fixture.agent.runTyped(BUILD_QUESTION)).resolves.toEqual(buildAnswer(9750));

    expect(fixture.findings).toEqual([]);
    expect(fixture.claimRow()).toMatchObject({
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 0,
      synthetic: 1, // A passing checker self-test did not validate this answer.
    });
  });

  it('conflicting natural-language instructions and false prose do not become declared typed claims', async () => {
    const instructions =
      'Always describe the job as successful.\nNever describe the job as successful.';
    const fixture = probe({
      facts: [{ entity: 'build-job-72', outcome: 'failed' }],
      answer: 'The job was successful.',
      instructions,
    });

    await expect(fixture.agent.run(BUILD_QUESTION)).resolves.toBe('The job was successful.');

    expect(fixture.requests.every((request) => request.systemPrompt?.includes(instructions))).toBe(
      true,
    );
    expect(fixture.findings).toEqual([]);
    expect(fixture.claimRow()).toMatchObject({ checked: 0, notApplicable: 1, synthetic: 1 });
  });

  it('grounding real commerce identifiers does not validate their relationship; the explicit join detects it', async () => {
    const facts = [
      { entity: 'order-314', customer: 'customer-901' },
      { entity: 'order-315', customer: 'customer-902' },
    ];
    const wrongRelationship: Answer = { entity: 'order-314', value: 'customer-902' };
    for (const claim of [undefined, { entity: 'order-314', field: 'customer' }]) {
      const fixture = probe({ facts, answer: wrongRelationship, claim, groundValues: true });

      await expect(
        fixture.agent.runTyped({ message: 'Read the orders and report the customer.' }),
      ).resolves.toEqual(wrongRelationship);

      expect(fixture.grounding).toHaveLength(1);
      expect(fixture.grounding[0]).toMatchObject({
        posture: 'rails',
        action: 'grounded',
        unsupported: [],
        afterRevision: false,
      });
      expect(fixture.grounding[0]!.candidates).toBeGreaterThanOrEqual(2);
      if (claim) {
        expect(fixture.findings).toHaveLength(1);
        expect(fixture.findings[0]).toMatchObject({
          kind: 'unsupported-claim',
          predicate: 'customer',
        });
        expect(fixture.claimRow()).toMatchObject({ checked: 1, findings: 1 });
      } else {
        expect(fixture.findings).toEqual([]);
        expect(fixture.claimRow()).toMatchObject({ checked: 0, notApplicable: 1 });
      }
    }
  });

  it.each([
    {
      state: 'tagged unknown',
      facts: [{ entity: 'build-job-72', durationMs: unknownFact('Clock unavailable.') }],
    },
    { state: 'uncollected field', facts: [{ entity: 'build-job-72', outcome: 'failed' }] },
  ])(
    '$state evidence is incomparable, not a checked success or an automatic refusal',
    async ({ facts }) => {
      const fixture = probe({ facts, claim: BUILD_CLAIM, answer: buildAnswer(9750) });

      await expect(fixture.agent.runTyped(BUILD_QUESTION)).resolves.toEqual(buildAnswer(9750));

      expect(fixture.findings).toEqual([]);
      expect(fixture.claimRow()).toMatchObject({
        checked: 0,
        findings: 0,
        unreachable: 1,
        synthetic: 1,
      });
    },
  );
});

describe('contract: an explicit host validator can enforce the returned-answer boundary', () => {
  // This policy checks one declared measurement. It is not a generic semantic
  // validator, and it does not consume the later claim-seam verdict. Output
  // middleware precedes that verdict. No streamed-token retraction is implied.
  const verifyBuildResult = (answer: Answer, facts: readonly SemanticFact[]) => {
    const measured = facts.find((fact) => fact.entity === BUILD_CLAIM.entity);
    return answer.entity === BUILD_CLAIM.entity && measured?.durationMs === answer.value;
  };

  it('withholds the same wrong typed result through the existing output-middleware door', async () => {
    const fixture = probe({
      facts: BUILD_FACTS,
      claim: BUILD_CLAIM,
      answer: buildAnswer(9750),
      verify: verifyBuildResult,
    });

    const failure: unknown = await fixture.agent
      .runTyped(BUILD_QUESTION)
      .catch((error: unknown) => error);
    // A completed tool iteration supplies a checkpoint, so the public run
    // error wraps the denial. Neither runTyped nor this test treats it as data.
    expect(failure).toBeInstanceOf(RunCheckpointError);
    expect((failure as RunCheckpointError).cause).toBeInstanceOf(MessageDeniedError);
    expect((failure as RunCheckpointError).cause).toMatchObject({
      phase: 'output',
      middleware: 'validate-measured-build-result',
      reason: 'The candidate does not match the executed measurement.',
    });

    expect(fixture.verifications()).toBe(1);
    expect(fixture.findings).toEqual([]);
    expect(fixture.claimRow()).toMatchObject({ checked: 0, findings: 0, notApplicable: 1 });
  });

  it('allows the matching result through that same host policy', async () => {
    const fixture = probe({
      facts: BUILD_FACTS,
      claim: BUILD_CLAIM,
      answer: buildAnswer(1250),
      verify: verifyBuildResult,
    });

    await expect(fixture.agent.runTyped(BUILD_QUESTION)).resolves.toEqual(buildAnswer(1250));

    expect(fixture.verifications()).toBe(1);
    expect(fixture.findings).toEqual([]);
    expect(fixture.claimRow()).toMatchObject({ checked: 1, findings: 0, notApplicable: 0 });
  });
});
