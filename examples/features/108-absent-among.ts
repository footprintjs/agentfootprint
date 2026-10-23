/**
 * 108 — a name that resolves to nothing is a named miss over the names read.
 *
 * A lookup checks a name against one inventory export and finds nothing. That
 * is a search over one list, not a fact about the estate. A study of two
 * models found that a refusal saying "a wrong identifier, not missing data"
 * made replies WORSE: the models told users the array did not exist.
 *
 * So the tool declares the list it searched, and the library composes the rest:
 *
 *   absent({ what: array_id,
 *            among: { argument, source, measuredAt, count, names, visible: 'caller' } })
 *
 *   - `checked` gains the names facet: the 25 names listed in the export;
 *   - `not_checked` gains a gap the author cannot remove: names outside that
 *     export (only `authoritative: { why }` drops it, and the gate lists it);
 *   - the model reads the count and, because the tool read the list under the
 *     caller's own identity, the 20 names nearest the one asked for;
 *   - the names are never part of the result: no rule, event or row sees them —
 *     the library attaches them to the model's message alone.
 *
 * Then the build gate: `check:semantics` warns about a refusal that says what
 * does not exist (`refusal-asserts-absence`).
 *
 * Run:  npm run example examples/features/108-absent-among.ts
 */

import { absent, Agent, defineTool, type DeclaredCoverage } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { checkSemantics } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/108-absent-among',
  title: 'A missed name is a named miss over the names read — absent({ among })',
  group: 'features',
  description:
    'An array lookup finds nothing in one inventory export. absent({ what, among }) composes the ' +
    'names facet and an irremovable "names outside the export" gap; the model reads the count and ' +
    'the 20 nearest names (caller-visible only); no event field carries them; check:semantics ' +
    'warns about a refusal that says what does not exist.',
  defaultInput: 'Show me array PS-ARRAY-99.',
  // Scripted on purpose: the inventory and the miss are the tool's data.
  providerSlots: [],
  tags: ['features', 'tools', 'evidence'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** The inventory export the tool reads under the caller's own identity. */
const inventory = {
  source: 'the PowerStore inventory export',
  readAt: '2026-10-22T09:14:00Z',
  names: Array.from({ length: 25 }, (_, i) => `PS-ARRAY-${String(i + 1).padStart(2, '0')}`),
};

// #region absent-among
const arrayDetail = defineTool({
  name: 'array_detail',
  description: 'Details of one PowerStore array, by name.',
  inputSchema: {
    type: 'object',
    properties: { array_id: { type: 'string', pattern: '^PS-' } },
    required: ['array_id'],
  },
  execute: ({ array_id }: { array_id: string }) => {
    if (inventory.names.includes(array_id)) return { array_id, model: 'PowerStore 1200T' };
    // A miss over ONE list: say which list, and let the library add the gap.
    return absent({
      what: array_id,
      among: {
        argument: 'array_id',
        source: inventory.source,
        measuredAt: inventory.readAt,
        count: inventory.names.length,
        names: inventory.names,
        visible: 'caller', // read under the caller's own identity
      },
    });
  },
});
// #endregion absent-among

function build() {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'array_detail', args: { array_id: 'PS-ARRAY-99' } }] },
        {
          content:
            'PS-ARRAY-99 is not among the 25 arrays in the PowerStore inventory export read at ' +
            '09:14. The nearest name there is PS-ARRAY-09.',
        },
      ],
    }),
    model: 'small-model',
  })
    .tool(arrayDetail)
    .limitsTravelWithTheAnswer()
    .build();
}

export async function run(input: string): Promise<string> {
  const agent = build();
  const toolEnds: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) => toolEnds.push({ ...e.payload }));
  const answer = String(await agent.run({ message: input }));
  console.log(answer);

  // The gap travels with the answer, beside what was checked.
  check(
    answer.includes('names outside the PowerStore inventory export'),
    'the answer to carry the irremovable gap',
  );
  const state = agent.getLastSnapshot()?.sharedState as { coverageDeclared?: DeclaredCoverage[] };
  const row = state.coverageDeclared?.[0];
  console.log('\nthe coverageDeclared row:', JSON.stringify(row?.notChecked));
  check(row?.notChecked[0]?.kind === 'scope', 'the gap to be recorded as a scope gap');

  // The names reached the model's message alone — never the result an event carries.
  const ended = JSON.stringify(toolEnds[0]?.result);
  check(
    ended.includes('names outside') && !ended.includes('known_names'),
    'tool_end without names',
  );

  // #region overclaim-gate
  const report = checkSemantics([
    {
      name: 'array_detail',
      results: [],
      refusals: ["No array matches 'PS-ARRAY-99'. This is a wrong identifier, not missing data."],
    },
  ]);
  // → one warning: refusal-asserts-absence (an error under --strict or rules: ['overclaim'])
  // #endregion overclaim-gate
  const codes = report.findings.map((f) => `${f.code} (${f.severity})`);
  console.log('\ncheck:semantics:', codes.join(', '));
  check(report.ok && codes[0] === 'refusal-asserts-absence (warning)', 'one overclaim warning');
  return `gap recorded · ${codes.length} gate warning`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
