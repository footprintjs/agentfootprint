/**
 * THE DIVERGENCE WALK — a DISCOVERED enumeration of every place the tool OFFER
 * and the tool DISPATCH can disagree.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `buildToolRegistry.ts` used to carry a hand-written list of the seams where
 * the schema the model reads and the implementation that answers can come
 * apart, and the list presented itself as complete. It was wrong three times
 * in three rounds — each round stated it more precisely, and each round an
 * independent check found one more:
 *
 *   round 1  provider tools vanish cross-epoch
 *   round 2  provider/skill name shadow, same epoch
 *   round 3  an INACTIVE skill shadows silently; `skip_step` shadowable by a provider
 *
 * A hand-maintained list claiming completeness is the exact defect this
 * library exists to fix, one level up: a sentence a reader trusts, kept true
 * by nobody. So the enumeration is no longer written. It is WALKED.
 *
 * ── What the walk does ───────────────────────────────────────────────────
 *
 * `CLAIMANTS` is every source that can put a name on the wire or answer to
 * one. `crossEpochCases` is every narrowing that can take a name off the wire
 * mid-run. `frameworkCases` is every name the framework attaches to itself.
 * The walk crosses them, drives a REAL agent run per configuration, and
 * records, per epoch: what name was offered, what CONTRACT was on the wire,
 * what IMPLEMENTATION answered, and whether `agentfootprint.tools.shadowed`
 * fired and what it claimed.
 *
 * Every tool it mounts carries the same token in its description and in its
 * result — `[contract:X]` and `[impl:X]`. A name cannot witness identity,
 * because a name is exactly what two implementations can share; a stamp can.
 * Whatever answers a call has to say which contract it was.
 *
 * ── What it found that nobody had written down ───────────────────────────
 *
 * The walk was seeded with the five known divergences and reproduced all five
 * from its own runs. It then found more, which is the entire point of building
 * it — every one of these was reachable in a shipped configuration and named
 * in no comment:
 *
 *   • A provider tool whose name a REGISTRY-LIST holder already owns loses the
 *     wire AND dispatch and is simply dead — a static `.tool()`, an
 *     always-visible skill tool, a stepped skill's tool, or one of the
 *     framework's own auto-attached names. `reportShadowedTools` cannot see it:
 *     it fires only when a provider schema SURVIVED the merge.
 *   • The three framework auto-attach names disagree with each other. A skill
 *     tool called `read_skill` under `.toolsFromActiveSkill()` is neither
 *     refused at build nor reachable at run time; `present` and `skip_step`
 *     refuse that exact shape.
 *   • `.selfExplain()` is a FOURTH auto-attach family whose reservation reads
 *     the static `.tool()` registry only. A consumer provider serving
 *     `run_overview` takes it and the framework's own trace tool is
 *     unreachable; a skill tool of that name takes dispatch while the trace
 *     tool's contract stays on the wire.
 *
 * ── The ratchet, not the assertion ───────────────────────────────────────
 *
 * Several of these are genuine defects with genuine behaviour changes behind
 * them, and NONE of them is fixed here. Asserting them away would either
 * freeze them as correct or paint the suite red until somebody deletes it. So
 * this follows `docs:truth` (scripts/docs-truth-check.mjs,
 * docs/docs-truth/baseline.json):
 *
 *   • every divergence found is recorded in `toolDivergenceWalk.baseline.json`
 *     with its configuration, its mechanical cause, and — hand-written, and
 *     required — the reason it is TOLERATED;
 *   • a divergence not in the baseline FAILS: that is a new one;
 *   • a baselined divergence that stops appearing FAILS too: behaviour moved,
 *     and a ratchet that only ever loosens is a ratchet nobody is holding;
 *   • the same for a case's outcome — refused, clean, divergent — so a build
 *     that stops refusing a collision is as loud as one that starts diverging.
 *
 * Re-record with `AF_DIVERGENCE_BASELINE=update npx vitest run
 * test/core/agent/toolDivergenceWalk.test.ts`. New rows land with a `tolerated`
 * of `TODO`, and a `TODO` fails — accepting debt has to be written down by a
 * person, in a diff somebody reviews.
 *
 * A `tolerated` reason says why a row is not fixed; it has no room for what
 * fixing it would COST, which is the thing a decision actually needs. The three
 * rows that read "a genuine defect" — the inactive-skill shadow, the
 * misattributed report, and a provider claiming `skip_step` — are written up
 * with their reproductions and their decision surface in
 * `docs/design/2026-09-recorded-not-built.md`.
 *
 * ── What a green run does NOT prove ──────────────────────────────────────
 *
 * That the walk covers the space it walks, not that the space is complete.
 * A source nobody added to `CLAIMANTS`, a narrowing nobody added to the
 * cross-epoch cases, is invisible here exactly as it was invisible in the
 * comment. What changed is the cost of the mistake: a claimant is nine lines
 * and its collisions are then walked against every other claimant
 * automatically, so the list that has to be maintained by hand is the list of
 * SOURCES — which the type system, the builder surface and a grep can each
 * argue about — rather than the list of their INTERACTIONS, which is the part
 * that was wrong all three times.
 *
 * Test types (Convention 3): integration (every case is a real agent run) /
 * regression (the baseline ratchet) / documentation (the law's comment now
 * points here and the pin proves it still does) / property (the analyser
 * derives divergences from observation, never from a per-case expectation).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

import { Agent, defineTool, inMemoryArtifacts } from '../../../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../../../src/injection-engine.js';
import { skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import { mockMcpClient } from '../../../src/lib/mcp/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type { ToolsShadowedPayload } from '../../../src/events/payloads.js';
import type { Tool } from '../../../src/core/tools.js';

// ═════════════════════════════════════════════════════════════════════════
// The stamp — how a contract and an implementation are told apart
// ═════════════════════════════════════════════════════════════════════════

/** The name every collision is staged under. */
const CONTESTED = 'shared_tool';

