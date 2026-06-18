/**
 * 25 — Skill graph: build-time check-up + the object-literal form.
 *
 * WHY THIS EXISTS (the rationale, for humans + coding agents):
 * A skill graph is a state machine; a wiring mistake (a skill nobody can reach, two
 * un-prioritized edges from one skill, no entry) should fail at AUTHORING time, not
 * surface mid-run. `graph.checkup()` inspects the declared graph like a spell-checker;
 * `.build({ check })` runs it at build. The OBJECT-LITERAL form earns its keep here:
 * by listing `skills` INDEPENDENTLY of the wiring, the check-up can flag a skill that
 * was listed but never wired — the fluent builder only ever sees skills that appear
 * in an edge, so it can't.
 *
 * Run:  npx tsx examples/features/25-skill-graph-checkup.ts
 */

import { skillGraph, defineSkill, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/25-skill-graph-checkup',
  title: 'Skill graph — build-time check-up + object form',
  group: 'features',
  description:
    'graph.checkup() / .build({ check }) flags unreachable skills, unknown ids, ambiguous routes, no-entry, and self-loops before you run. The object-literal form lists skills independently of the wiring so the check-up catches a listed-but-unwired skill.',
  defaultInput: '(no input — pure build-time validation)',
  providerSlots: [],
  tags: ['feature', 'skills', 'graph', 'validation', 'checkup'],
};

const sk = (id: string) => defineSkill({ id, description: `the ${id} skill`, body: `${id} body` });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function run(_input: string, _provider?: LLMProvider): Promise<unknown> {
  const triage = sk('triage');
  const billing = sk('billing');
  const refund = sk('refund');
  const orphan = sk('orphan');
  const incident = sk('incident');

  // A clean, well-wired graph → the check-up is happy.
  const clean = skillGraph()
    .entry(triage)
    .route(triage, billing, { onToolReturn: 'get_invoice' })
    .route(billing, refund, { when: (r) => /refund/.test(r.result) })
    .build();

  // A deliberately-flawed graph (built with check:'off' so we can inspect it) — two
  // predicate edges from `triage` (ambiguous), and `incident` reachable from nothing.
  const flawed = skillGraph()
    .entry(triage)
    .route(triage, billing, { when: (r) => /a/.test(r.result) })
    .route(triage, refund, { when: (r) => /b/.test(r.result) }) // 2nd predicate edge from triage → ambiguous
    .route(incident, billing, { onToolReturn: 'page' }) // incident is unreachable from the entry
    .build({ check: 'off' });

  // The OBJECT form: `skills` listed independently → the check-up sees `orphan`
  // even though no edge references it (the fluent builder never would).
  const viaObject = skillGraph({
    skills: [triage, billing, orphan],
    start: 'triage',
    steps: [{ from: 'triage', to: 'billing', onToolReturn: 'get_invoice', label: 'invoice' }],
    check: 'off', // so we can show the problems instead of throwing
  });

  // .build({ check: 'throw' }) fails loud on an ERROR-level problem (here: no entry).
  let threw = '';
  try {
    skillGraph().route(triage, billing, { onToolReturn: 'x' }).build({ check: 'throw' });
  } catch (e) {
    threw = (e as Error).message.split('\n')[0]!;
  }

  return {
    cleanGraph: clean.checkup(), // { ok: true, problems: [] }
    flawedGraph: flawed.checkup().problems.map((p) => `[${p.kind}] ${p.code}: ${p.skill ?? p.from ?? ''}`),
    objectForm_findsOrphan: viaObject
      .checkup()
      .problems.filter((p) => p.code === 'unreachable-skill')
      .map((p) => p.skill), // ['orphan']
    buildThrowOnError: threw, // "skillGraph: build-time check-up failed: …no-entry…"
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
