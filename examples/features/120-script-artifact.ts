/**
 * 120 — Code in an answer: the script travels with the answer, labelled from
 * the run record.
 *
 * A data agent runs a script and hands it back in the answer, because the
 * app's rule is "always show the script". Read as prose, a format spec
 * (`{mean:.2f}`) and a constant in the code become values to ground — and the
 * cheapest revision that passes the check is to DELETE the script.
 *
 *   1. MATCH    — `namesAndNumbersFromEvidence({ code: 'match' })`: a fenced
 *                 block that equals, byte for byte, a program this turn's
 *                 call submitted is script content — no value candidates,
 *                 labelled with the call's outcome. Code is never evidence:
 *                 a value in the prose still needs a tool result.
 *   2. ATTACH   — `.scriptTravelsWithTheAnswer()`: the library appends the
 *                 recorded program itself, under the answer, labelled from
 *                 the execution record. The model never retypes it.
 *   3. LABELS   — only an explicit exit code proves the program reached an
 *                 exit; a bare runner verdict is reported as what the runner
 *                 said; a timeout is "outcome unknown"; a tool that filed no
 *                 runner facts is "tool call returned; execution not
 *                 confirmed".
 *   4. A MISS   — a block that is NOT the program submitted (one constant
 *                 changed) stays prose, checked as today, labelled unmatched.
 *
 * Parts 1–3 run the code for real with `localCodeRunner` (a child process on
 * this machine — process isolation, not a sandbox) in JavaScript; the
 * service-style answers use an in-memory runner standing in for a managed
 * sandbox. The model is the mock provider: $0, deterministic.
 *
 * Run:  npx tsx examples/features/120-script-artifact.ts
 */

import {
  Agent,
  codeRunnerTool,
  defineTool,
  type CodeResult,
  type CodeRunner,
  type LLMProvider,
} from '../../src/index.js';
import { localCodeRunner, mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/120-script-artifact',
  title: 'Code in an answer — the script travels with the answer',
  group: 'features',
  description:
    "A code-running tool declares it runs a program (Tool.script; codeRunnerTool does), and each call files the program it was handed and what its runner reported. Under code: 'match' a fenced block equal byte for byte to that program is script content — no value candidates, labelled with the call's outcome — and any other block stays prose. .scriptTravelsWithTheAnswer() attaches the recorded program itself under the answer, labelled only with what the record proves: an explicit exit code, a runner's bare verdict, an unknown outcome, or a call that returned with no runner facts.",
  defaultInput: 'What is the total of the three orders?',
  providerSlots: ['default'],
  tags: ['feature', 'evidence', 'code-interpreter', 'honesty', 'scripts'],
};

/** A JavaScript program the model writes — and must not have to retype. */
const PROGRAM =
  'const orders = [1200, 2400, 365];\nconsole.log(orders.reduce((a, b) => a + b, 0));';
const fenced = (program: string) => `\`\`\`javascript\n${program}\n\`\`\``;

/** A model that runs `program`, then answers with `answer`. */
function analyst(program: string, answer: string, tool = 'run_code'): LLMProvider {
  return mock({
    replies: [
      { toolCalls: [{ id: 'c1', name: tool, args: { code: program } }] },
      { content: answer },
    ],
  });
}

/** An in-memory runner standing in for a managed sandbox that answers `result`. */
function service(result: CodeResult): CodeRunner {
  return {
    id: 'service-stand-in',
    start: async () => ({
      id: 's1',
      execute: async () => result,
      stop: async () => undefined,
    }),
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // #region script-artifact
  // 1 + 2. MATCH and ATTACH — a real run, the program shown back byte for byte.
  const agent = Agent.create({
    provider: provider ?? analyst(PROGRAM, `The total is 3965.\n\n${fenced(PROGRAM)}`),
    model: 'mock',
  })
    .tool(codeRunnerTool({ runner: localCodeRunner(), language: 'javascript' }))
    .namesAndNumbersFromEvidence({ posture: 'guard', code: 'match' })
    .scriptTravelsWithTheAnswer({ which: 'last', maxBytes: 4_000 })
    .build();

  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
    // [{ block: 1, label: 'completed', exitCode: 0, toolCallId: 'c1', tool: 'run_code' }]
    console.log('evidence_checked.scripts:', JSON.stringify(payload.scripts?.blocks));
  });
  agent.on('agentfootprint.agent.turn_end', ({ payload }) => {
    // The attachment as data, for a host that renders its own code block.
    const shown = payload.scripts?.shown[0];
    console.log('turn_end.scripts:', shown?.label, shown?.exitCode, `${shown?.bytes} bytes`);
  });

  const answer = await agent.run({ message: input });
  // The answer, the model's words, then — after `---` — the library's copy:
  // "Script submitted to run_code on call c1 — completed, exit 0. Attached by
  //  the library from the run record:" and the program in its own fence.
  console.log(String(answer));
  // #endregion script-artifact

  // 3. LABELS — what each record proves, and nothing more.
  console.log('\n3. LABELS — only an explicit exit code proves an exit\n');
  const cases: Array<[string, CodeRunner | 'declared', string]> = [
    // A real non-zero exit after partial work: completed with failure, exit 7.
    ['non-zero exit', localCodeRunner(), 'console.log("row 1"); process.exit(7);'],
    // A real timeout: the runner stopped waiting and reported nothing.
    ['timeout', localCodeRunner({ timeoutMs: 200 }), 'setTimeout(() => {}, 5000);'],
    // A service that says "ok" with no exit code: what the runner reported.
    ['bare verdict', service({ ok: true, stdout: '3965', stderr: '' }), PROGRAM],
    // A service error with no exit code: whether the program ran is not known.
    [
      'service error',
      service({ ok: false, serviceError: true, stdout: '', stderr: 'refused' }),
      PROGRAM,
    ],
    // A declared tool that returns without running its argument.
    ['no runner facts', 'declared', PROGRAM],
  ];
  for (const [name, runner, program] of cases) {
    const tool =
      runner === 'declared'
        ? defineTool<{ code: string }, string>({
            name: 'run_code',
            description: 'Accepts a program and acknowledges it.',
            inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
            script: { argument: 'code', language: 'javascript' },
            execute: () => 'accepted',
          })
        : codeRunnerTool({ runner, language: 'javascript' });
    const labelled = await Agent.create({ provider: analyst(program, 'Done.'), model: 'mock' })
      .tool(tool)
      .scriptTravelsWithTheAnswer()
      .build()
      .run({ message: 'run it' });
    const labelLine = String(labelled)
      .split('\n')
      .find((l) => l.startsWith('Script submitted'));
    console.log(`  ${name.padEnd(16)} ${labelLine}`);
  }

  // 4. A MISS — one constant changed: not the program submitted.
  console.log('\n4. A MISS — a block that is not the program submitted stays prose\n');
  const altered = PROGRAM.replace('2400', '2500');
  const missed = Agent.create({
    provider: analyst(PROGRAM, `The total is 3965.\n\n${fenced(altered)}`),
    model: 'mock',
  })
    .tool(codeRunnerTool({ runner: localCodeRunner(), language: 'javascript' }))
    .namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' })
    .build();
  missed.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
    console.log('  scripts   :', JSON.stringify(payload.scripts?.blocks));
    console.log('  unsupported:', JSON.stringify(payload.unsupported));
  });
  await missed.run({ message: input });

  return String(answer);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