/** A tool whose CONTRACT and whose IMPLEMENTATION carry the same token. */
const stampedTool = (name: string, stamp: string): Tool =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool [contract:${stamp}]`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran [impl:${stamp}]`,
  }) as unknown as Tool;

const stampOf = (text: string, kind: 'contract' | 'impl'): string | undefined =>
  new RegExp(`\\[${kind}:([^\\]]+)\\]`).exec(text)?.[1];

/**
 * Who answered. `framework` is the honest reading of an unstamped result: every
 * tool the walk mounts is stamped, so an answer with no token came from a tool
 * the framework attached to itself.
 */
const answeredBy = (result: string): string =>
  stampOf(result, 'impl') ?? (result.includes('Unknown tool') ? 'unroutable' : 'framework');

/** Who the wire's contract belonged to — same reading, same reason. */
const contractOf = (description: string): string => stampOf(description, 'contract') ?? 'framework';

/** The vocabulary `agentfootprint.tools.shadowed` reports sources in. */
type Channel = 'registry' | 'provider' | 'skill' | 'framework';

// ═════════════════════════════════════════════════════════════════════════
// The harness — one configuration, one real run, one observation
// ═════════════════════════════════════════════════════════════════════════

interface Offered {
  readonly name: string;
  readonly description: string;
}

type Builder = ReturnType<typeof Agent.create>;

/** What the model does with one epoch's offer. */
type EpochStep = (offer: readonly Offered[]) => readonly {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}[];

interface Scenario {
  /** Extra `Agent.create` options — an artifact store, a smaller iteration cap. */
  readonly createOptions?: Record<string, unknown>;
  readonly mount: (b: Builder) => Builder | Promise<Builder>;
  readonly plan: readonly EpochStep[];
  readonly message?: string;
}

interface Observation {
  /** Per epoch, what the wire carried. */
  readonly offers: readonly (readonly Offered[])[];
  /** `e<epoch>:<name>` → the result the model read. */
  readonly answers: ReadonlyMap<string, string>;
  readonly shadowed: readonly ToolsShadowedPayload[];
  /** Set when `.build()` refused the configuration — a refusal is a result. */
  readonly buildRefusal?: string;
  readonly runError?: string;
}

const FINAL: LLMResponse = { content: 'done', toolCalls: [], stopReason: 'stop' } as LLMResponse;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const drive = async (s: Scenario): Promise<Observation> => {
  const offers: Offered[][] = [];
  const answers = new Map<string, string>();
  const shadowed: ToolsShadowedPayload[] = [];

  // Snapshotted, never referenced: the framework reuses the `LLMRequest` object
  // across iterations, so holding it and reading `.tools` afterwards reports
  // the LAST epoch's offer for every entry.
  const provider = mock({
    respond: (req: LLMRequest) => {
      const offer = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description }));
      offers.push(offer);
      const step = s.plan[offers.length - 1];
      if (!step) return FINAL;
      const calls = step(offer);
      if (calls.length === 0) return FINAL;
      return {
        content: '',
        toolCalls: calls.map((c) => ({
          id: `e${offers.length}:${c.name}`,
          name: c.name,
          args: c.args ?? {},
        })),
        stopReason: 'tool_use',
      } as LLMResponse;
    },
  });

  let agent: Agent;
  try {
    const base = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 10,
      ...s.createOptions,
    }).system('s');
    agent = (await s.mount(base)).build();
  } catch (err) {
    return { offers, answers, shadowed, buildRefusal: messageOf(err) };
  }

  agent.on('agentfootprint.stream.tool_end', (e) => {
    const p = e.payload as { toolCallId?: string; result?: unknown };
    answers.set(String(p.toolCallId), String(p.result));
  });
  agent.on('agentfootprint.tools.shadowed', (e) =>
    shadowed.push(e.payload as unknown as ToolsShadowedPayload),
  );

  let runError: string | undefined;
  try {
    await agent.run({ message: s.message ?? 'go' });
  } catch (err) {
    runError = messageOf(err);
  }
  return { offers, answers, shadowed, ...(runError !== undefined && { runError }) };
};

// ═════════════════════════════════════════════════════════════════════════
// The space — every source that can put a name on the wire or answer to one
// ═════════════════════════════════════════════════════════════════════════

interface Claimant {
  /** Stable id; also the stamp its tool carries. */
  readonly id: string;
  /** How `tools.shadowed` would name this source. */
  readonly channel: Channel;
  /** Prose for the configuration sentence in the report. */
  readonly what: string;
  /**
   * An agent-wide posture this claimant sets. Two claimants that write the
   * same key with different values cannot be co-mounted, and the walk records
   * that as `not-constructible` rather than pretending it ran.
   */
  readonly posture?: { readonly key: string; readonly value: string };
  /** The skill id that must be activated before this claimant's tool rides. */
  readonly activate?: string;
  readonly mount: (b: Builder, name: string, stamp: string) => Builder | Promise<Builder>;
}

