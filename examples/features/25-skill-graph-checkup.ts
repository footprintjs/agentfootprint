/**
 * 25 — Skill graph: build-time check-up, the object-literal form, and the refusals.
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
 * A check-up REPORTS; some declarations are past reporting. Four combinations can
 * never work — one of the two routing declarations is compiled out, or two skills
 * claim one id — so instead of dropping half of what you wrote, the library refuses
 * it and names the fix (8.4.0). They are shown at the bottom.
 *
 * Run:  npx tsx examples/features/25-skill-graph-checkup.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js'
import { skillGraph, defineSkill, decideSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/25-skill-graph-checkup',
  title: 'Skill graph — build-time check-up + object form + the refusals',
  group: 'features',
  description:
    'graph.checkup() / .build({ check }) flags unreachable skills, unknown ids, ambiguous routes, no-entry, and self-loops before you run. The object-literal form lists skills independently of the wiring so the check-up catches a listed-but-unwired skill. Past reporting: the five declarations the library refuses outright, each message naming the fix.',
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

  // ── What is past reporting: the four refusals (8.4.0) ──────────────────────
  // Each of these used to compile, drop half of what was declared, and say
  // nothing — two of them even reported `{ ok: true, problems: [] }`.
  const refused = (fn: () => unknown): string => {
    try {
      fn();
      return '(no refusal — this should not happen)';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const refusals = {
    // 1. A tree and the flat wiring both declare the routing; only the tree compiles.
    treePlusFlat: refused(() =>
      skillGraph().entry(triage).tree(decideSkill(() => true, billing, refund)).build(),
    ),
    // 2. Same trap in the config vocabulary (the TYPE refuses this pair too).
    treePlusStart: refused(() =>
      // @ts-expect-error — SkillGraphConfig is a union: `tree` and `start` cannot coexist
      skillGraph({ skills: [billing, refund], tree: decideSkill(() => true, billing, refund), start: 'billing' }),
    ),
    // 3. A tree routes only to its leaves, so a listed non-leaf never loads.
    strandedUnderTree: refused(() =>
      skillGraph({ skills: [triage, billing, refund], tree: decideSkill(() => true, billing, refund) }),
    ),
    // 4. Two different skills claiming one id — last (or first) write used to win.
    duplicateId: refused(() => {
      const otherTriage = defineSkill({
        id: 'triage',
        description: 'a SECOND triage skill (from the shared catalog)',
        body: 'other body',
      });
      return skillGraph({ skills: [triage, otherTriage], start: 'triage', check: 'off' });
    }),
    // 5. One agent routes with ONE graph.
    twoGraphs: refused(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
        .skillGraph(clean)
        .skillGraph(viaObject),
    ),
  };

  return {
    cleanGraph: clean.checkup(), // { ok: true, problems: [] }
    flawedGraph: flawed.checkup().problems.map((p) => `[${p.kind}] ${p.code}: ${p.skill ?? p.from ?? ''}`),
    // 'orphan' is wired to nothing — a WARNING, not an error, because the model can
    // still reach it with read_skill (true again since 8.4.0: a skill the graph does
    // not wire is open from any cursor). See example 23.
    objectForm_findsOrphan: viaObject
      .checkup()
      .problems.filter((p) => p.code === 'unreachable-skill')
      .map((p) => p.skill), // ['orphan']
    buildThrowOnError: threw, // "skillGraph: build-time check-up failed: …no-entry…"
    refusals,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
