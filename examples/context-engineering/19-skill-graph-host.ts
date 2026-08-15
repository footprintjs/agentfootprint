/**
 * 19 — Routing a turn from a host that is NOT our agent (`agentfootprint/skill-graph`).
 *
 * The skill graph is a pure decision layer: declare skills and the edges
 * between them, hand it ONE iteration's `InjectionContext`, and it answers
 * three questions with plain functions over plain data — where is the cursor,
 * what is reachable from there, which injections are active. No model call,
 * no loop, no scope, no flowchart. This file runs that layer with no Agent
 * anywhere in it, which is the claim the door makes.
 *
 * THE `doc-example` REGION BELOW IS THE DOOR'S OWN `@example`. It is not a
 * copy: `test/lib/injection-engine/skill-graph-doc-example.test.ts` reads the
 * `@example` block out of `src/doors/skill-graph.ts` and fails unless it is
 * byte-identical to those lines (the one allowed difference is the import
 * specifier — an example imports `../../src/…` so it typechecks against the
 * working tree, a consumer imports `agentfootprint/skill-graph`, and the test
 * checks THAT string against package.json `exports`).
 *
 * WHY THAT MACHINERY EXISTS. Doc comments are emitted into the `.d.ts` files,
 * so the door's `@example` is what a consumer reads on hover — and until
 * 9.37.x it could not compile: it passed `entry:` (the flat config's key is
 * `start`), called `.route()`/`.build()` on the finished `SkillGraph` the
 * object form returns, and passed skill IDS to a `.route()` that takes skill
 * OBJECTS. Nothing checked it, so nothing caught it. Now the compiler does
 * (this file is typechecked by `npm run test:examples:typecheck` and RUN by
 * `scripts/run-all-examples.sh`), and the pin drags the docblock along.
 */

// #region doc-example
import {
  readSkillDescriptor,
  skillGraph,
  type Injection,
  type InjectionContext,
} from '../../src/doors/skill-graph.js';

// A foreign host builds `Injection` objects directly — five fields, all data.
// (`defineSkill` and friends live host-side, on `agentfootprint/context`.)
const triage: Injection = {
  id: 'triage',
  flavor: 'skill',
  description: 'Find the order the customer is talking about.',
  trigger: { kind: 'llm-activated', viaToolName: 'read_skill' },
  inject: { systemPrompt: 'Ask for the order id, then call lookup_order.' },
};
const billing: Injection = {
  id: 'billing',
  flavor: 'skill',
  description: 'Refunds, double charges, invoices.',
  trigger: { kind: 'llm-activated', viaToolName: 'read_skill' },
  inject: { systemPrompt: 'Confirm the charge history before promising a refund.' },
};

// The FLUENT builder takes the skill OBJECTS (not their ids) and ends in
// `.build()`. `skillGraph({ skills, start, steps })` is the OTHER door: it
// returns a finished `SkillGraph`, with nothing to chain.
const graph = skillGraph()
  .entry(triage)
  .route(triage, billing, { onToolReturn: 'lookup_order' })
  .build();

// Per iteration — ONE ctx, built once and asked every question below: a
// cursor derived from a different ctx than the triggers can disagree with
// them (obligation 1 of `SkillGraphHost`).
const ctx: InjectionContext = {
  iteration: 2,
  userMessage: 'I was charged twice for order 4021',
  history: [{ role: 'user', content: 'I was charged twice for order 4021' }],
  activatedInjectionIds: [],
  currentSkillId: 'triage',
  toolResults: [{ toolName: 'lookup_order', result: 'order 4021 · charged twice' }],
};

const move = graph.explainNextSkill(ctx); // where the cursor goes, and WHY
const offered = graph.reachableSkills(move.to); // obligation 2 — gate read_skill on this
const readSkill = readSkillDescriptor(graph.skills, { grantable: offered });
// #endregion doc-example

// Below the region on purpose: the pinned sample must be CONTIGUOUS and must
// start at its own import line — a sample whose import is written separately
// is a sample whose import nothing checks, which is how the old one shipped a
// specifier that did not exist. TypeScript hoists imports, so this reads late
// and runs first.
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/19-skill-graph-host',
  title: 'Hosting the skill graph — routing with no framework attached',
  group: 'context-engineering',
  description:
    'Run the routing layer from a host that is not our agent: build Injection ' +
    'objects by hand, declare entry/route edges, and answer one iteration — ' +
    'cursor move (with its cause), reachable set, and the read_skill descriptor ' +
    'scoped to it. No provider, no Agent, no flowchart.',
  defaultInput: 'I was charged twice for order 4021',
  providerSlots: [],
  tags: ['context-engineering', 'skill-graph', 'host', 'no-llm'],
};

export async function run(_input: string): Promise<string> {
  // The tool result the host collected last iteration fired the declared edge,
  // so the cursor moves triage → billing with `by: 'route'` — evidence, not a
  // guess about what the model felt like doing.
  const lines = [
    `cursor: ${move.from ?? '(cold)'} → ${move.to ?? '(none)'}  [by: ${move.by}]`,
    `reachable from there: ${offered.join(', ') || '(none)'}`,
    `read_skill enum: ${JSON.stringify(
      (readSkill?.inputSchema as { properties?: { id?: { enum?: string[] } } } | undefined)
        ?.properties?.id?.enum ?? [],
    )}`,
    // The graph is drawable because it is declared — same data, other renderer.
    graph.toMermaid(),
  ];
  return lines.join('\n');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