const CLAIMANTS: readonly Claimant[] = [
  {
    id: 'static',
    channel: 'registry',
    what: 'a static `.tool()` registration',
    mount: (b, name, stamp) => b.tool(stampedTool(name, stamp) as never),
  },
  {
    id: 'provider',
    channel: 'provider',
    what: 'a `ToolProvider` (`staticTools`)',
    posture: { key: 'toolProvider', value: 'staticTools' },
    mount: (b, name, stamp) => b.toolProvider(staticTools([stampedTool(name, stamp)])),
  },
  {
    id: 'mcp',
    channel: 'provider',
    what: 'an MCP-served tool, mounted through a provider',
    posture: { key: 'toolProvider', value: 'mcp' },
    mount: async (b, name, stamp) => {
      const client = mockMcpClient({
        name: 'walk-mcp',
        tools: [
          {
            name,
            description: `${name} tool [contract:${stamp}]`,
            inputSchema: { type: 'object', properties: {} },
            handler: async () => `${name} ran [impl:${stamp}]`,
          },
        ],
      });
      return b.toolProvider(staticTools(await client.tools()));
    },
  },
  {
    id: 'skill-static',
    channel: 'skill',
    what: 'a skill’s `tools:[]` with tools always visible (no `autoActivate`)',
    posture: { key: 'toolPosture', value: 'always-visible' },
    mount: (b, name, stamp) =>
      b.skill(
        defineSkill({
          id: 'desk-static',
          description: 'a desk whose tools are always visible',
          body: 'STATIC DESK',
          tools: [stampedTool(name, stamp)] as never,
        }),
      ),
  },
  {
    id: 'skill-active',
    channel: 'skill',
    what: 'an ACTIVE scoped skill’s `tools:[]` (`.toolsFromActiveSkill()`, activated)',
    posture: { key: 'toolPosture', value: 'from-active-skill' },
    activate: 'desk-active',
    mount: (b, name, stamp) =>
      b
        .skill(
          defineSkill({
            id: 'desk-active',
            description: 'a desk the model activates',
            body: 'ACTIVE DESK',
            tools: [stampedTool(name, stamp)] as never,
          }),
        )
        .toolsFromActiveSkill(),
  },
  {
    id: 'skill-inactive',
    channel: 'skill',
    what: 'an INACTIVE scoped skill’s `tools:[]` (`.toolsFromActiveSkill()`, never activated)',
    posture: { key: 'toolPosture', value: 'from-active-skill' },
    mount: (b, name, stamp) =>
      b
        .skill(
          defineSkill({
            id: 'desk-idle',
            description: 'a desk the model never activates',
            body: 'IDLE DESK',
            tools: [stampedTool(name, stamp)] as never,
          }),
        )
        .toolsFromActiveSkill(),
  },
  {
    id: 'step-skill',
    channel: 'skill',
    what: 'a STEPPED skill’s step-1 tool, with the tenure open',
    posture: { key: 'toolPosture', value: 'always-visible' },
    activate: 'desk-stepped',
    mount: (b, name, stamp) =>
      b.skill(
        defineSkill({
          id: 'desk-stepped',
          description: 'a desk that runs a procedure',
          body: 'STEPPED DESK',
          tools: [stampedTool(name, stamp)] as never,
          steps: [{ tool: name, note: 'the only step' }],
        }),
      ),
  },
];

const conflict = (a: Claimant, b: Claimant): string | undefined => {
  if (a.posture && b.posture && a.posture.key === b.posture.key) {
    if (a.posture.value !== b.posture.value) {
      return `\`${a.posture.key}\` is one posture for the whole agent — '${a.posture.value}' and '${b.posture.value}' cannot both be set`;
    }
  }
  return undefined;
};

// ═════════════════════════════════════════════════════════════════════════
// A case — one configuration, its claims, and the run that reveals them
// ═════════════════════════════════════════════════════════════════════════

interface WalkCase {
  readonly id: string;
  /** What was mounted, in what state — the sentence the baseline row carries. */
  readonly configuration: string;
  /** The name the case contests. */
  readonly name: string;
  /**
   * Every claimant mounted under `name`: its id — which is also the stamp its
   * tool carries — mapped to the channel `tools.shadowed` would name it by.
   * The channel is what makes a misattributed report detectable, so it is
   * declared per case rather than assumed: the framework reaches the wire
   * through the registry list for `read_skill`, through a provider for
   * `.selfExplain()`'s trace pack, and those are different answers.
   */
  readonly claims: ReadonlyMap<string, Channel>;
  /** Set when the configuration cannot be built at all — recorded, never run. */
  readonly unconstructible?: string;
  /**
   * The narrowing this case exists to exercise, asserted rather than assumed.
   *
   * A cross-epoch case that comes back CLEAN is only interesting if the name
   * really did leave the wire — a case whose park stopped parking, whose
   * cursor stopped moving, whose tenure stopped narrowing would ALSO come back
   * clean, and would go on reporting that the seam is safe. So `held-out`
   * demands the observation prove the hold-out happened, and a case that
   * cannot prove it is VACUOUS, which fails always and is never baselineable.
   */
  readonly expects?: 'held-out';
  readonly scenario?: Scenario;
}

const activateStep =
  (id: string): EpochStep =>
  () =>
    [{ name: 'read_skill', args: { id } }];

