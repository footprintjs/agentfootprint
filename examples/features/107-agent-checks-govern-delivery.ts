/**
 * 107 — the agent's own checks govern delivery: `answerValidation({ agentChecks })`.
 *
 * On their own, `.claims()` and `.namesAndNumbersFromEvidence()` RECORD what
 * they find and hand the answer back anyway. Listed in `agentChecks`, a typed
 * field that contradicts the fact a tool settled — or a value no tool result
 * carried — is a failed row of the enforcing validation: the answer is withheld
 * (no draft token streams) and `run()` throws `AnswerValidationError`. Under
 * `posture: 'guard'` the gate's one repair turn runs first, tools still on the
 * wire, and only what survives it is withheld.
 *
 * Run:  npm run example examples/features/107-agent-checks-govern-delivery.ts
 */

import {
  Agent,
  AnswerValidationError,
  defineTool,
  describedResult,
  type AnswerValidationOptions,
  type OutputSchemaParser,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/107-agent-checks-govern-delivery',
  title: "The agent's own checks govern delivery — withhold a contradicted or invented answer",
  group: 'features',
  description:
    'answerValidation({ agentChecks }) turns a .claims() contradiction or an invented value into a ' +
    'failed row of an enforcing validation, so the answer is withheld instead of only recorded.',
  defaultInput: 'How long did build-job-72 take?',
  // Scripted on purpose: the verdicts are pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'evidence', 'security'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

interface BuildReport {
  readonly job: string;
  readonly durationMs: number;
}
const buildReport: OutputSchemaParser<BuildReport> = {
  parse(value) {
    const candidate = value as Partial<BuildReport> | null;
    if (typeof candidate?.job !== 'string' || typeof candidate.durationMs !== 'number') {
      throw new Error('job and durationMs are required');
    }
    return { job: candidate.job, durationMs: candidate.durationMs };
  },
};

// A tool that SETTLES a typed fact: durationMs(build-job-72) = 1250.
const readBuild = defineTool({
  name: 'read_build',
  description: 'Read one build job.',
  inputSchema: { type: 'object', properties: { job: { type: 'string' } } },
  execute: () =>
    describedResult({
      facts: [{ entity: 'build-job-72', durationMs: 1250 }],
      provenance: { source: 'ci-export', measuredAt: '2026-10-01T09:00:00Z' },
    }),
});

/** The scripted model: one tool call, its answer, and — when asked — its repair. */
function agentAnswering(answer: BuildReport, repair?: BuildReport) {
  const replies = [
    { toolCalls: [{ id: 'call-1', name: 'read_build', args: { job: 'build-job-72' } }] },
    { content: JSON.stringify(answer) },
    ...(repair !== undefined ? [{ content: JSON.stringify(repair) }] : []),
  ];
  // #region agent-checks
  const validation: AnswerValidationOptions<BuildReport> = {
    id: 'build-report',
    version: '1',
    mode: 'enforce',
    // The agent's own checks join yours: a contradicted claim or an invented
    // value fails this report, so enforce withholds the answer.
    agentChecks: ['claims', 'names-and-numbers'],
    // Your check: what only the app knows — the job the person asked about.
    validate: (answer) => ({
      checks: [
        {
          id: 'asked-job',
          disposition: answer.job === 'build-job-72' ? 'checked-pass' : 'checked-fail',
        },
      ],
    }),
  };

  const agent = Agent.create({ provider: mock({ replies }), model: 'small-model' })
    .tool(readBuild)
    .outputSchema(buildReport)
    .claims({ durationMs: { entity: 'build-job-72', field: 'durationMs' } })
    // 'guard': an invented value first gets ONE repair turn, tools on the wire.
    .namesAndNumbersFromEvidence({ posture: 'guard' })
    .answerValidation(validation)
    .build();
  // #endregion agent-checks
  return agent;
}

const READ = { job: 'build-job-72', durationMs: 1250 };
const INVENTED = { job: 'build-job-72', durationMs: 9750 };

export async function run(input: string): Promise<string> {
  // 1. The answer agrees with the fact the tool settled: delivered unchanged.
  //    Your check is what passed the report — the agent's rows withhold an
  //    answer, they never verify one (agreement is `not-applicable`).
  const agreeingAgent = agentAnswering(READ);
  const agreeing = await agreeingAgent.run({ message: input });
  check(agreeing === JSON.stringify(READ), 'the agreeing answer to be delivered');
  const passedBy = agreeingAgent
    .answerValidation()
    ?.checks.filter((c) => c.disposition === 'checked-pass')
    .map((c) => c.id);
  check(passedBy?.join() === 'asked-job', 'only your check to pass the report');

  // 2. The answer invents 9750; its repair turn reads 1250 back: delivered.
  const repaired = await agentAnswering(INVENTED, READ).run({ message: input });
  check(repaired === JSON.stringify(READ), 'the repaired answer to be delivered');

  // 3. The repair keeps 9750: withheld, every failed row saying why.
  const agent = agentAnswering(INVENTED, INVENTED);
  const refused = await agent.run({ message: input }).catch((error: unknown) => error);
  check(refused instanceof AnswerValidationError, 'the contradicted answer to be withheld');
  const report = (refused as AnswerValidationError).report;
  const failed = report.checks.filter((c) => c.disposition === 'checked-fail').map((c) => c.id);
  check(
    failed.join() === 'agent:names-and-numbers,agent:claims:durationMs',
    'both agent rows to fail',
  );

  return `agrees → delivered · repaired → delivered · kept → ${report.status} (${failed.join(', ')})`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
