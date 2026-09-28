/**
 * 76 — the answer's standing, folded INSIDE the run: `.answerLayer()`.
 *
 * Example 73 reads an answer's standing AFTER the run (`agent.assessment()`,
 * `assessAnswer(recording)`). The answer layer runs the SAME fold inside the
 * run — as the first stage of the final branch, after every check has filed
 * its verdict — and serves the result as data, the moment the answer exists:
 *
 *   - `turn_end.answerAssessment` and ONE `agentfootprint.answer.assessed`
 *     event: the value, its word, the reason kinds, the checks that ran —
 *     never a value from the answer;
 *   - two committed witness rows the Route decider files while the layer is
 *     armed: the evidence gate's clean pass (`grounded` — the names-and-numbers
 *     check RAN, which lifts an answer from "not assessed" to "consistent",
 *     never to "known") and an answer given before a skill's declared steps
 *     finished (`steps-unfinished`);
 *   - under its own arm, `{ standingLine: true }`, ONE line appended to a prose
 *     answer. The layer never edits the model's words; the line comes after
 *     the separator.
 *
 * The in-run standing and the read-after standing are one fold over the same
 * committed rows, so they are equal — the example checks it.
 *
 * Run:  npm run example examples/features/76-answer-layer.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import { assessAnswer, recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/76-answer-layer',
  title: 'The answer’s standing, in the run — turn_end, one event, and an opt-in line',
  group: 'features',
  description:
    '.answerLayer() folds the answer’s standing at the head of the final branch and serves it as ' +
    'data (turn_end.answerAssessment, agentfootprint.answer.assessed); { standingLine: true } adds ' +
    'one line to a prose answer. The in-run standing equals the fold of the saved recording.',
  defaultInput: 'Which ports on switch A are down?',
  // Scripted on purpose: the standing is pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

const PORTS = { switch: 'A', down: [{ port: 'eth1/7', since: '09:14' }] };

// #region answer-layer
function portsAgent(execute: () => unknown, answer: string) {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'list_down_ports', args: { switch: 'A' } }] },
        { content: answer },
      ],
    }),
    model: 'small-model',
  })
    .tool(
      defineTool({
        name: 'list_down_ports',
        description: 'Ports that are down on one switch',
        inputSchema: { type: 'object', properties: { switch: { type: 'string' } } },
        execute,
      }),
    )
    .namesAndNumbersFromEvidence({ posture: 'assist' }) // the gate whose clean pass is a witness
    .answerLayer({ standingLine: true }) // the standing as data — and one line for the person
    .build();
}

async function answerWithStanding(execute: () => unknown, answer: string, question: string) {
  const agent = portsAgent(execute, answer);
  let inRun: unknown;
  agent.on('agentfootprint.answer.assessed', (e) => {
    const { assessment, standing, reasons, checked } = e.payload;
    inRun = { assessment, standing, reasons, checked }; // the value, its word, the reason kinds, the checks that ran
  });
  const recorder = recordRun(agent);
  const text = (await agent.run({ message: question })) as string;
  const saved = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();

  // The same fold, read afterwards from the saved recording, says the same thing.
  const after = assessAnswer(saved);
  check(
    JSON.stringify(inRun) ===
      JSON.stringify({
        assessment: after.assessment,
        standing: after.standing,
        reasons: after.reasons.map((r) => r.reason),
        checked: after.checked.map(({ layer, check, ran, of }) => ({ layer, check, ran, of })),
      }),
    'the in-run standing to equal the read-after fold',
  );
  return { text, standing: after.standing, reasons: after.reasons.map((r) => r.reason) };
}
// #endregion answer-layer

export async function run(input: string): Promise<string> {
  const silent = await answerWithStanding(() => [], 'No ports on switch A are down.', input);
  const rows = await answerWithStanding(() => PORTS, 'Port eth1/7 on switch A is down.', input);

  console.log(`bare [] → ${silent.standing} (${silent.reasons.join(', ')})`);
  console.log(silent.text);
  console.log(`rows    → ${rows.standing}`);
  console.log(rows.text);

  check(silent.standing === 'not-sure', 'a bare [] to read "not sure"');
  check(
    silent.text.endsWith(
      '\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.',
    ),
    'the line after the separator',
  );
  check(silent.text.startsWith('No ports on switch A are down.'), 'the model’s words untouched');
  check(rows.standing === 'consistent', 'grounded rows to read "consistent" — never "known"');
  return `${silent.standing} · ${rows.standing}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
