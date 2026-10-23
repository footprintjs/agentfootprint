/**
 * 108 — a tool declares what its search is made of; the library composes each
 * call's coverage from the arguments the call ran with.
 *
 * An incident tool finds nothing for `payments`. "No incidents" is not what it
 * checked: it searched OPEN incidents, in the incident store, for the last two
 * hours, at any severity — and incidents filed by email never reach the store.
 * A model reading a bare empty list says "payments has no incidents". A prose
 * note written by the tool author is no better: a note that overstates what
 * was checked made replies worse in a registered study.
 *
 * So the tool declares, ONCE and as typed data, what one call searches —
 * every argument classified, every default and built-in qualifier named — and
 * returns `absent({ what, checked: 'declared' })`. The dispatch funnel composes
 * the coverage from the arguments the call actually sent:
 *
 *   - the model reads `checked` as typed items (`service: payments`,
 *     `status: open`, `window: 2h`, `severity: any`), the gaps as
 *     `not_checked` / `cannot_cover`, and `complete`;
 *   - the committed `coverageDeclared` row carries every value, at a
 *     library-minted address (`resultId`), never a provider's call id;
 *   - the `tools.absent` event carries constants and references only.
 *
 * Composition can only under-claim: leave out an argument with no declared
 * default and the row names it as not checked, and is not complete.
 *
 * Run:  npm run example examples/features/108-tool-search.ts
 */

import {
  Agent,
  absent,
  defineTool,
  isComposedCoverage,
  type DeclaredCoverage,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/108-tool-search',
  title: 'Tool.search — coverage composed from the arguments the call ran with',
  group: 'features',
  description:
    'An incident tool declares what one call searches (the store, open incidents, each argument ' +
    'by role, a default window, a blind spot) and returns absent({ what, checked: "declared" }). ' +
    'The library composes the coverage from the arguments sent: the model reads typed items, the ' +
    'gaps and complete; the record keeps every value at a library-minted address.',
  defaultInput: 'Any open incidents on payments?',
  // Scripted on purpose: the composed row is a function of the call, not of the model.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region tool-search
const listIncidents = defineTool({
  name: 'list_incidents',
  description: 'Open incidents for one service',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string' },
      severity: { type: 'string' },
      window: { type: 'string' },
      limit: { type: 'integer' },
      format: { type: 'string' },
    },
    required: ['service'],
  },
  search: {
    source: { what: 'the incident store', said: ['the incident store', 'the store'] },
    subject: { what: 'incidents', said: ['incident', 'incidents'] },
    fixed: [{ name: 'status', value: 'open', said: ['open'] }], // built in: part of the scope
    arguments: [
      // EVERY input property, classified
      { name: 'service', role: 'population' },
      { name: 'severity', role: 'filter', whenOmitted: { any: true } }, // omitted = no narrowing
      { name: 'window', role: 'period', whenOmitted: '2h' }, // a default: composed as if sent
      { name: 'limit', role: 'cap', whenOmitted: 200 },
      { name: 'format', role: 'inert' },
    ],
    complete: 'within-arguments', // absent = never complete
    gaps: [{ what: 'incidents filed by email', why: 'they never enter the store', bears: 'source' }],
  },
  execute: ({ service }: { service: string }) =>
    // Nothing matched. The declaration says what was searched; the library composes it.
    absent({ what: `open incidents on ${service}`, checked: 'declared' }),
});
// #endregion tool-search

function build() {
  return Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'list_incidents', args: { service: 'payments' } }],
        },
        {
          content:
            'No open incidents on payments in the incident store for the last two hours. ' +
            'Incidents filed by email are not in the store.',
        },
      ],
    }),
    model: 'small-model',
  })
    .tool(listIncidents)
    .build();
}

export async function run(input: string): Promise<string> {
  const agent = build();
  const answer = String(await agent.run({ message: input }));
  console.log(answer);

  const state = agent.getLastSnapshot()?.sharedState as { coverageDeclared?: DeclaredCoverage[] };
  const row = state.coverageDeclared?.[0];
  check(row !== undefined && isComposedCoverage(row), 'a composed row');
  if (row === undefined || !isComposedCoverage(row)) return 'no row';
  console.log('\nchecked:', row.checked.map((i) => `${i.what} (${i.from})`).join(' · '));
  console.log('gaps:', row.gaps.map((g) => `${g.kind}: ${g.what}`).join(' · '));
  console.log('complete:', row.complete, '· address:', row.resultId);
  check(
    row.checked.some((i) => i.what === 'service: payments' && i.from === 'call'),
    'the sent population value, from the call',
  );
  check(
    row.checked.some((i) => i.what === 'window: 2h' && i.from === 'default'),
    'the default window, composed as if sent',
  );
  check(row.checked.some((i) => i.what === 'status: open'), 'the fixed qualifier');
  check(row.complete, 'a complete search: every argument in effect, no cap reached');
  check(row.resultId.startsWith('claim-result/'), 'a library-minted address');
  return `complete: ${row.complete} · ${row.checked.length} facets · ${row.gaps.length} gap`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
