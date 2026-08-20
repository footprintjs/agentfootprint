/**
 * 20 — Keep the evidence: the window kept the task and threw away the facts.
 *
 * This is a real failure, reproduced. An agent drives a screen through tools.
 * One tool — `whats_here` — returns the list of ids it is allowed to act on.
 * Everything after that is actuator traffic: pan, zoom, focus. Under
 * `slidingWindow({ keepRecentTurns: 2 })` the `whats_here` result survives
 * about two iterations, because an assistant message plus its tool results is
 * ONE turn, so two kept turns are two tool rounds.
 *
 * Since 9.55.0 the user's REQUEST is undroppable. So the model still knows
 * exactly what it was asked to do — and no longer has the evidence to do it.
 * What it does next, measured across five recorded runs, is invent: it takes
 * an entity name it remembers and the shape of an id it used earlier and
 * assembles `aix-lab-01-single-path`, which has never existed. The tool
 * refuses. An action is gone. In one archived run the final answer to the
 * person named a host that appears in no tool result at all.
 *
 * Run it and watch the same conversation twice:
 *
 *   npx tsx examples/context-engineering/20-keep-the-evidence.ts
 *
 *   BEFORE  keepLastToolResults: false  → the holds leave the window, the
 *           model reaches for an id it half-remembers, the tool refuses.
 *   AFTER   the default (2)             → the holds stay, by name, on the
 *           record; the actuator traffic still drops; the answer is right.
 *
 * Two more things this prints, because a framework that keeps something has
 * to be as visible as one that removes something:
 *
 *   • `WindowRecord.observations` — which turns the pin held, which tool each
 *     came from, and their exact character cost. Subtract them from
 *     `windowCharsAfter` and you have the window without the feature.
 *   • `WindowRecord.droppedObservations` + the drop notice — when a tool
 *     result DOES leave, the model is told by name and told to call the tool
 *     again rather than reconstruct anything from memory.
 */

import {
  Agent,
  defineTool,
  slidingWindow,
  type LLMMessage,
  type LLMProvider,
  type WindowRecord,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/20-keep-the-evidence',
  title: 'Keep the evidence — the last-tool-result pin',
  group: 'context-engineering',
  description:
    'Runs one screen-driving conversation twice — with the last-tool-result ' +
    'pin off and on — and shows the model inventing an id when the evidence ' +
    'was evicted, then getting it right when the window kept it.',
  defaultInput: 'Walk the floor and tell me which rack is hottest',
  providerSlots: ['default'],
  tags: ['context-engineering', 'context-window', 'showcase'],
};

/** The ids that really exist. Nothing else is a valid hold. */
const REAL_HOLDS = ['aix-lab-01-rack-a', 'aix-lab-01-rack-b', 'aix-lab-02-rack-a'];

/** The observation tool: bulky, and the only place the ids ever appear. */
const whatsHere = defineTool({
  name: 'whats_here',
  description: 'List everything currently on screen, with its hold id.',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    `SCREEN CONTENTS\n` +
    REAL_HOLDS.map((h) => `  hold=${h}  temp=${28 + REAL_HOLDS.indexOf(h) * 4}C`).join('\n') +
    `\n` +
    `context line that costs bytes and says nothing\n`.repeat(30),
});

/** The actuator: called constantly, answers in six words. */
const focus = defineTool({
  name: 'focus',
  description: 'Focus the view on one hold id.',
  inputSchema: {
    type: 'object',
    properties: { hold: { type: 'string' } },
    required: ['hold'],
  },
  execute: (args: { hold: string }) =>
    REAL_HOLDS.includes(args.hold)
      ? `focused on ${args.hold}`
      : `REFUSED: no such hold '${args.hold}'`,
});

/**
 * A model that behaves like the recorded one: it looks once, drives for a
 * while, and then — when it has to name a hold again — reads it out of the
 * window if it is there, and GUESSES if it is not.
 *
 * The guess is the whole point, so it is written honestly rather than
 * simulated: the script searches the window it was actually handed. Nothing
 * here knows which run it is in.
 */
