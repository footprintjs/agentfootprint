/**
 * 71 — coverage in plain words for a report: `short`, `kind` and a skill `title`.
 *
 * A coverage item's `what` is written for the model and for an engineer — it
 * names the tables a tool read. A person reading an account of the answer
 * wants the same ground in five words, wants to know whether an unchecked
 * item is about EXISTENCE (is that name even a storage array?), and wants the
 * skill called by its plain name. Three declared fields say so:
 *
 *   - `short` on any coverage item — a short plain form of `what`;
 *   - `kind` on a not-checked / cannot-cover item — `'existence' | 'scope'`;
 *   - `title` on `defineSkill` — the skill's plain name.
 *
 * All three are RECORD-ONLY. This example proves it: the same run with and
 * without them sends the model byte-identical requests, while the record
 * (`tools.absent`, `skill.graph_declared`) carries them — and `tool_end`
 * keeps the tool's envelope as `result` beside what the model read as
 * `modelResult`.
 *
 * Run:  npm run example examples/features/71-coverage-for-a-report.ts
 */

import { Agent, absent, defineTool, type LLMProvider } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/71-coverage-for-a-report',
  title: 'Coverage in plain words — short, kind and a skill title, on the record and never in the request',
  group: 'features',
  description:
    'A lookup that found nothing declares a short form and a kind for each coverage item, and its ' +
    'skill a plain title; the record carries all three while the model reads byte-identical requests.',
  defaultInput: 'what applications are running on powerstore SHPSTRPLPCL003',
  // Scripted on purpose: the point is a byte comparison of two runs, which a
  // live model would not answer identically twice.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** The lookup's miss, with or without the report-only words. */
function miss(declare: boolean) {
  const words = (short: string, kind?: 'existence' | 'scope') =>
    declare ? { short, ...(kind !== undefined && { kind }) } : {};
  return absent({
    what: 'a VM disk in the RVTools export attributed to the array asked',
    checked: [
      {
        what: 'vDisk and vm_rdm_map: every VM disk in the RVTools export dated 2026-09-19',
        ...words('every VM disk in the RVTools export of 2026-09-19'),
      },
    ],
    notChecked: [
      {
        what: 'whether that name is a storage array, and which VM disks are on it',
        why: 'this tool places disks, it does not list arrays',
        ...words('whether that name is a storage array', 'existence'),
      },
      {
        what: 'hosts that are not VMware — AIX LPARs and physical servers',
        why: 'RVTools sees VMware only',
        ...words('hosts that are not VMware', 'scope'),
      },
    ],
  });
}

async function once(input: string, declare: boolean) {
  const requests: string[] = [];
  const inner = mock({
    replies: [
      { toolCalls: [{ id: 'call-1', name: 'get_array_inventory', args: {} }] },
      { content: 'No VM disk in the export is attributed to that name.' },
    ],
  });
  const recording: LLMProvider = {
    name: inner.name,
    complete: async (req) => {
      requests.push(JSON.stringify(req.messages));
      return inner.complete(req);
    },
  };
  const tool = defineTool({
    name: 'get_array_inventory',
    description: 'VM disks per storage array, from the RVTools export',
    inputSchema: { type: 'object', properties: {} },
    execute: () => miss(declare),
  });
  const skill = defineSkill({
    id: 'array-inventory',
    description: 'arrays, volumes and the VMs on them',
    body: 'Answer from the array inventory.',
    tools: [tool],
    ...(declare && { title: 'array estate report' }),
  });
  const agent = Agent.create({ provider: recording, model: 'small-model', maxIterations: 3 })
    .system('You answer storage questions.')
    .skillGraph(skillGraph().entry(skill).build())
    .build();
  const absences: Record<string, unknown>[] = [];
  const ends: Record<string, unknown>[] = [];
  const nodes: { readonly id: string; readonly title?: string }[] = [];
  agent.on('agentfootprint.tools.absent', (e) => absences.push(e.payload as never));
  agent.on('agentfootprint.stream.tool_end', (e) => ends.push(e.payload as never));
  agent.on('agentfootprint.skill.graph_declared', (e) => nodes.push(...e.payload.nodes));
  const answer = await agent.run({ message: input });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return { answer, requests, absences, ends, nodes };
}

export async function run(input: string): Promise<string> {
  const plain = await once(input, false);
  const declared = await once(input, true);

  console.log('1. The model read the same bytes either way:');
  check(
    JSON.stringify(declared.requests) === JSON.stringify(plain.requests),
    'byte-identical requests',
  );
  console.log(`   ${declared.requests.length} requests, identical.\n`);

  console.log('2. The record carries the report-only words (tools.absent):');
  const notChecked = declared.absences[0]?.notChecked as { short?: string; kind?: string }[];
  for (const item of notChecked) console.log(`   - ${item.short}  [${item.kind}]`);
  check(notChecked[0]?.kind === 'existence', 'the existence item on the record');
  console.log('');

  console.log('3. tool_end keeps the tool\'s envelope and what the model read:');
  const end = declared.ends[0]!;
  check(JSON.stringify(end.result).includes('"short"'), 'the result keeps short');
  check(!JSON.stringify(end.modelResult).includes('"short"'), 'the model read no short');
  check(!('modelResult' in plain.ends[0]!), 'no stamp when nothing is declared');
  console.log('   result: with short/kind · modelResult: without them\n');

  const node = declared.nodes.find((n) => n.id === 'array-inventory');
  console.log(`4. The skill's plain name on graph_declared: "${String(node?.title)}"`);
  check(node?.title === 'array estate report', 'the title on the record');

  return declared.answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