const callStep =
  (name: string, args?: Record<string, unknown>): EpochStep =>
  () =>
    [{ name, ...(args && { args }) }];

/** Walk A — every ordered pair of claimants, staged under one name. */
const collisionCases = (): readonly WalkCase[] => {
  const cases: WalkCase[] = [];
  for (const a of CLAIMANTS) {
    for (const b of CLAIMANTS) {
      if (a.id === b.id) continue;
      const id = `collision/${a.id}-then-${b.id}`;
      const configuration = `'${CONTESTED}' claimed by ${a.what} AND ${b.what}`;
      const claims = new Map<string, Channel>([
        [a.id, a.channel],
        [b.id, b.channel],
      ]);
      const clash = conflict(a, b);
      if (clash) {
        cases.push({ id, configuration, name: CONTESTED, claims, unconstructible: clash });
        continue;
      }
      const activations = [a, b].filter((c) => c.activate).map((c) => c.activate!);
      cases.push({
        id,
        configuration,
        name: CONTESTED,
        claims,
        scenario: {
          mount: async (base) => {
            const first = await a.mount(base, CONTESTED, a.id);
            return b.mount(first, CONTESTED, b.id);
          },
          plan: [...activations.map(activateStep), callStep(CONTESTED)],
        },
      });
    }
  }
  return cases;
};

/**
 * Walk B — every narrowing that takes a name off the wire mid-run.
 *
 * Each case offers a name, removes it, and then names it anyway. The law says
 * omission from the offer is not permanent capability loss; these are the
 * configurations where that is true, and the one where it is not.
 */
const crossEpochCases = (): readonly WalkCase[] => {
  const cases: WalkCase[] = [];

  // A provider that serves a tool on iteration 1 and stops — the shape the
  // shadow warning names ("a dynamic provider can start shadowing on
  // iteration 9 of a run nobody is watching"), taken in the other direction.
  cases.push({
    id: 'cross-epoch/dynamic-provider-withdraws',
    configuration: 'a `ToolProvider` whose `list(ctx)` serves the tool on iteration 1 only',
    name: 'withdrawn_tool',
    claims: new Map([['provider', 'provider']]),
    expects: 'held-out',
    scenario: {
      mount: (b) =>
        b.toolProvider({
          id: 'fading',
          list: (ctx) => (ctx.iteration === 1 ? [stampedTool('withdrawn_tool', 'provider')] : []),
        }),
      plan: [callStep('withdrawn_tool'), callStep('withdrawn_tool')],
    },
  });

  // The shipped helper, driven the same way: the scope moves and the tool goes
  // with it. `skillScopedTools` answers `[]` whenever `ctx.activeSkillId` is
  // not its skill, and that field reports only a `read_skill` activation.
  cases.push({
    id: 'cross-epoch/skill-scoped-provider-rescoped',
    configuration: '`skillScopedTools(desk-a)` after the model activates desk-b instead',
    name: 'scoped_tool',
    claims: new Map([['provider', 'provider']]),
    expects: 'held-out',
    scenario: {
      mount: (b) =>
        b
          .skill(defineSkill({ id: 'desk-a', description: 'desk a', body: 'A' }))
          .skill(defineSkill({ id: 'desk-b', description: 'desk b', body: 'B' }))
          .toolProvider(skillScopedTools('desk-a', [stampedTool('scoped_tool', 'provider')])),
      plan: [
        activateStep('desk-a'),
        callStep('scoped_tool'),
        activateStep('desk-b'),
        callStep('scoped_tool'),
      ],
    },
  });

  // A flat scoped graph: the desk the cursor is NOT standing on keeps its
  // tools off the wire. The implementation never left `registryByName`, which
  // is the half of the law this file's maps are actually responsible for.
  cases.push({
    id: 'cross-epoch/flat-graph-scoped-out',
    configuration: 'a flat `skillGraph({ scopeTools: true })` desk the cursor is not standing on',
    name: 'billing_tool',
    claims: new Map([['skill', 'skill']]),
    expects: 'held-out',
    scenario: {
      mount: (b) =>
        b.skillGraph(
          skillGraph({
            skills: [
              defineSkill({
                id: 'triage',
                description: 'triage a request',
                body: 'TRIAGE',
                tools: [stampedTool('triage_tool', 'skill')] as never,
              }),
              defineSkill({
                id: 'billing',
                description: 'billing questions',
                body: 'BILLING',
                tools: [stampedTool('billing_tool', 'skill')] as never,
              }),
            ],
            start: 'triage',
            steps: [{ from: 'triage', to: 'billing', onToolReturn: 'triage_tool' }],
            scopeTools: true,
            check: 'off',
          }),
        ),
      plan: [callStep('billing_tool')],
    },
  });

  // The `.tree()` arm — the one with no cursor at all, so `read_skill`
  // recovery is empty by construction and the offer is the only route back.
  cases.push({
    id: 'cross-epoch/tree-routes-elsewhere',
    configuration: 'a `.tree()` graph whose predicate routed to the other leaf',
    name: 'beta_tool',
    claims: new Map([['skill', 'skill']]),
    expects: 'held-out',
    scenario: {
      mount: (b) => {
        const alpha = defineSkill({
          id: 'alpha',
          description: 'alpha leaf',
          body: 'ALPHA',
          tools: [stampedTool('alpha_tool', 'skill')] as never,
        });
        const beta = defineSkill({
          id: 'beta',
          description: 'beta leaf',
          body: 'BETA',
          tools: [stampedTool('beta_tool', 'skill')] as never,
        });
        return b.skillGraph(
          skillGraph({
            skills: [alpha, beta],
            tree: decideSkill((ctx) => ctx.userMessage.includes('alpha'), alpha, beta),
            check: 'off',
          }),
        );
      },
      message: 'take the alpha branch',
      plan: [callStep('beta_tool')],
    },
  });

  // A parked map: the kernel stops talking about a map nothing corroborated.
  cases.push({
    id: 'cross-epoch/parked-map',
    configuration: 'a `.maps()` member parked after `renewalGrace` idle passes',
    name: 'get_zone_info',
    claims: new Map([['skill', 'skill']]),
    expects: 'held-out',
    scenario: {
      createOptions: { maxIterations: 8 },
      mount: (b) =>
        b
          .tool(stampedTool('screen_open', 'static') as never)
          .skillGraph(
            skillGraph()
              .entry(
                defineSkill({
                  id: 'zone-audit',
                  description: 'audit zone redundancy',
                  body: 'ZONE AUDIT',
                  tools: [stampedTool('get_zone_info', 'skill')] as never,
                }),
                { match: { keywords: ['zone'] } },
              )
              .build(),
          )
          .maps({ renewalGrace: 3 }),
      message: 'find the most recent zone redundancy run',
      plan: [
        callStep('screen_open'),
        callStep('screen_open'),
        callStep('screen_open'),
        callStep('get_zone_info'),
      ],
    },
  });

  // A stepped tenure: the later steps' tools are held out of the offer while
  // the procedure stands on step 1.
  cases.push({
    id: 'cross-epoch/step-hold-out',
    configuration: 'a stepped skill’s LATER step tool, held out while step 1 is current',
    name: 'export_receipt',
    claims: new Map([['skill', 'skill']]),
    expects: 'held-out',
    scenario: {
      mount: (b) =>
        b.skill(
          defineSkill({
            id: 'refund',
            description: 'refund handling',
            body: 'REFUND',
            tools: [
              stampedTool('lookup', 'skill'),
              stampedTool('export_receipt', 'skill'),
            ] as never,
            steps: [
              { tool: 'lookup', note: 'find the order first' },
              { tool: 'export_receipt', note: 'file the receipt' },
            ],
          }),
        ),
      plan: [activateStep('refund'), callStep('export_receipt')],
    },
  });

  return cases;
};

