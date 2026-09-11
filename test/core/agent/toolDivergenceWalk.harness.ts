/**
 * THE DIVERGENCE WALK — the harness, the space and the analyser.
 *
 * Extracted from `toolDivergenceWalk.test.ts` in 9.92.0 so that the five
 * reproductions of `docs/design/2026-09-the-offer-and-the-answer.md` can drive
 * the SAME configurations the walk drives (`test/core/tools/offer-and-answer.test.ts`)
 * rather than a re-typed copy of them. The walk's own file keeps the ratchet
 * and the reasoning; this file holds nothing that decides — it stages a
 * configuration, runs it, and derives what happened.
 *
 * Read the header of `toolDivergenceWalk.test.ts` first. Every name here is
 * explained there.
 */

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  inMemoryArtifacts,
  isPaused,
} from '../../../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../../../src/injection-engine.js';
import { skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import { mockMcpClient } from '../../../src/lib/mcp/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type {
  ToolsAnsweredOffWirePayload,
  ToolsClaimSwallowedPayload,
  ToolsShadowedPayload,
} from '../../../src/events/payloads.js';
import type { Tool } from '../../../src/core/tools.js';

// ═════════════════════════════════════════════════════════════════════════
// The stamp — how a contract and an implementation are told apart
// ═════════════════════════════════════════════════════════════════════════

/** The name every collision is staged under. */
export const CONTESTED = 'shared_tool';

/** A tool whose CONTRACT and whose IMPLEMENTATION carry the same token. */
export const stampedTool = (name: string, stamp: string): Tool =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool [contract:${stamp}]`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran [impl:${stamp}]`,
  }) as unknown as Tool;

export const stampOf = (text: string, kind: 'contract' | 'impl'): string | undefined =>
  new RegExp(`\\[${kind}:([^\\]]+)\\]`).exec(text)?.[1];

/**
 * Who answered. `framework` is the honest reading of an unstamped result: every
 * tool the walk mounts is stamped, so an answer with no token came from a tool
 * the framework attached to itself.
 */
export const answeredBy = (result: string): string =>
  stampOf(result, 'impl') ??
  (result.includes('Unknown tool')
    ? 'unroutable'
    : result.includes('did not run on that call')
    ? 'refused'
    : 'framework');

/** Who the wire's contract belonged to — same reading, same reason. */
export const contractOf = (description: string): string =>
  stampOf(description, 'contract') ?? 'framework';

/** The vocabulary `agentfootprint.tools.shadowed` reports sources in. */
export type Channel = 'registry' | 'provider' | 'skill' | 'framework';

// ═════════════════════════════════════════════════════════════════════════
// The harness — one configuration, one real run, one observation
// ═════════════════════════════════════════════════════════════════════════

export interface Offered {
  readonly name: string;
  readonly description: string;
}

export type Builder = ReturnType<typeof Agent.create>;

/** What the model does with one epoch's offer. */
export type EpochStep = (offer: readonly Offered[]) => readonly {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}[];

export interface Scenario {
  /** Extra `Agent.create` options — an artifact store, a smaller iteration cap. */
  readonly createOptions?: Record<string, unknown>;
  readonly mount: (b: Builder) => Builder | Promise<Builder>;
  readonly plan: readonly EpochStep[];
  readonly message?: string;
  /**
   * Pause the FIRST call of `pauseOn` behind a middleware ask, then resume it
   * in a FRESH Agent instance built by the same `mount` (9.92.0): the second
   * instance's closure — served-party record, provider cache — is empty and
   * Compose does not re-run before the resumed dispatch, which is exactly
   * the shape a fresh process resuming a checkpoint has. The resumed call
   * keeps its epoch-1 id, so the analyser reads it as epoch 1's answer.
   */
  readonly resumeInFreshInstance?: { readonly pauseOn: string };
}

export interface Observation {
  /** Per epoch, what the wire carried. */
  readonly offers: readonly (readonly Offered[])[];
  /** `e<epoch>:<name>` → the result the model read. */
  readonly answers: ReadonlyMap<string, string>;
  readonly shadowed: readonly ToolsShadowedPayload[];
  /** Every `agentfootprint.tools.claim_swallowed` the run emitted (9.92.0). */
  readonly swallowed: readonly ToolsClaimSwallowedPayload[];
  /** Every `agentfootprint.tools.answered_off_wire` the run emitted (9.92.0). */
  readonly offWire: readonly ToolsAnsweredOffWirePayload[];
  /** Set when `.build()` refused the configuration — a refusal is a result. */
  readonly buildRefusal?: string;
  readonly runError?: string;
}

