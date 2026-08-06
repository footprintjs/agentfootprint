/**
 * 46 — Skill graph: the check-up learns about entries, bare edges and your baseline tools.
 *
 * WHY THIS EXISTS (the rationale, for humans + coding agents):
 * A check-up is only worth running if it reports what is actually true. Three things
 * were not (8.7.0):
 *
 *   1. **An entry MENU with no way to choose from it was silent.** Declare two entries
 *      and no `.entryBy()` / `.entryByRead()`, and BOTH bodies load on every call while
 *      exactly ONE of them can be the cursor. Worse, an entry declared after an
 *      unconditional one can never be the cold-start cursor at all — so a `step` out of
 *      it never fires from there. The check-up said nothing; the run just quietly did
 *      less than the author declared.
 *   2. **A bare `.route(a, b)` counted as reachability.** It compiles to no trigger:
 *      `b` keeps `llm-activated`, and the model has to ASK for it — from `a` and
 *      nowhere else. Calling that "reachable" answered a question nobody asked.
 *   3. **Your `.tool()` names were invisible to it.** A body saying `lookup_order(id)`
 *      was reported as naming a tool that exists nowhere, because a graph only knows
 *      the tools its own skills carry.
 *
 * And the default: the fluent `.build()` used `check: 'warn'`, so a graph with NO ENTRY
 * — a graph that cannot start a turn — built in silence outside dev mode while the
 * byte-identical object form threw. Both forms now default to `'throw'`.
 *
 * None of the new codes is an error. Every one of them describes something a
 * `read_skill` pick can still reach, and erroring on reachable would claim more than
 * the declaration supports.
 *
 * Run:  npx tsx examples/features/46-skill-graph-checkup-deepens.ts
 */

import { defineTool, type LLMProvider } from '../../src/index.js';
import { skillGraph, defineSkill, formatCheckup, keywordScorer } from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/46-skill-graph-checkup-deepens',
  title: 'Skill graph — the check-up learns about entries, bare edges and baseline tools',
  group: 'features',
  description:
    'Three new check-up codes (multi-entry-fanout, dead-entry-step, model-edge-only), an unreachable-skill message told per trigger kind, checkup({ knownTools }) so a baseline .tool() stops reading as a typo, and the fluent .build() default moving to `throw` so a graph that cannot start no longer builds in silence. Every new code is a WARNING — each names something a read_skill pick can still reach.',
  defaultInput: '(no input — pure build-time validation)',
  providerSlots: [],
  tags: ['feature', 'skills', 'graph', 'validation', 'checkup'],
};

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} ok` });

const sk = (id: string, body = `${id} body`) =>
  defineSkill({ id, description: `the ${id} skill`, body, tools: [tool(`${id}_tool`)] });

const summarize = (problems: readonly { kind: string; code: string; skill?: string }[]) =>
  problems.map((p) => `[${p.kind}] ${p.code}${p.skill ? ` → ${p.skill}` : ''}`);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function run(_input: string, _provider?: LLMProvider): Promise<unknown> {
  const triage = sk('triage');
  const billing = sk('billing');
  const refund = sk('refund');
  const incident = sk('incident');

  // ── 1. multi-entry-fanout + dead-entry-step ────────────────────────────────
  // Two entries, no way to choose. `triage` has no `when`, so it ALWAYS wins the
  // cold-start cursor — which means `billing` is never the cursor at turn start, and
  // the step out of it can never fire from there.
  const fanout = skillGraph()
    .entry(triage)
    .entry(billing)
    .route(billing, refund, { onToolReturn: 'billing_tool' })
    .build({ check: 'off' });

  // The fix the messages name: rank the menu, and exactly one entry loads.
  const ranked = skillGraph()
    .entry(triage)
    .entry(billing)
    .entryBy(keywordScorer())
    .build({ check: 'off' });

  // ── 2. model-edge-only ─────────────────────────────────────────────────────
  // A BARE route: no `when`, no `onToolReturn`. `incident` keeps `llm-activated` —
  // nothing in the graph activates it, and the gate grants a read_skill for it only
  // while the cursor is on `triage`.
  const bare = skillGraph().entry(triage).route(triage, incident).build({ check: 'off' });

  // ── 3. unreachable-skill, told per TRIGGER KIND ────────────────────────────
  // `refund` is listed and wired to nothing, so it keeps `llm-activated` — the case
  // the old sentence described correctly. A skill carrying a hand-authored `rule`
  // trigger keeps THAT, and read_skill cannot open it, so it gets a different line.
  const gated = { ...sk('ledger'), trigger: { kind: 'rule' as const, activeWhen: () => false } };
  const unwired = skillGraph({
    skills: [triage, refund, gated],
    start: 'triage',
    check: 'off',
  });

  // ── 4. checkup({ knownTools }) ─────────────────────────────────────────────
  // The agent registers `lookup_order` with .tool(); the graph cannot see it.
  const withBaseline = skillGraph({
    skills: [
      defineSkill({
        id: 'orders',
        description: 'the orders skill',
        body: 'First call lookup_order(id), then explain the status.',
        tools: [tool('orders_tool')],
      }),
    ],
    start: 'orders',
    check: 'off',
  });

  // ── 5. the .build() default ────────────────────────────────────────────────
  const caught = (fn: () => unknown): string => {
    try {
      fn();
      return '(built — no refusal)';
    } catch (e) {
      return (e as Error).message.split('\n').slice(0, 2).join(' | ');
    }
  };

  return {
    // Two warnings, no errors — the build still succeeds.
    fanout_problems: summarize(fanout.checkup().problems),
    fanout_deadStepMessage: fanout
      .checkup()
      .problems.find((p) => p.code === 'dead-entry-step')?.message,
    // Ranking the menu is the fix, and the warning goes away.
    ranked_problems: summarize(ranked.checkup().problems),

    bare_problems: summarize(bare.checkup().problems),
    bare_modelEdgeMessage: bare.checkup().problems.find((p) => p.code === 'model-edge-only')
      ?.message,
    // The gate agrees with the message: reachable from `triage`, not from cold start.
    bare_grantableFromTriage: bare.reachableSkills('triage'),
    bare_grantableAtColdStart: bare.reachableSkills(undefined),

    // Same code, two different (and both true) sentences.
    unwired_messages: unwired
      .checkup()
      .problems.filter((p) => p.code === 'unreachable-skill')
      .map((p) => `${p.skill}: ${p.message}`),

    knownTools_before: summarize(withBaseline.checkup().problems), // body-unknown-tool
    knownTools_after: summarize(withBaseline.checkup({ knownTools: ['lookup_order'] }).problems), // []

    // `formatCheckup` is public now — this is what to print in CI.
    formatted: formatCheckup(bare.checkup()),

    // A graph with no entry cannot start a turn. Both forms now say so.
    fluentNoEntry: caught(() =>
      skillGraph().route(triage, billing, { onToolReturn: 'x' }).build(),
    ),
    objectNoEntry: caught(() =>
      skillGraph({ skills: [triage, billing], steps: [{ from: 'triage', to: 'billing', onToolReturn: 'x' }] }),
    ),
    // …and `check: 'warn'` still means what its name says: never throws.
    fluentNoEntryWarnMode: caught(() =>
      skillGraph().route(triage, billing, { onToolReturn: 'x' }).build({ check: 'warn' }),
    ),
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
