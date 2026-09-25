/**
 * 72 — explain an answer in plain words: `accountForAnswer`.
 *
 * A person reading an answer wants to know what it rests on: what was asked,
 * how the question was routed, what the tools checked and did NOT check, what
 * they found, how sure the answer is — and whether anything looks wrong. The
 * record already holds all of it; `accountForAnswer` reads it back as seven rows
 * of fixed sentences. No model writes them: every line comes from a versioned
 * template, carries its template id, and names who vouches for it — the person,
 * the library's own record, a tool's declaration, the model, or the app.
 *
 * Here the lookup declares that it did NOT check whether the name is a storage
 * array at all (`kind: 'existence'`), so the account flags it — a signal, not a
 * verdict — and the one-liner says so, vouched by the tool.
 *
 * Run:  npm run example examples/features/72-explain-an-answer.ts
 */

import { Agent, absent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/doors/context.js';
import { keywordScorer } from '../../src/doors/skill-graph.js';
import { accountForAnswer, recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/72-explain-an-answer',
  title:
    'Explain an answer in plain words — every line from the record, each with who vouches for it',
  group: 'features',
  description:
    'A lookup that found nothing declares what it did not check; accountForAnswer reads the recording ' +
    'back as seven rows of fixed sentences, each with its template id and its voucher, and flags the gap.',
  defaultInput: 'what applications are running on powerstore SHPSTRPLPCL003',
  // Scripted on purpose: the account is pinned word for word, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

export async function run(input: string): Promise<string> {
  const tool = defineTool({
    name: 'get_array_inventory',
    description: 'VM disks per storage array, from the RVTools export',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      absent({
        what: 'a VM disk in the RVTools export attributed to the array asked',
        checked: [
          {
            what: 'every VM disk in the RVTools export dated 2026-09-19',
            short: 'every VM disk in the export',
          },
        ],
        notChecked: [
          {
            what: 'whether that name is a storage array, and which VM disks are on it',
            short: 'whether that name is a storage array',
            kind: 'existence',
          },
        ],
      }),
  });
  const skill = defineSkill({
    id: 'array-inventory',
    title: 'array estate report',
    description: 'arrays, volumes and the VMs on them',
    body: 'Answer from the array inventory.',
    tools: [tool],
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'get_array_inventory', args: {} }] },
        { content: 'No VM disk in the export is attributed to that name.' },
      ],
    }),
    model: 'small-model',
    maxIterations: 3,
  })
    .system('You answer storage questions.')
    // A declared start rule: the routing verdict (and the words that matched) goes on the record.
    .skillGraph(
      skillGraph()
        .entry(skill, { match: { keywords: ['applications'] } })
        .classify(keywordScorer())
        .build(),
    )
    .build();

  const recorder = recordRun(agent);
  const answer = await agent.run({ message: input });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();

  const account = accountForAnswer(recording);
  for (const row of account.rows) {
    console.log(row.heading.text);
    for (const line of row.lines) {
      console.log(
        `  ${line.item ? '• ' : ''}${line.text}   [${line.template.id}@${line.template.version} · ${
          line.source
        }]`,
      );
    }
  }
  console.log(`\nIn one line (${account.summary.tone}): ${account.summary.sentence.text}`);

  check(account.signals[0]?.id === 'existence-not-checked', 'the existence gap flagged');
  check(
    account.summary.sentence.source === 'tool:get_array_inventory',
    'the one-liner vouched by the tool',
  );
  check(
    account.rows[1]!.lines[0]!.text ===
      "The library's routing picked the array estate report skill (array-inventory) because one of the app's rules matched your words “applications”.",
    'the skill called by its declared title, and the words that matched',
  );
  return account.summary.sentence.text;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