/**
 * Walk C — every name the framework attaches to itself, claimed by somebody
 * else. These are the names a consumer cannot see coming: they are not in the
 * consumer's code, and two of the three are refused at build precisely so the
 * third's silence stands out.
 */
const frameworkCases = (): readonly WalkCase[] => {
  const cases: WalkCase[] = [];
  const contenders = CLAIMANTS.filter((c) => ['static', 'provider', 'skill-active'].includes(c.id));

  for (const c of contenders) {
    // `read_skill` — attached whenever ≥1 skill is registered.
    cases.push({
      id: `framework/read_skill-vs-${c.id}`,
      configuration: `the framework's \`read_skill\` against ${c.what}`,
      name: 'read_skill',
      // The framework's own schema reaches the wire through the STATIC
      // registry list (`buildToolRegistry` puts `read_skill` in
      // `augmentedRegistry`), so that is the channel a report should name.
      claims: new Map([
        ['framework', 'registry'],
        [c.id, c.channel],
      ]),
      scenario: {
        mount: async (b) => {
          const withSkill = b.skill(
            defineSkill({ id: 'desk-plain', description: 'a plain desk', body: 'PLAIN' }),
          );
          return c.mount(withSkill, 'read_skill', c.id);
        },
        plan: [
          ...(c.activate ? [activateStep(c.activate)] : []),
          callStep('read_skill', { id: 'desk-plain' }),
        ],
      },
    });

    // `skip_step` — attached to DISPATCH whenever a skill declares `steps`,
    // offered only while a tenure is open.
    cases.push({
      id: `framework/skip_step-vs-${c.id}`,
      configuration: `the framework's \`skip_step\` against ${c.what}, tenure open`,
      name: 'skip_step',
      // `skip_step` rides its own list (`stepSchemas`), attached on behalf of
      // the stepped SKILL — the closest true word in the event's vocabulary.
      claims: new Map([
        ['framework', 'skill'],
        [c.id, c.channel],
      ]),
      scenario: {
        mount: async (b) => {
          const withSteps = b.skill(
            defineSkill({
              id: 'desk-proc',
              description: 'a desk that runs a procedure',
              body: 'PROC',
              tools: [stampedTool('do_step_one', 'skill')] as never,
              steps: [{ tool: 'do_step_one', note: 'the only step' }],
            }),
          );
          return c.mount(withSteps, 'skip_step', c.id);
        },
        plan: [
          ...(c.activate ? [activateStep(c.activate)] : []),
          activateStep('desk-proc'),
          callStep('skip_step', { reason: 'not applicable to this input' }),
        ],
      },
    });

    // A `.selfExplain()` trace tool — the fourth auto-attach family, and the
    // one whose reservation reads the STATIC registry only. Its tools ride a
    // skill-scoped provider, so the collision is observable only on the
    // iteration the model activates `self-explain`.
    cases.push({
      id: `framework/run_overview-vs-${c.id}`,
      configuration: `\`.selfExplain()\`'s \`run_overview\` against ${c.what}, self-explain activated`,
      name: 'run_overview',
      // The trace pack rides `skillScopedTools('self-explain', …)`, so the
      // framework's own tool is delivered on the PROVIDER channel here. A
      // walk that assumed 'framework' would report the shadow event as
      // misattributed when it is telling the truth.
      claims: new Map([
        ['framework', 'provider'],
        [c.id, c.channel],
      ]),
      scenario: {
        mount: async (b) => {
          const mounted = await c.mount(b, 'run_overview', c.id);
          return mounted.selfExplain();
        },
        plan: [
          ...(c.activate ? [activateStep(c.activate)] : []),
          activateStep('self-explain'),
          callStep('run_overview'),
        ],
      },
    });

    // `present` — attached as a full citizen whenever an artifact store is.
    cases.push({
      id: `framework/present-vs-${c.id}`,
      configuration: `the framework's \`present\` against ${c.what}, artifact store attached`,
      name: 'present',
      // Same as `read_skill`: a full citizen of `augmentedRegistry`.
      claims: new Map([
        ['framework', 'registry'],
        [c.id, c.channel],
      ]),
      scenario: {
        createOptions: { artifacts: inMemoryArtifacts() },
        mount: async (b) => {
          const withSkill = b.skill(
            defineSkill({ id: 'desk-plain', description: 'a plain desk', body: 'PLAIN' }),
          );
          return c.mount(withSkill, 'present', c.id);
        },
        plan: [
          ...(c.activate ? [activateStep(c.activate)] : []),
          callStep('present', { ref: 'artifact://nothing' }),
        ],
      },
    });
  }
  return cases;
};

