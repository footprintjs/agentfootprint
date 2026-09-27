/**
 * 73 — how far an answer stands: `agent.assessment()` / `assessAnswer()`.
 *
 * The standing is read from what the run COMMITTED — never from how sure the
 * model sounded. Two lookups answer the same question with the same empty
 * result, and only the record tells them apart:
 *
 *   - the first returns a bare `[]` and says nothing about what it searched —
 *     silence, recorded as silence: NOT SURE (`empty-undeclared`);
 *   - the second returns `absent({ what, checked, notChecked })` — it names
 *     where it looked and what it did not check: still NOT SURE, now with the
 *     reasons a person can act on (`coverage-gap`, `declared-absent`).
 *
 * A third lookup returns rows and declares nothing: CONSISTENT WITH THE RECORD
 * — checks ran and none fired. Never "known": only a tie to a settled fact
 * (a passed enforce `.answerValidation()` report) supports that word.
 *
 * The fold reads committed rows, so the live agent and a reader of the saved
 * recording say the same thing.
 *
 * Run:  npm run example examples/features/73-answer-standing.ts
 */

import { Agent, absent, defineTool } from '../../src/index.js';
import { assessAnswer, recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/73-answer-standing',
  title:
    'How far an answer stands — known, consistent, not sure, ask or not assessed, from the record',
  group: 'features',
  description:
    'Three lookups answer the same question; agent.assessment() folds each answer’s standing from the ' +
    'committed record — an undeclared empty result and a declared absence are both "not sure", for ' +
    'different reasons; rows with nothing declared are "consistent with the record", never "known".',
  defaultInput: 'Which ports on switch A are down?',
  // Scripted on purpose: the standing is pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region answer-standing
async function standingOf(execute: () => unknown, message: string) {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'list_down_ports', args: { switch: 'A' } }] },
        { content: 'No ports on switch A are down.' },
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
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message });
  const saved = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();

  const live = agent.assessment()!; // the last run, folded from its committed record
  const later = assessAnswer(saved); // …and the same fold over the saved recording
  check(JSON.stringify(live) === JSON.stringify(later), 'the live and the saved folds to agree');
  return live;
}
// #endregion answer-standing

export async function run(input: string): Promise<string> {
  const silent = await standingOf(() => [], input);
  const declared = await standingOf(
    () =>
      absent({
        what: 'a down port on switch A',
        checked: ['every port on switch A (live query)'],
        notChecked: ['ports on the standby supervisor'],
      }),
    input,
  );
  const rows = await standingOf(() => [{ port: 'eth1/7', state: 'down' }], input);

  const line = (label: string, a: typeof silent) =>
    `${label}: ${a.standing}${
      a.reasons.length > 0 ? ` (${a.reasons.map((r) => r.reason).join(', ')})` : ''
    } — checked: ${a.checked.map((c) => `${c.check} ${c.ran}/${c.of}`).join(', ')}`;
  console.log(line('bare []        ', silent));
  console.log(line('absent({...})  ', declared));
  console.log(line('rows           ', rows));

  check(silent.standing === 'not-sure', 'a bare [] to read "not sure"');
  check(
    silent.reasons.map((r) => r.reason).join() === 'empty-undeclared',
    'silence recorded as silence',
  );
  check(
    declared.reasons.map((r) => r.reason).join() === 'coverage-gap,declared-absent',
    'the declared absence to name its gap',
  );
  check(rows.standing === 'consistent', 'rows with nothing declared to read "consistent"');
  return `${silent.standing} · ${declared.standing} · ${rows.standing}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
