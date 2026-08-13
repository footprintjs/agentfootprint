/**
 * 54 — Skill graph: the front door — rules as data, scoped tools on the flat arm,
 *      and body-contract checks that wait for the agent.
 *
 * WHY THIS EXISTS (the rationale, for humans + coding agents):
 * A turn ENTERS a skill graph through its start rules, and until now those rules
 * were opaque predicates the library could only run. Four upgrades, one theme —
 * declare more, so the library can check and draw more:
 *
 *   1. **Matchers as DATA.** `match: /refund/i` or `match: { keywords: [...] }`
 *      beside `when` (exactly one per rule). A predicate can only be executed; a
 *      matcher can be COMPARED (two new check-up codes), DRAWN (`toMermaid()`
 *      captions the entry edge) and STORED (the compiled skill's provenance).
 *      Keywords are case-insensitive, any-of, whole-word at word edges — `refund`
 *      does not fire on "refunds"; a regex stays exactly the author's regex.
 *      Since 9.20.0 the conjunction joins them: `match: { all: [...] }` fires
 *      only when EVERY member matches ("zone AND audit-shaped" as data instead
 *      of a lookahead regex). Members are the sync arms only — an intent inside
 *      `all` is refused (declare a separate intent rule); a nested `all` is
 *      flattened (AND is associative); the check-up sees through it (a plain
 *      rule EARLIER that covers one part shadows a later `all` rule), and
 *      `toMermaid()` captions the parts joined with ` AND `.
 *   2. **`scopeTools` on the FLAT arm.** The tree arm has scoped its leaves' tools
 *      since 8.7.0; now `skillGraph({ skills, start, steps, scopeTools: true })`
 *      stamps `autoActivate: 'currentSkill'` on every WIRED skill, so tools follow
 *      the cursor instead of all landing in the always-on registry. Default stays
 *      `false` (byte-identical builds) until 10.0.0 flips it. A skill's own
 *      explicit `autoActivate` always wins — the graph fills a default, never
 *      overrides an author.
 *   3. **New check-up codes.** `rule-id-exists` (ERROR — a rule naming a skill
 *      that is not in skills[] refuses to build, listing every bad id and the
 *      known catalog; one production consumer hand-rolled exactly this check),
 *      `overlapping-rules` and `rules-shadowed-by-order` (WARNINGS — only what
 *      the data PROVES: identical regexes, shared/superset keywords. `when`
 *      predicates are opaque, and the messages say they were NOT checked).
 *   4. **`knownTools` becomes automatic.** A graph built without `knownTools`
 *      cannot tell a body's `lokup_order(` typo from a baseline tool the agent
 *      registers later — so it now DEFERS the body-contract checks; the note
 *      rides the graph AND each compiled skill's metadata, and Agent build runs
 *      them once against the real registry whichever door the skills arrive
 *      through — `.skillGraph(graph)` or `.skills({ list: () => graph.skills })`.
 *      One problem, one report — never both build points. Manual `knownTools`
 *      stays as the override; `graph.checkup()` is unchanged.
 *
 * Run:  npx tsx examples/features/54-skill-graph-front-door.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { skillGraph, defineSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/54-skill-graph-front-door',
  title: 'Skill graph — the front door: rules as data, scoped flat tools, deferred body checks',
  group: 'features',
  description:
    'Start rules declared as data (match: RegExp | { keywords } | { all: [...] } — the 9.20.0 conjunction fires only when EVERY member matches) so the check-up can compare them (overlapping-rules, rules-shadowed-by-order) and toMermaid can caption them; rule-id-exists refuses a rule naming an unknown skill; scopeTools reaches the FLAT arm (autoActivate on every wired skill, default false until 10.0.0); and body-contract checks defer to Agent build, where the full tool registry finally exists.',
  defaultInput: '(no input — build-time declaration, validation and drawing)',
  providerSlots: [],
  tags: ['feature', 'skills', 'graph', 'validation', 'checkup', 'tools'],
};

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} ok` });

const iterCtx = (userMessage: string) => ({
  iteration: 1,
  userMessage,
  history: [],
  activatedInjectionIds: [],
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function run(_input: string, _provider?: LLMProvider): Promise<unknown> {
  // ── 1. A rule-router declared as DATA ───────────────────────────────────────
  const refunds = defineSkill({
    id: 'refunds',
    description: 'refund handling',
    body: 'Confirm the charge, then call refunds_tool(order_id).',
    tools: [tool('refunds_tool')],
  });
  const billing = defineSkill({
    id: 'billing',
    description: 'billing questions',
    body: 'Explain the statement; use billing_tool(account) for line items.',
    tools: [tool('billing_tool')],
  });
  const triage = defineSkill({
    id: 'triage',
    description: 'everything else',
    body: 'Ask one clarifying question, then hand off with read_skill(billing).',
  });
  const zoneAudit = defineSkill({
    id: 'zone-audit',
    description: 'zone-wide billing audits',
    body: 'Run the audit playbook for the named zone.',
  });

  const router = skillGraph({
    skills: [refunds, billing, triage, zoneAudit],
    start: {
      rules: [
        // The 2D case (9.20.0): a zone mention AND an audit-shaped ask — as
        // data, not a lookahead regex. Specific-first: it sits above the
        // broader rules it composes from.
        { match: { all: [/zone/i, { keywords: ['audit', 'sweep', 'all'] }] }, use: 'zone-audit' },
        { match: /refund|money back/i, use: 'refunds' },
        { match: { keywords: ['charge', 'billing statement', 'invoice'] }, use: 'billing' },
        { when: (ctx) => ctx.iteration > 1, use: 'triage' }, // predicates still work beside data
      ],
    },
    steps: [{ from: 'refunds', to: 'billing', onToolReturn: 'refunds_tool' }],
    // 2. tools follow the cursor on the FLAT arm now (default false until 10.0.0):
    scopeTools: true,
    check: 'off', // this example calls checkup() by hand below
  });

  // The router routes by data…
  const routed = {
    'I want my money back': router.nextSkill(iterCtx('I want my money back'))!,
    'a strange CHARGE appeared': router.nextSkill(iterCtx('a strange CHARGE appeared'))!,
    'my charger broke (whole-word: no match)': String(router.nextSkill(iterCtx('my charger broke'))),
    // The conjunction needs BOTH dimensions — either alone falls through:
    'AUDIT zone 4 charges (zone AND audit)': router.nextSkill(iterCtx('AUDIT zone 4 charges'))!,
    'zone 4 status (zone alone: no match)': String(router.nextSkill(iterCtx('zone 4 status'))),
  };

  // …the drawing captions the entry edges with the SAME data…
  const mermaid = router.toMermaid();

  // …and every wired skill's tools are scoped to it (an author's explicit
  // autoActivate would have been kept as-is — the graph fills a default).
  const scoped = Object.fromEntries(
    router.skills.map((s) => [s.id, (s.metadata as { autoActivate?: string }).autoActivate]),
  );

  // ── 3a. overlapping-rules / rules-shadowed-by-order — provable, and honest ──
  const sk = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });
  const overlapping = skillGraph({
    skills: [sk('cards'), sk('payments')],
    start: {
      rules: [
        { match: { keywords: ['card', 'visa'] }, use: 'cards' },
        { match: { keywords: ['card', 'wire'] }, use: 'payments' }, // shares "card" — earlier wins those
      ],
    },
    check: 'off',
  });
  const shadowed = skillGraph({
    skills: [sk('broad'), sk('narrow')],
    start: {
      rules: [
        { match: { keywords: ['pay', 'refund'] }, use: 'broad' },
        { match: { keywords: ['pay'] }, use: 'narrow' }, // ⊆ the earlier rule — can never win
      ],
    },
    check: 'off',
  });

  // ── 3b. rule-id-exists — a rule naming an unknown skill refuses to build ────
  let ruleIdRefusal = '(built — no refusal)';
  try {
    skillGraph({
      skills: [sk('real')],
      start: { rules: [{ match: /x/, use: 'ghots' }] }, // typo'd id
    });
  } catch (err) {
    ruleIdRefusal = (err as Error).message;
  }

  // ── 4. knownTools becomes automatic ─────────────────────────────────────────
  // `triage`'s body above says `read_skill(billing)`; `refunds`' body names its
  // own tool. Add one skill whose body has a REAL typo — at graph build nobody
  // can tell it from a baseline tool, so the graph defers…
  const orders = defineSkill({
    id: 'orders',
    description: 'order lookups',
    body: 'Call lookup_order(id) first; if it errors, call lokup_order(id).', // ← typo
  });
  const deferred = skillGraph({ skills: [orders], start: 'orders' });

  // …and agent build — where .tool() finally exists — runs the checks once.
  // The note rides each compiled skill's metadata too, so the OTHER documented
  // door — `.skills({ list: () => graph.skills })`, which never sees the graph
  // object — is served exactly the same way.
  const warnings: string[] = [];
  const viaSkillsWarnings: string[] = [];
  const originalWarn = console.warn;
  enableDevMode();
  try {
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(tool('lookup_order')) // the baseline tool the graph could not see
      .skillGraph(deferred)
      .build();
    console.warn = (...args: unknown[]) => viaSkillsWarnings.push(args.join(' '));
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(tool('lookup_order'))
      .skills({ list: () => deferred.skills }) // the door that never sees the graph
      .build();
  } finally {
    disableDevMode();
    console.warn = originalWarn;
  }
  const bodyContractReport = warnings.find((w) => w.includes('body-contract')) ?? '(none)';
  const bodyContractReportViaSkills =
    viaSkillsWarnings.find((w) => w.includes('body-contract')) ?? '(none)';

  return {
    routed,
    mermaid,
    scopedTools: scoped, // triage/refunds/billing → 'currentSkill'
    overlapping_warnings: overlapping.checkup().problems.map((p) => `[${p.code}] ${p.message}`),
    shadowed_warnings: shadowed.checkup().problems.map((p) => `[${p.code}] ${p.message}`),
    ruleIdRefusal,
    // deferred at graph build (the note the agent read), reported ONCE at agent
    // build: lookup_order resolved against the registry, lokup_order reported.
    deferredNote: deferred.deferredBodyContract,
    bodyContractReport,
    // the same report through the .skills({ list }) door — the note travels
    // with the skills, so no door loses the check.
    bodyContractReportViaSkills,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
