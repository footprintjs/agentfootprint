/**
 * 99 — an output guard that sees which tools ran: `context.toolCalls`.
 *
 * The rule: "the answer presents code, but no code-execution tool ran" fails
 * the run. `.answerValidation()` in `mode: 'enforce'` holds the reply (no draft
 * token streams) until the check passes; a failure throws
 * `AnswerValidationError` and nothing is delivered or remembered.
 *
 * The check reads THIS run's tool calls: name, call id and outcome
 * (`ok` / `error` / `not-run`). Never arguments, never results.
 *
 * Run:  npm run example examples/features/99-guard-presented-code.ts
 */

import {
  Agent,
  AnswerValidationError,
  defineTool,
  type AnswerCheck,
  type AnswerValidationOptions,
  type OutputSchemaParser,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/99-guard-presented-code',
  title: 'An output guard that sees which tools ran — refuse code that was never executed',
  group: 'features',
  description:
    'answerValidation reads context.toolCalls (name, call id, outcome — no arguments or results) and ' +
    'fails the run when the answer presents code but no code-execution tool ran.',
  defaultInput: 'What does 2 + 2 print in Python?',
  // Scripted on purpose: the verdicts are pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'tools', 'security'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

interface Reply {
  text: string;
}
const reply: OutputSchemaParser<Reply> = {
  parse(value) {
    const candidate = value as Partial<Reply> | null;
    if (typeof candidate?.text !== 'string') throw new Error('text is required');
    return { text: candidate.text };
  },
};

const runCode = defineTool({
  name: 'run_code',
  description: 'Execute Python and return its output.',
  inputSchema: { type: 'object', properties: { source: { type: 'string' } } },
  execute: async () => '4',
});

// #region guard
const presentedCodeWasExecuted: AnswerValidationOptions<Reply> = {
  id: 'presented-code-was-executed',
  version: '1',
  mode: 'enforce',
  validate(answer, context) {
    // The parser already required `text`; this is the check that always runs.
    const checks: AnswerCheck[] = [{ id: 'answer-is-text', disposition: 'checked-pass' }];
    if (!answer.text.includes('```')) {
      // No code shown: nothing to hold, and the tool list is never read — a
      // check that reads an incomplete list is refused as unverified.
      checks.push({ id: 'code-was-executed', disposition: 'not-applicable' });
      return { checks };
    }
    const executed = context.toolCalls.calls.some(
      (call) => call.name === 'run_code' && call.outcome === 'ok',
    );
    checks.push({
      id: 'code-was-executed',
      disposition: executed ? 'checked-pass' : 'checked-fail',
      ...(!executed && { reason: 'code was presented but never executed' }),
    });
    return { checks };
  },
};
// #endregion guard

const CODE = JSON.stringify({ text: 'It prints 4:\n```python\nprint(2 + 2)\n```' });

function agentWith(replies: unknown[]) {
  return Agent.create({ provider: mock({ replies: replies as never }), model: 'small-model' })
    .tool(runCode)
    .outputSchema(reply)
    .answerValidation(presentedCodeWasExecuted)
    .build();
}

export async function run(input: string): Promise<string> {
  // 1. The model ran the code first: delivered.
  const ran = agentWith([
    { toolCalls: [{ id: 'call-1', name: 'run_code', args: { source: 'print(2 + 2)' } }] },
    { content: CODE },
  ]);
  const delivered = await ran.run({ message: input });
  check(delivered === CODE, 'the executed answer to be delivered');

  // 2. The model only claimed it: refused before any consumer sees it.
  const claimed = agentWith([{ content: CODE }]);
  const refused = await claimed.run({ message: input }).catch((error: unknown) => error);
  check(refused instanceof AnswerValidationError, 'the unexecuted answer to be refused');
  const report = (refused as AnswerValidationError).report;
  check(report.status === 'failed', 'a failed report');
  const failed = report.checks.find((c) => c.disposition === 'checked-fail');

  return `ran → delivered · claimed → ${report.status} (${failed?.reason})`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