export const FINAL: LLMResponse = {
  content: 'done',
  toolCalls: [],
  stopReason: 'stop',
} as LLMResponse;

export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const drive = async (s: Scenario): Promise<Observation> => {
  const offers: Offered[][] = [];
  const answers = new Map<string, string>();
  const shadowed: ToolsShadowedPayload[] = [];
  const swallowed: ToolsClaimSwallowedPayload[] = [];
  const offWire: ToolsAnsweredOffWirePayload[] = [];

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

  const build = async (): Promise<Agent> => {
    let base = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 10,
      ...s.createOptions,
    }).system('s');
    if (s.resumeInFreshInstance !== undefined) {
      const { pauseOn } = s.resumeInFreshInstance;
      let asked = false;
      base = base.toolMiddleware({
        name: 'walk-pause',
        onToolCall: (call) => {
          if (call.toolName !== pauseOn || asked) return allow();
          asked = true;
          return ask({ question: 'proceed?' });
        },
      });
    }
    return (await s.mount(base)).build();
  };
  const listen = (agent: Agent): void => {
    agent.on('agentfootprint.stream.tool_end', (e) => {
      const p = e.payload as { toolCallId?: string; result?: unknown };
      answers.set(String(p.toolCallId), String(p.result));
    });
    agent.on('agentfootprint.tools.shadowed', (e) =>
      shadowed.push(e.payload as unknown as ToolsShadowedPayload),
    );
    agent.on('agentfootprint.tools.claim_swallowed', (e) =>
      swallowed.push(e.payload as unknown as ToolsClaimSwallowedPayload),
    );
    agent.on('agentfootprint.tools.answered_off_wire', (e) =>
      offWire.push(e.payload as unknown as ToolsAnsweredOffWirePayload),
    );
  };

  let agent: Agent;
  try {
    agent = await build();
  } catch (err) {
    return { offers, answers, shadowed, swallowed, offWire, buildRefusal: messageOf(err) };
  }
  listen(agent);

  let runError: string | undefined;
  try {
    const outcome = await agent.run({ message: s.message ?? 'go' });
    if (s.resumeInFreshInstance !== undefined) {
      if (!isPaused(outcome)) throw new Error('the walk expected a middleware-ask pause');
      // A checkpoint that travelled: JSON, like a fresh process would get it.
      const checkpoint = JSON.parse(
        JSON.stringify(outcome.checkpoint),
      ) as typeof outcome.checkpoint;
      const fresh = await build();
      listen(fresh);
      await fresh.resume(checkpoint, checkInApproved({ by: 'walk' }));
    }
  } catch (err) {
    runError = messageOf(err);
  }
  return {
    offers,
    answers,
    shadowed,
    swallowed,
    offWire,
    ...(runError !== undefined && { runError }),
  };
};

// ═════════════════════════════════════════════════════════════════════════
// The space — every source that can put a name on the wire or answer to one
// ═════════════════════════════════════════════════════════════════════════

