/**
 * 18 — Examples on start rules: the three things a check-up can PROVE.
 *
 * Two rules can use two different regexes and still fight over one sentence —
 * and comparing the regexes cannot settle it (this library never decides regex
 * intersection, only identity). So write the sentence down. `examples` is the
 * list of phrasings a rule CLAIMS: read at build time, fed to nothing at run
 * time, and byte-identical routing either way.
 *
 * This example builds the graph with the bug on purpose (`check: 'off'`, so the
 * report can be printed instead of thrown) and shows all three properties:
 *
 *   • example-misses-own-rule     (error)   — the rule rejects its own example
 *   • example-shadowed-by-earlier (error)   — an EARLIER rule claims it first
 *   • example-unclaimed           (warning) — NO rule claims it: the turn falls
 *                                             through to the model tier
 *
 * The last two are the failures that motivated the feature, seen in production:
 * an earlier product-name rule swallowing an inventory rule's phrase (two
 * different regexes — matcher comparison is honestly silent about that), and a
 * phrase nothing matched, which reached the model tier, where an array name that
 * looks like a hostname got the wrong skill.
 *
 * No model call, no credentials — the check-up is pure build-time analysis.
 */

import { defineSkill, skillGraph, formatCheckup } from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/18-start-rule-examples',
  title: 'Examples on start rules — proof by witness phrase',
  group: 'context-engineering',
  description:
    "Declare the phrasings a start rule claims; the check-up runs the compiled matchers over " +
    'them in declaration order and proves three things a matcher comparison cannot: a rule ' +
    'that misses its own example, an earlier rule that steals it, and a phrase nothing claims.',
  defaultInput: '',
  providerSlots: [],
  tags: ['context-engineering', 'skill-graph', 'routing', 'checkup'],
};

export async function run(_input: string): Promise<string> {
  const powerstoreHealth = defineSkill({
    id: 'powerstore-health',
    description: 'Health of a PowerStore box.',
    body: 'Check the box, then the alerts.',
  });
  const arrayInventory = defineSkill({
    id: 'array-inventory',
    description: 'What is running on a storage array.',
    body: 'List the volumes, then the hosts attached.',
  });
  const capacityReport = defineSkill({
    id: 'capacity-report',
    description: 'Capacity trends and forecasts.',
    body: 'Pull the last 30 days, then project.',
  });

  // #region examples
  const graph = skillGraph({
    skills: [powerstoreHealth, arrayInventory, capacityReport],
    start: {
      rules: [
        {
          // This rule's author knew PowerStore boxes are named `shpstr…` — and
          // so are the arrays. It sits FIRST, so it claims them both.
          use: 'powerstore-health',
          match: /\bpowerstore\b|\bshpstr[a-z]*\d+\b/i,
          examples: ['is powerstore healthy'],
        },
        {
          // A longer alternation. Its own phrasing is claimed by the rule above,
          // and the two matchers are different regexes — so only a WITNESS
          // phrase can decide it.
          use: 'array-inventory',
          match: /\b(array|volume|pool|shpstrprncl\d+)\b/i,
          examples: ["what's running on shpstrprncl101"],
        },
        {
          // A typo (`capcity`) and a phrase no rule in this graph matches.
          use: 'capacity-report',
          match: /\bcapcity\b/i,
          examples: ['how full is the estate'],
        },
      ],
    },
    // Print the report instead of throwing on it — the defect IS the demo.
    check: 'off',
  });

  const report = graph.checkup();
  // #endregion examples

  return [
    `ok: ${report.ok}`,
    '',
    formatCheckup(report),
    '',
    'codes, in order:',
    ...report.problems.map((p) => `  ${p.kind.padEnd(7)} ${p.code}  →  "${p.example ?? ''}"`),
  ].join('\n');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