// ═════════════════════════════════════════════════════════════════════════
// The analyser — divergences DERIVED from the observation
// ═════════════════════════════════════════════════════════════════════════

type DivergenceKind =
  /** A name on this epoch's offer that this epoch could not route. Clause one. */
  | 'offered-not-dispatchable'
  /** One epoch, one name: the contract on the wire and the implementation that
   *  answered belong to different tools. */
  | 'contract-swap'
  /** Offered in an earlier epoch, unroutable when named later. */
  | 'offer-withdrawn'
  /** `tools.shadowed` named a schema source that did not win the wire. */
  | 'report-misattributed'
  /** A mounted source reached neither the wire nor a dispatch — its tool exists
   *  and nothing can ever reach it. */
  | 'claim-swallowed';

interface Divergence {
  readonly id: string;
  readonly case: string;
  readonly configuration: string;
  readonly kind: DivergenceKind;
  readonly tool: string;
  /** The epoch it happened in; `0` for a claim that never reached any epoch. */
  readonly epoch: number;
  /** Whose schema the model read. */
  readonly contract: string;
  /** Whose implementation answered. */
  readonly answered: string;
  /** What `agentfootprint.tools.shadowed` said about it, if anything. */
  readonly reported: string;
  /** Composed from the observation, never hand-written. */
  readonly cause: string;
}

const channelOf = (claimant: string, claims: ReadonlyMap<string, Channel>): Channel =>
  claims.get(claimant) ?? 'framework';

const reportFor = (
  obs: Observation,
  tool: string,
  epoch: number,
): ToolsShadowedPayload | undefined =>
  obs.shadowed.find((s) => s.toolName === tool && s.iteration === epoch);

const describeReport = (e: ToolsShadowedPayload | undefined): string =>
  e === undefined ? 'none' : `tools.shadowed schemaFrom=${e.schemaFrom} dispatchTo=${e.dispatchTo}`;