function screenDriver(rounds: number): { provider: LLMProvider; invented: string[] } {
  const invented: string[] = [];
  let call = 0;
  return {
    invented,
    provider: {
      name: 'mock',
      complete: async (req) => {
        call++;
        const usage = { input: 40_000, output: 20 };
        if (call === 1) {
          return {
            content: '',
            toolCalls: [{ id: `c${call}`, name: 'whats_here', args: {} }],
            usage,
            stopReason: 'tool_use',
          };
        }
        // Can it still SEE a hold id? Only if the observation is in context.
        const seen = (req.messages as readonly LLMMessage[])
          .map((m) => /hold=([a-z0-9-]+)/.exec(m.content)?.[1])
          .find((h): h is string => h !== undefined);
        if (call > rounds) {
          return {
            content: seen
              ? `The hottest rack is ${REAL_HOLDS[REAL_HOLDS.length - 1]}.`
              : `The hottest rack is ${invented[invented.length - 1] ?? 'aix-lab-01'}.`,
            toolCalls: [],
            usage,
            stopReason: 'stop',
          };
        }
        // The reach: a remembered entity name plus the shape of an id it used
        // earlier. Plausible, and wrong.
        const hold = seen ?? 'aix-lab-01-single-path';
        if (seen === undefined) invented.push(hold);
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'focus', args: { hold } }],
          usage,
          stopReason: 'tool_use',
        };
      },
    },
  };
}

interface Outcome {
  readonly answer: string;
  readonly invented: readonly string[];
  readonly refusals: number;
  readonly holdsInWindowAtEnd: boolean;
  readonly records: readonly WindowRecord[];
}

async function driveScreen(keepLastToolResults: number | false): Promise<Outcome> {
  // #region dial
  const script = screenDriver(7);
  const agent = Agent.create({
    provider: script.provider,
    model: 'mock-model',
    maxIterations: 12,
    // The one line this example is about. `false` is 9.56.0 behaviour; the
    // default is 2. It is on `Agent.create` and not on the strategy, so a
    // window strategy you wrote yourself inherits it too.
    keepLastToolResults,
  })
    .tool(whatsHere)
    .tool(focus)
    .window(slidingWindow({ keepRecentTurns: 2 }))
    .build();
  // #endregion dial

  let refusals = 0;
  agent.on('agentfootprint.stream.tool_end', (e) => {
    if (String(e.payload.result ?? '').startsWith('REFUSED')) refusals++;
  });

  const answer = await agent.run({ message: meta.defaultInput ?? '' });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  const state = agent.getLastSnapshot()?.sharedState as
    | { history?: readonly LLMMessage[]; compactions?: readonly WindowRecord[] }
    | undefined;
  return {
    answer,
    invented: script.invented,
    refusals,
    holdsInWindowAtEnd: (state?.history ?? []).some((m) => m.content.includes('hold=')),
    records: state?.compactions ?? [],
  };
}

function report(label: string, outcome: Outcome): void {
  console.log(`\n── ${label} ──────────────────────────────────`);
  console.log(`  the ids were still in context at the end : ${outcome.holdsInWindowAtEnd}`);
  console.log(
    `  ids the model invented                   : ` +
      (outcome.invented.length === 0 ? 'none' : outcome.invented.join(', ')),
  );
  console.log(`  actions wasted on a refused call          : ${outcome.refusals}`);
  console.log(`  final answer                             : ${outcome.answer}`);
}

// #region record
/** What the window kept, what it threw away, and what it cost — from the record. */
function reportWindowRecord(records: readonly WindowRecord[]): void {
  console.log('\n── what the record says ──────────────────────────');
  for (const r of records) {
    const parts: string[] = [`iteration ${r.iteration}: removed ${r.removedMessageCount}`];
    if (r.droppedObservations !== undefined) {
      parts.push(`results lost from [${r.droppedObservations.join(', ')}]`);
    }
    if (r.observations !== undefined) {
      const held = r.observations.pinned
        .map((p) => `${p.toolName} (turn ${p.turnIndex}, ${p.chars} chars)`)
        .join(', ');
      parts.push(held.length > 0 ? `KEPT ${held}` : 'pin stood down');
      if (r.observations.yielded > 0) {
        parts.push(`${r.observations.yielded} turned away at the ceiling`);
      }
    }
    console.log(`  ${parts.join(' · ')}`);
  }
}
// #endregion record

export async function run(_input: string): Promise<string> {
  const before = await driveScreen(false);
  report('BEFORE — keepLastToolResults: false (9.56.0 behaviour)', before);

  const after = await driveScreen(2);
  report('AFTER — the default (2)', after);

  reportWindowRecord(after.records);

  // The drop notice: when a tool result DOES leave, the model is told.
  const withDrop = after.records.find((r) => (r.droppedObservations?.length ?? 0) > 0);
  if (withDrop !== undefined) {
    console.log('\n── the model was told, in words ──────────────────');
    console.log(
      `  the record names [${withDrop.droppedObservations!.join(', ')}], and the notice in the\n` +
        `  window says: "Tool results are among them (…) — call the tool again if you need\n` +
        `  its output; do not reconstruct ids or values from memory."`,
    );
  }

  return after.answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