export interface Claimant {
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

export const CLAIMANTS: readonly Claimant[] = [
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

export const conflict = (a: Claimant, b: Claimant): string | undefined => {
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

export interface WalkCase {
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

export const activateStep =
  (id: string): EpochStep =>
  () =>
    [{ name: 'read_skill', args: { id } }];

export const callStep =
  (name: string, args?: Record<string, unknown>): EpochStep =>
  () =>
    [{ name, ...(args && { args }) }];

/** Walk A — every ordered pair of claimants, staged under one name. */
export const collisionCases = (): readonly WalkCase[] => {
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
export const crossEpochCases = (): readonly WalkCase[] => {
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

  return [...cases, ...crossEpochCollisionCases()];
};

/**
 * Walk D — cross-epoch × collision (9.92.0): a name that LEAVES the wire while
 * more than one party holds it, and a call that arrives after it left.
 *
 * The 9.91.0 walk crossed the claimants (A) and the narrowings (B) but never
 * the two together, and the review of 9.92.0 found the seam in the gap: the
 * off-wire fallback read the build-time map and could hand a call to a party
 * the model was never shown under that name. Three shapes, each a real run:
 *
 *   • withdraw-then-call — a provider serves the name on epoch 1 and withdraws
 *     it; a never-activated scoped skill still holds it in `registryByName`;
 *     the model names it on epoch 2;
 *   • served-then-taken-off-then-call is walk B's `parked-map` and
 *     `step-hold-out` — a name served on the first epochs, taken off the wire
 *     by the kernel's park or an open tenure, then named. Both now produce an
 *     `answered-off-wire` row: the held-out dispatch the capability law keeps,
 *     on the record (`tools.answered_off_wire`). A flat scoped graph does NOT
 *     take a served tool off the wire when the cursor hops (the walk tried it
 *     and the case came back vacuous), so it is not staged here;
 *   • fresh-instance resume — the epoch-1 call is paused behind a middleware
 *     ask and resumed in a NEW Agent instance: empty closure, no Compose.
 */
const crossEpochCollisionCases = (): readonly WalkCase[] => {
  const cases: WalkCase[] = [];

  cases.push({
    id: 'cross-epoch/withdraw-then-call-inactive-skill-holds',
    configuration:
      "a `ToolProvider` serving 'shared_tool' on iteration 1 only, beside a never-activated scoped skill holding the same name",
    name: CONTESTED,
    claims: new Map([
      ['provider', 'provider'],
      ['skill-inactive', 'skill'],
    ]),
    expects: 'held-out',
    scenario: {
      mount: (b) =>
        b
          .toolProvider({
            id: 'fading',
            list: (ctx) => (ctx.iteration === 1 ? [stampedTool(CONTESTED, 'provider')] : []),
          })
          .skill(
            defineSkill({
              id: 'desk-idle',
              description: 'a desk the model never activates',
              body: 'IDLE DESK',
              tools: [stampedTool(CONTESTED, 'skill-inactive')] as never,
            }),
          )
          .toolsFromActiveSkill(),
      plan: [callStep(CONTESTED), callStep(CONTESTED)],
    },
  });

  cases.push({
    id: 'cross-epoch/fresh-instance-resume-provider-vs-inactive-skill',
    configuration:
      "a provider's 'shared_tool' paused behind a middleware ask and resumed in a FRESH Agent instance, a never-activated scoped skill holding the same name",
    name: CONTESTED,
    claims: new Map([
      ['provider', 'provider'],
      ['skill-inactive', 'skill'],
    ]),
    scenario: {
      mount: (b) =>
        b
          .toolProvider(staticTools([stampedTool(CONTESTED, 'provider')]))
          .skill(
            defineSkill({
              id: 'desk-idle',
              description: 'a desk the model never activates',
              body: 'IDLE DESK',
              tools: [stampedTool(CONTESTED, 'skill-inactive')] as never,
            }),
          )
          .toolsFromActiveSkill(),
      plan: [callStep(CONTESTED)],
      resumeInFreshInstance: { pauseOn: CONTESTED },
    },
  });

  return cases;
};

/**
 * Walk C — every name the framework attaches to itself, claimed by somebody
 * else. These are the names a consumer cannot see coming: they are not in the
 * consumer's code, and some of them are refused at build precisely so the
 * others' silence stands out.
 *
 * Every claimant is crossed here, not a chosen few. An earlier revision walked
 * only `static`, `provider` and `skill-active` against these names, and the
 * three sources it skipped were exactly the ones the collision walk had already
 * found the interesting answers in — an MCP-served tool, a never-activated
 * scoped skill, a stepped skill. The framework's four reservations all read the
 * same build-time registry, so which SOURCE holds the contested name decides
 * whether the reservation can see it at all; a filter over sources is therefore
 * a filter over the answers. The list of sources is `CLAIMANTS` and nowhere
 * else — that is the one list this file maintains by hand, so it is the one
 * list nothing here is allowed to re-derive.
 */
export const frameworkCases = (): readonly WalkCase[] => {
  const cases: WalkCase[] = [];

  for (const c of CLAIMANTS) {
    // `read_skill` — attached whenever ≥1 skill is registered.
    cases.push({
      id: `framework/read_skill-vs-${c.id}`,
      configuration: `the framework's \`read_skill\` against ${c.what}`,
      name: 'read_skill',
      // The framework's own schema reaches the wire through the STATIC
      // registry list (`buildToolRegistry` puts `read_skill` in
      // `augmentedRegistry`); since 9.92.0 the events name the OWNER, and the
      // owner is the framework.
      claims: new Map([
        ['framework', 'framework'],
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
      // `skip_step` rides its own list (`stepSchemas`), attached by the
      // framework on behalf of the stepped tenure. Until 9.92.0 the event's
      // vocabulary had no word for the framework and 'skill' was the closest
      // true one; now it has.
      claims: new Map([
        ['framework', 'framework'],
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
      // Same as `read_skill`: a full citizen of `augmentedRegistry`, owned by
      // the framework.
      claims: new Map([
        ['framework', 'framework'],
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

export type DivergenceKind =
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
  | 'claim-swallowed'
  /** A name NOT on this epoch's wire was answered anyway — the capability
   *  law's held-out dispatch, recorded so the walk can see who answered and
   *  whether `tools.answered_off_wire` said so (9.92.0). */
  | 'answered-off-wire';

export interface Divergence {
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

/**
 * The `schemaFromId` / `dispatchToId` values a shadow event uses for one
 * claimant — the id the source is MOUNTED under, which is what the event
 * names. The framework's `.selfExplain()` pack rides a skill-scoped provider
 * whose id is `skill-scoped:` plus the skill id (skillScopedTools.ts); the
 * skill claimants are named by their skill id; a `staticTools` provider has no
 * id of its own.
 */
export const sourceIdsOf = (claimant: string): readonly string[] => {
  if (claimant === 'framework') return ['skill-scoped:self-explain'];
  const mounted = CLAIMANTS.find((c) => c.id === claimant);
  return mounted?.activate !== undefined ? [mounted.activate] : [];
};

export const channelOf = (claimant: string, claims: ReadonlyMap<string, Channel>): Channel =>
  claims.get(claimant) ?? 'framework';

export const reportFor = (
  obs: Observation,
  tool: string,
  epoch: number,
): ToolsShadowedPayload | undefined =>
  obs.shadowed.find((s) => s.toolName === tool && s.iteration === epoch);

/**
 * The event, said back. The `*Id` halves are included because they are the
 * part a reader ACTS on — `schemaFrom: 'provider'` sends nobody anywhere,
 * `schemaFromId: 'static'` names a file — and because two events can agree on
 * both channels and disagree on both addresses, which without the ids reads as
 * one event said twice.
 */
export const describeReport = (e: ToolsShadowedPayload | undefined): string =>
  e === undefined
    ? 'none'
    : `tools.shadowed schemaFrom=${attributionOf(
        e.schemaFrom,
        e.schemaFromId,
      )} dispatchTo=${attributionOf(e.dispatchTo, e.dispatchToId)}`;

/**
 * The dead-claim event, said back (9.92.0). One sentence per distinct
 * loser→winner pair, so a claim swallowed on every epoch of a run reads as
 * one fact rather than one fact per iteration.
 */
export const describeSwallowed = (events: readonly ToolsClaimSwallowedPayload[]): string => {
  const said = new Set<string>();
  for (const e of events) {
    said.add(
      `tools.claim_swallowed lostBy=${attributionOf(e.lostBy, e.lostById)} wonBy=${attributionOf(
        e.wonBy,
        e.wonById,
      )}`,
    );
  }
  return said.size === 0 ? 'none' : [...said].join(' | ');
};

export const attributionOf = (channel: string, id: string | undefined): string =>
  id === undefined ? channel : `${channel}(${id})`;

export const divergencesOf = (c: WalkCase, obs: Observation): readonly Divergence[] => {
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
      if ((answered === 'unroutable' || answered === 'refused') && offeredEarlier) {
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
          cause:
            answered === 'refused'
              ? `offered in an earlier epoch and refused in epoch ${epoch}: the party the model last read the name under no longer answers it, and the remaining holder was never offered under that name`
              : `offered in an earlier epoch and unroutable in epoch ${epoch}: the implementation is resolved from this epoch's provider list, so withdrawing the offer withdrew dispatch with it`,
        });
      } else if (tool === c.name && answered !== 'unroutable' && answered !== 'refused') {
        // Answered off the wire. Only for the contested name — `read_skill`
        // dispatches off-wire in every `.tree()` run and is nobody's claim here.
        const said = obs.offWire.find((e) => e.toolCallId === callId);
        found.push({
          id: `${c.id}::${tool}@e${epoch}::answered-off-wire`,
          case: c.id,
          configuration: c.configuration,
          kind: 'answered-off-wire',
          tool,
          epoch,
          contract: 'not offered this epoch',
          answered,
          reported:
            said === undefined
              ? 'none'
              : `tools.answered_off_wire answeredBy=${attributionOf(
                  said.answeredBy,
                  said.answeredById,
                )}`,
          cause: `epoch ${epoch} did not offer '${tool}' and '${answered}' answered it — the held-out dispatch the capability law keeps${
            said === undefined ? ', unreported' : ', on the record'
          }`,
        });
      }
      continue;
    }

    const contract = contractOf(offered.description);
    if (answered === 'unroutable' || answered === 'refused') {
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
        cause:
          answered === 'refused'
            ? `epoch ${epoch} offered '${tool}' under '${contract}'s contract and the resumed dispatch refused it: that party's implementation was not available to answer, and no other party may`
            : `epoch ${epoch} offered '${tool}' and epoch ${epoch} could not route it`,
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
    // The ATTRIBUTION is part of the row's identity, not just its body. One
    // tool in one epoch can draw two reports that name different sources —
    // that is a strictly worse fact than one report naming the wrong source,
    // and keying the row on tool+epoch alone folds the second into the first
    // and loses it. `observed` is a Map, so a collapsed id is a silently
    // dropped divergence rather than a duplicated one.
    const attribution = `${attributionOf(e.schemaFrom, e.schemaFromId)}->${attributionOf(
      e.dispatchTo,
      e.dispatchToId,
    )}`;
    found.push({
      id: `${c.id}::${e.toolName}@e${e.iteration}::report-misattributed[${attribution}]`,
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
    // Since 9.92.0 a dead claim has its own event. The row's `reported`
    // column carries it — the walk records what was said, and a claim that
    // is swallowed AND named is a different fact from one swallowed in
    // silence, which is the fact this whole family used to be.
    const swallowedHere = obs.swallowed.filter((e) => e.toolName === c.name);
    // What the shadow report says about the SWALLOWED claimant (9.86.1). A
    // report can name the dead claimant as the schema's winner — the
    // framework's trace pack rides `skillScopedTools('self-explain')`, so
    // `schemaFromId` is `skill-scoped:self-explain` — and that is not "a
    // different pair": it is this pair with the winner inverted, which is
    // entry 5's defect. Only a report naming neither side describes another
    // pair.
    const namesTheSwallowed =
      aboutThisName !== undefined &&
      [aboutThisName.schemaFromId, aboutThisName.dispatchToId].some(
        (id) => id !== undefined && sourceIdsOf(claimant).includes(id),
      );
    found.push({
      id: `${c.id}::${c.name}::claim-swallowed(${claimant})`,
      case: c.id,
      configuration: c.configuration,
      kind: 'claim-swallowed',
      tool: c.name,
      epoch: 0,
      contract: 'never on the wire',
      answered: 'never dispatched',
      reported:
        swallowedHere.length > 0 ? describeSwallowed(swallowedHere) : describeReport(aboutThisName),
      cause:
        `'${claimant}' registered '${c.name}' and neither its schema nor its implementation was ever reachable` +
        (swallowedHere.length > 0
          ? '; reported as a dead claim by tools.claim_swallowed, once per epoch it lost'
          : aboutThisName === undefined
          ? '; nothing was reported'
          : namesTheSwallowed
          ? '; the shadow report for this name names this claimant as the winner of a wire it never reached'
          : '; the shadow report for this name describes a different pair'),
    });
  }

  return found;
};

export type Outcome = 'refused' | 'not-constructible' | 'clean' | 'divergent' | 'vacuous';

export interface CaseResult {
  readonly case: WalkCase;
  readonly outcome: Outcome;
  /** Why refused / not constructible / vacuous — the real message, first line. */
  readonly because?: string;
  readonly divergences: readonly Divergence[];
}

export const firstLine = (s: string): string => s.split('\n')[0]!.trim();

/** Did the narrowing actually bite? Returns why not, when it did not. */
export const vacuity = (c: WalkCase, obs: Observation): string | undefined => {
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

export const runCase = async (c: WalkCase): Promise<CaseResult> => {
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