const divergencesOf = (c: WalkCase, obs: Observation): readonly Divergence[] => {
  const found: Divergence[] = [];
  // Scoped to the CONTESTED name, not to the run. A run offers `read_skill`
  // whether or not this case is about it, and counting that would tell every
  // case that the framework was reachable.
  const contractsForName = new Set<string>();
  const implsForName = new Set<string>();

  for (const epochOffer of obs.offers) {
    for (const t of epochOffer) {
      if (t.name === c.name) contractsForName.add(contractOf(t.description));
    }
  }

  for (const [callId, result] of obs.answers) {
    const m = /^e(\d+):(.+)$/.exec(callId);
    if (!m) continue;
    const epoch = Number(m[1]);
    const tool = m[2]!;
    const answered = answeredBy(result);
    if (tool === c.name) implsForName.add(answered);
    const offered = (obs.offers[epoch - 1] ?? []).find((t) => t.name === tool);
    const report = reportFor(obs, tool, epoch);

    if (offered === undefined) {
      const offeredEarlier = obs.offers
        .slice(0, epoch - 1)
        .some((o) => o.some((t) => t.name === tool));
      if (answered === 'unroutable' && offeredEarlier) {
        found.push({
          id: `${c.id}::${tool}@e${epoch}::offer-withdrawn`,
          case: c.id,
          configuration: c.configuration,
          kind: 'offer-withdrawn',
          tool,
          epoch,
          contract: 'not offered this epoch',
          answered,
          reported: describeReport(report),
          cause: `offered in an earlier epoch and unroutable in epoch ${epoch}: the implementation is resolved from this epoch's provider list, so withdrawing the offer withdrew dispatch with it`,
        });
      }
      continue;
    }

    const contract = contractOf(offered.description);
    if (answered === 'unroutable') {
      found.push({
        id: `${c.id}::${tool}@e${epoch}::offered-not-dispatchable`,
        case: c.id,
        configuration: c.configuration,
        kind: 'offered-not-dispatchable',
        tool,
        epoch,
        contract,
        answered,
        reported: describeReport(report),
        cause: `epoch ${epoch} offered '${tool}' and epoch ${epoch} could not route it`,
      });
      continue;
    }

    if (contract !== answered) {
      found.push({
        id: `${c.id}::${tool}@e${epoch}::contract-swap`,
        case: c.id,
        configuration: c.configuration,
        kind: 'contract-swap',
        tool,
        epoch,
        contract,
        answered,
        reported: describeReport(report),
        cause: `the wire carried '${contract}'s contract and '${answered}'s implementation answered, inside epoch ${epoch}`,
      });
    }
  }

  // A report that names the wrong winner is its own divergence: the event is
  // the only channel that reaches production, and one that misnames the source
  // sends a reader to the wrong file.
  for (const e of obs.shadowed) {
    // Only about the name THIS case contests. An event about some other tool
    // belongs to whichever case stages that collision — judging it here would
    // mean guessing a channel for a stamp this case never mounted, and a guess
    // is exactly how a walk starts reporting divergences that are not there.
    if (e.toolName !== c.name) continue;
    const offered = (obs.offers[e.iteration - 1] ?? []).find((t) => t.name === e.toolName);
    if (offered === undefined) continue;
    const contract = contractOf(offered.description);
    const wireChannel = channelOf(contract, c.claims);
    if (e.schemaFrom === wireChannel) continue;
    found.push({
      id: `${c.id}::${e.toolName}@e${e.iteration}::report-misattributed`,
      case: c.id,
      configuration: c.configuration,
      kind: 'report-misattributed',
      tool: e.toolName,
      epoch: e.iteration,
      contract,
      answered: `reported dispatchTo=${e.dispatchTo}`,
      reported: describeReport(e),
      cause: `the event says the model read the ${e.schemaFrom}'s schema; the wire carried '${contract}' (${wireChannel})`,
    });
  }

  // A claimant that won neither the wire nor a dispatch. Nothing the model can
  // do reaches it, and nothing said so. The framework is judged by the same
  // rule as everyone else here: a reservation that fails to reserve leaves the
  // framework's own tool unreachable, which is the mirror of the seam the
  // reservation exists to refuse.
  for (const claimant of c.claims.keys()) {
    if (contractsForName.has(claimant) || implsForName.has(claimant)) continue;
    const aboutThisName = obs.shadowed.find((e) => e.toolName === c.name);
    found.push({
      id: `${c.id}::${c.name}::claim-swallowed(${claimant})`,
      case: c.id,
      configuration: c.configuration,
      kind: 'claim-swallowed',
      tool: c.name,
      epoch: 0,
      contract: 'never on the wire',
      answered: 'never dispatched',
      reported: describeReport(aboutThisName),
      cause:
        `'${claimant}' registered '${c.name}' and neither its schema nor its implementation was ever reachable` +
        (aboutThisName
          ? '; the shadow report for this name describes a different pair'
          : '; nothing was reported'),
    });
  }

  return found;
};

type Outcome = 'refused' | 'not-constructible' | 'clean' | 'divergent' | 'vacuous';

interface CaseResult {
  readonly case: WalkCase;
  readonly outcome: Outcome;
  /** Why refused / not constructible / vacuous — the real message, first line. */
  readonly because?: string;
  readonly divergences: readonly Divergence[];
}

const firstLine = (s: string): string => s.split('\n')[0]!.trim();

/** Did the narrowing actually bite? Returns why not, when it did not. */
const vacuity = (c: WalkCase, obs: Observation): string | undefined => {
  if (c.expects !== 'held-out') return undefined;
  // The LAST call, never the first: these cases deliberately name the tool
  // once while it is offered and again after the narrowing takes it away, and
  // reading the first call would report the hold-out from before it happened.
  const entry = [...obs.answers.keys()]
    .map((id) => /^e(\d+):(.+)$/.exec(id))
    .filter((m) => m?.[2] === c.name)
    .at(-1);
  if (!entry) return `'${c.name}' was never called, so no hold-out was tested`;
  const epoch = Number(entry[1]);
  const offered = (obs.offers[epoch - 1] ?? []).some((t) => t.name === c.name);
  return offered
    ? `'${c.name}' was still on the offer in epoch ${epoch} — the narrowing this case exists to exercise did not happen`
    : undefined;
};

const runCase = async (c: WalkCase): Promise<CaseResult> => {
  if (c.unconstructible !== undefined) {
    return { case: c, outcome: 'not-constructible', because: c.unconstructible, divergences: [] };
  }
  const obs = await drive(c.scenario!);
  if (obs.buildRefusal !== undefined) {
    return { case: c, outcome: 'refused', because: firstLine(obs.buildRefusal), divergences: [] };
  }
  const hollow = vacuity(c, obs);
  if (hollow !== undefined) {
    return { case: c, outcome: 'vacuous', because: hollow, divergences: [] };
  }
  const divergences = divergencesOf(c, obs);
  return {
    case: c,
    outcome: divergences.length > 0 ? 'divergent' : 'clean',
    divergences,
  };
};

// ═════════════════════════════════════════════════════════════════════════
// The ratchet
// ═════════════════════════════════════════════════════════════════════════

const BASELINE_PATH = new URL('./toolDivergenceWalk.baseline.json', import.meta.url);

interface BaselineRow extends Omit<Divergence, 'id'> {
  /** Hand-written, and required. `TODO` fails. */
  readonly tolerated: string;
}

interface Baseline {
  readonly $schema: string;
  readonly note: string;
  readonly recordedAt: string;
  readonly walk: Record<string, number>;
  readonly cases: Record<string, { readonly outcome: Outcome; readonly because?: string }>;
  readonly divergences: Record<string, BaselineRow>;
}

const loadBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

describe('the divergence walk — every offer/dispatch disagreement, discovered', () => {
  it('walks the configuration space and holds the ratchet', async () => {
    const cases = [...collisionCases(), ...crossEpochCases(), ...frameworkCases()];
    const results: CaseResult[] = [];
    for (const c of cases) results.push(await runCase(c));

    const observed = new Map<string, Divergence>();
    for (const r of results) for (const d of r.divergences) observed.set(d.id, d);

    const baseline = loadBaseline();

    if (process.env.AF_DIVERGENCE_BASELINE === 'update') {
      const next: Baseline = {
        $schema: baseline.$schema,
        note: baseline.note,
        recordedAt: new Date().toISOString().slice(0, 10),
        walk: {
          cases: results.length,
          notConstructible: results.filter((r) => r.outcome === 'not-constructible').length,
          refused: results.filter((r) => r.outcome === 'refused').length,
          clean: results.filter((r) => r.outcome === 'clean').length,
          divergent: results.filter((r) => r.outcome === 'divergent').length,
          divergences: observed.size,
        },
        cases: Object.fromEntries(
          results.map((r) => [
            r.case.id,
            { outcome: r.outcome, ...(r.because !== undefined && { because: r.because }) },
          ]),
        ),
        divergences: Object.fromEntries(
          [...observed.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, d]) => {
              const { id: _drop, ...row } = d;
              return [id, { ...row, tolerated: baseline.divergences[id]?.tolerated ?? 'TODO' }];
            }),
        ),
      };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    }

    const current = loadBaseline();

    // ── 0. A probe that stopped probing fails, always, unbaselineable. ───
    // Not debt: a case whose narrowing no longer happens reports "clean"
    // about a seam it never reached.
    expect(
      results.filter((r) => r.outcome === 'vacuous').map((r) => `${r.case.id}: ${r.because}`),
      'a case stopped exercising the narrowing it exists for',
    ).toEqual([]);

    // ── 1. A NEW divergence fails. This is the whole point. ──────────────
    const novel = [...observed.keys()].filter((id) => current.divergences[id] === undefined);
    expect(
      novel.map((id) => `${id} — ${observed.get(id)!.cause}`),
      'a divergence the baseline does not know about',
    ).toEqual([]);

    // ── 2. A recorded one that disappeared fails too: behaviour moved. ───
    const vanished = Object.keys(current.divergences).filter((id) => !observed.has(id));
    expect(vanished, 'a recorded divergence stopped appearing — behaviour moved').toEqual([]);

    // ── 3. A recorded one that changed shape fails: same name, new fact. ─
    const changed: string[] = [];
    for (const [id, d] of observed) {
      const row = current.divergences[id];
      if (row === undefined) continue;
      const same =
        row.kind === d.kind &&
        row.contract === d.contract &&
        row.answered === d.answered &&
        row.reported === d.reported &&
        row.epoch === d.epoch;
      if (!same)
        changed.push(`${id}: recorded ${JSON.stringify(row)}, observed ${JSON.stringify(d)}`);
    }
    expect(changed, 'a recorded divergence changed shape').toEqual([]);

    // ── 4. Tolerated debt is written down by a person. ───────────────────
    const untold = Object.entries(current.divergences)
      .filter(([, row]) => row.tolerated.trim().length === 0 || row.tolerated.startsWith('TODO'))
      .map(([id]) => id);
    expect(untold, 'a recorded divergence with no reason it is tolerated').toEqual([]);

    // ── 5. Case outcomes are ratcheted too — a build that stops refusing a
    //       collision is as loud as one that starts diverging. ────────────
    const outcomeDrift: string[] = [];
    for (const r of results) {
      const row = current.cases[r.case.id];
      if (row === undefined) {
        outcomeDrift.push(`${r.case.id}: new case, outcome ${r.outcome}`);
        continue;
      }
      if (row.outcome !== r.outcome) {
        outcomeDrift.push(`${r.case.id}: recorded ${row.outcome}, observed ${r.outcome}`);
      }
    }
    const goneCases = Object.keys(current.cases).filter(
      (id) => !results.some((r) => r.case.id === id),
    );
    expect(
      [...outcomeDrift, ...goneCases.map((id) => `${id}: case no longer walked`)],
      'a case outcome moved',
    ).toEqual([]);
  }, 60_000);

  it('STATED: the law points at this walk instead of enumerating its own exceptions', () => {
    const src = readFileSync(
      new URL('../../../src/core/agent/buildToolRegistry.ts', import.meta.url),
      'utf8',
    );
    // The law itself stays where it binds.
    expect(src).toContain('every offered capability resolves to a dispatchable implementation');
    // What must NOT come back: a hand-maintained list claiming to be the whole
    // set. Three rounds proved that sentence cannot be kept true by hand.
    expect(src).not.toContain('the one SAME-EPOCH divergence, and the only exception');
    // And the authority is named, so a reader who wants the set reads the walk.
    expect(src).toContain('test/core/agent/toolDivergenceWalk.test.ts');
  });
});
