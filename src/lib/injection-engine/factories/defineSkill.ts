/**
 * defineSkill — sugar for LLM-activated Injections that target both
 * system-prompt + tools.
 *
 * A Skill is a bundle of (1) a body of guidance and (2) optionally some
 * tools. The LLM decides when a Skill is needed by calling a designated
 * activation tool — by default `read_skill(<id>)`.
 *
 * Activation is about the BODY. A Skill's tools are registered up front
 * and callable from iteration 1 unless the Skill sets
 * `autoActivate: 'currentSkill'` — see that option.
 *
 * **Activation lifetime: the rest of the turn.** Once the model picks a
 * skill with `read_skill`, the activation lasts until the turn ends — every
 * later iteration of that `run()` keeps the body active, and there is no
 * mid-turn deactivation (nothing removes an id from
 * `ctx.activatedInjectionIds`; the next `run()` starts clean). This is
 * deliberate: the cache layer's skill history and the context ledger both
 * lean on the cumulative property. A skill that should stop applying
 * mid-turn is a `rule` trigger or a `skillGraph()` route, not a read_skill
 * pick.
 *
 * Produces an `Injection` with:
 *   - flavor: `'skill'`
 *   - trigger: `{ kind: 'llm-activated', viaToolName: 'read_skill' }`
 *   - inject: `{ systemPrompt: body, tools }`
 *
 * The Agent integration auto-attaches the `read_skill` tool when one
 * or more Skills are present. When the LLM calls
 * `read_skill('billing')`, the engine adds `'billing'` to
 * `ctx.activatedInjectionIds`; the next iteration's evaluator
 * matches this Skill's `id`, activates it, and the body lands in the
 * slot subflows (plus the tools, for an `autoActivate` Skill — every
 * other Skill's tools were already there).
 *
 * @example
 *   const billingSkill = defineSkill({
 *     id: 'billing',
 *     description: 'Use for refunds, charges, billing questions.',
 *     body: 'When handling billing: confirm identity first, then…',
 *     tools: [refundTool, chargeHistoryTool],
 *   });
 */

import { plainLineProblem } from '../../plainLine.js';
import { assertKnownOptions } from '../optionKeys.js';
import type { Injection } from '../types.js';
import type { Tool } from '../../../core/tools.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';
import { validateSkillSteps, type OnSkipPolicy, type SkillStep } from '../skillSteps.js';
import { assertArtifactVocabulary } from '../skillVocabulary.js';

/**
 * Where the Skill's body lands when activated.
 *
 * Delivery reads the mode you DECLARED, literally — `buildSystemPromptSlot`
 * decides the system slot, the `read_skill` tool decides its own result:
 *
 * - `'system-prompt'` — body appended to the system slot on the
 *   iteration after activation; the `read_skill` result is a one-line
 *   confirmation. Best on Claude ≥ 3.5 (training-time adherence to
 *   system-prompt instructions is strong).
 * - `'tool-only'` — body SUPPRESSED from the system slot and returned as
 *   the `read_skill` tool result instead. Recency-first by protocol;
 *   doesn't rely on the model's training to honor system-prompt
 *   anchoring. Legal only on a Skill that `read_skill` really activates —
 *   a Skill a skill graph routes to is refused at build time, because the
 *   tool call that would carry the body never happens (`skillBodyDelivery.ts`).
 * - `'both'` — body lands in the system slot AND in the tool result.
 *   Belt-and-suspenders for high-stakes Skills on long-context runs.
 * - `'auto'` (the default) — delivered exactly like `'system-prompt'`:
 *   body in the system slot, tool result is a confirmation. It is NOT
 *   resolved per provider on the delivery path.
 *
 * `resolveSurfaceMode(provider, model)` — Claude ≥ 3.5 → `'both'`, else
 * `'tool-only'` — is the per-provider RECOMMENDATION, and it runs only where
 * something asks for it: `SkillRegistry.resolveForSkill(...)` (the skill →
 * registry → provider cascade) and `resolvedSurfaceModeOf(skill, provider,
 * model)`. Nothing on the delivery path calls it, so feed its answer back in
 * as an explicit `surfaceMode` if you want it honored.
 */
export type SurfaceMode = 'auto' | 'system-prompt' | 'tool-only' | 'both';

export interface DefineSkillOptions {
  readonly id: string;
  /** Visible to the LLM via the activation tool's description. */
  readonly description: string;
  /**
   * The skill's plain name for a PERSON — "array estate report" for the id
   * `array-inventory`. Optional: at most 60 characters, one line, and not the
   * id itself.
   *
   * Record-only: it rides `agentfootprint.skill.graph_declared` (`nodes[].title`)
   * so a report can name the skill in plain words, and nothing the model reads
   * changes — the activation menu, the graph's drawn `label`, Mermaid and the
   * lens captions keep the id. Absent = not declared, and the event carries
   * the bytes it always did.
   */
  readonly title?: string;
  /** Body appended to the system-prompt slot once activated. */
  readonly body: string;
  /** Tools this Skill contributes. **By default they are added to the agent's tool
   *  registry at build time and are visible to the model from the first iteration,
   *  whether or not the Skill is ever activated** — activation adds the Skill's
   *  body, not its tools. To make the tools appear only while the Skill is active,
   *  set `autoActivate: 'currentSkill'`; `skillGraph().tree()` sets it for you on
   *  every leaf. If a tool must never be offered before activation, that is not a
   *  default — say so with `autoActivate`. */
  readonly tools?: readonly Tool[];
  /**
   * Where the body lands when activated. See `SurfaceMode`. Default
   * `'auto'`, which delivers like `'system-prompt'`; name a mode
   * explicitly to get the other channels.
   */
  readonly surfaceMode?: SurfaceMode;
  /**
   * Per-skill tool gating — the field that makes this Skill's `tools`
   * appear only while the Skill is active.
   *
   * - `'currentSkill'` — this Skill's `tools` are held out of the agent's
   *   static tool list and offered to the model only on iterations where
   *   the Skill is active. Outside the Agent's own wiring, materialize the
   *   same gate with `skillScopedTools(id, tools)` from
   *   `agentfootprint/providers`.
   * - `undefined` (default) — additive: this Skill's tools go into the
   *   agent's registry at BUILD time and the model can see and call them
   *   from iteration 1, activated or not.
   *
   * Saying it once for the whole agent instead of once per skill:
   * `.toolsFromActiveSkill()` on the builder (9.36.0) stamps this field on
   * every tool-carrying skill, and `skillGraph({ scopeTools: true })` stamps it
   * on the skills a graph wires. Both are DEFAULTS — a skill that declared its
   * own keeps it — and since `'currentSkill'` is the only legal value, none of
   * the three can contradict another.
   *
   * Wired at runtime since v2.5: `buildToolRegistry` holds these tools out of the
   * static registry and `buildToolsSlot` readmits them per-iteration from the
   * active injections. Dispatch is unaffected either way — an autoActivate tool
   * stays callable by name once activated. Read `skill.metadata.autoActivate` if
   * you compose your own ToolProvider.
   */
  readonly autoActivate?: AutoActivateMode;
  /**
   * The procedure, as data (9.18.0). An ordered list of `{ tool, note }`
   * pairs naming this skill's OWN tools (a step naming a tool the skill
   * does not carry is refused here, where both arrive together).
   *
   * While this skill holds the tenure, the framework owns sequence and
   * scope at the protocol level: the tools slot offers the CURRENT step's
   * tool (its description led by `[Step k of n — <note>]`) plus `skip_step`
   * — and every escape hatch stays offered (`read_skill`, other active
   * skills' tools, the baseline `.tool()` registry, provider tools), so an
   * input the author never imagined still has the whole normal surface.
   * The model owns judgment inside a step: run it, skip it with a recorded
   * reason, work around it, or stop and say why.
   *
   * Absent → this skill is byte-identical to today (zero-cost-when-unused:
   * no tool, no scope key, no event, no slot change).
   *
   * Steps are TURN-scoped: the pointer resets on every cursor move and on
   * every new run. Under a graph's `continuity: 'conversation'` the CURSOR
   * carries across turns and the re-tenured skill starts at step 1 on the
   * continued turn — the pointer is subordinate to the cursor, made
   * visible. (The prior turn's completed step results are still in the
   * restored history; the record is not lost, the pointer is fresh.)
   */
  readonly steps?: readonly SkillStep[];
  /**
   * What the framework does when the model skips a step with `skip_step`
   * (9.18.0): `'advance'` (default) — record the skip and move to the next
   * step; `'hold'` — record the skip and keep the step current (its tool
   * stays the offer; the model may retry it, use an escape hatch, or finish
   * and explain). Legal only beside `steps`.
   */
  readonly onSkip?: OnSkipPolicy;
  /**
   * Artifact KINDS this skill leaves behind (9.25.0) — the producer half of
   * its data vocabulary: `produces: ['chart/spec']`.
   *
   * A DECLARATION, not machinery. Nothing at run time reads it, nothing is
   * enforced at dispatch (that is `wants`' job, against the live store), and
   * a skill that declares none is byte-identical to one that never heard of
   * them. What it buys: the build-time check that a consumer's kind has a
   * producer somewhere (`artifact-kind-unsatisfied`), and a fact on this
   * skill's metadata that a lens can draw — the data legs of a run, before
   * the run.
   */
  readonly produces?: readonly string[];
  /**
   * Artifact KINDS this skill needs to have arrived (9.25.0):
   * `consumes: ['dataset/rows']` — "somebody upstream made a dataset; this
   * skill turns it into something".
   *
   * Checked at build against what the agent declares it produces. The check
   * is deliberately weak-but-true: it warns only when NOTHING on the agent
   * declares that kind, and it never fires when one of this skill's tools
   * declares `wants` for it (that ref is redeemed at dispatch from a store
   * that outlives the turn, so the kind can legitimately arrive from another
   * agent or an earlier run). See `skillVocabulary.ts` for the whole rule and
   * everything it cannot see.
   */
  readonly consumes?: readonly string[];
  /**
   * This skill's BRAIN (9.19.0) — "the cursor picks the brain": while a
   * mounted skill graph's cursor is on this skill, `callLLM` runs on this
   * provider instead of the agent's. Any `LLMProvider` port implementation;
   * vendor-neutral by construction. A provider whose `name` differs from
   * the agent's MUST also name `model` (the agent's model id belongs to
   * another vendor's namespace — refused at `Agent.build()` otherwise).
   * Legal only on agents that mount a graph; the same skill id may also be
   * declared in `skillGraph(graph, { providers })` — same choice is fine,
   * different choices are refused naming both homes. Absent → this skill is
   * byte-identical to today.
   */
  readonly provider?: import('../../../adapters/types.js').LLMProvider;
  /**
   * The model this skill's calls run on (9.19.0). Legal ALONE — the agent's
   * own provider, another model ("triage runs on the small one") — or
   * beside `provider`. Absent with `provider` set: inherits down the
   * precedence chain (escalation > skill brain > `.configure()` >
   * build-time default), which is legal only while the provider is the
   * agent's own.
   */
  readonly model?: string;
  /**
   * Cache policy for this skill's body. Defaults to `'while-active'` —
   * the body caches while the skill is in `activeInjections[]` (i.e.,
   * while it's the most-recently-activated skill); invalidates the
   * moment it deactivates.
   *
   * For skills with stable, frequently-accessed bodies, consider
   * `'always'` to keep the body cached even when temporarily inactive.
   * For skills with bodies that depend on per-iter state, use
   * `'never'` or `{ until: ... }`.
   *
   * See `CachePolicy` in `agentfootprint/src/cache/types.ts`.
   */
  readonly cache?: CachePolicy;
}

/**
 * Per-skill tool gating mode. See `DefineSkillOptions.autoActivate`.
 *
 * Reserved future values: `'always'` (always show this Skill's tools
 * regardless of activation), `'group'` (gate by a named skill group).
 */
export type AutoActivateMode = 'currentSkill';

/**
 * Resolve `surfaceMode: 'auto'` to a concrete mode based on provider
 * + model. The defaults match the per-provider attention profile
 * documented in the Skills, explained essay:
 *
 *   - Claude >= 3.5  → 'both'      (cheap to cache, high adherence)
 *   - Claude pre-3.5 → 'tool-only' (recency-first more reliable)
 *   - OpenAI / Bedrock / Ollama / Mock / unknown → 'tool-only'
 *
 * Pure function — no side effects. Consumers can call directly to
 * inspect what `'auto'` will resolve to in their stack.
 */
export function resolveSurfaceMode(provider: string, model?: string): SurfaceMode {
  const p = provider.toLowerCase();
  if (p === 'anthropic') {
    // Match both naming styles in current use:
    //   - claude-3-5-sonnet-..., claude-3.5-...
    //   - claude-sonnet-4-..., claude-haiku-4-..., claude-opus-4-..., claude-4-...
    // Anything matching "Claude >= 3.5" gets 'both'; older Claudes get 'tool-only'.
    if (model && /(claude-3-5|claude-3\.5|claude-(?:opus-|sonnet-|haiku-)?[4-9])/i.test(model)) {
      return 'both';
    }
    return 'tool-only';
  }
  return 'tool-only';
}

const SKILL_OPTION_KEYS = {
  id: true,
  description: true,
  title: true,
  body: true,
  tools: true,
  surfaceMode: true,
  autoActivate: true,
  steps: true,
  onSkip: true,
  produces: true,
  consumes: true,
  provider: true,
  model: true,
  cache: true,
} satisfies Record<keyof DefineSkillOptions, true>;

/** The unified facade consumes `type`; all skill options keep one owner. */
const SKILL_INJECTION_OPTION_KEYS = { ...SKILL_OPTION_KEYS, type: true } satisfies Record<
  keyof (DefineSkillOptions & { readonly type: 'skill' }),
  true
>;

/** The longest skill title a report prints. */
const MAX_SKILL_TITLE_CHARS = 60;

/**
 * Validate a declared `title` — refused where the author wrote it. `undefined`
 * when none was declared; otherwise the trimmed title.
 */
function readSkillTitle(id: string, raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const at = `defineSkill(${id}): \`title\``;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${at} must be a non-empty string — or omit it; a report then prints the id.`);
  }
  const title = raw.trim();
  const notPlain = plainLineProblem(at, title);
  if (notPlain !== undefined) throw new Error(notPlain);
  if (title.length > MAX_SKILL_TITLE_CHARS) {
    throw new Error(`${at} is ${title.length} characters; the limit is ${MAX_SKILL_TITLE_CHARS}.`);
  }
  if (title === id) {
    throw new Error(`${at} is the id itself — a title is the plain name a person reads; omit it.`);
  }
  return title;
}

export function defineSkill(opts: DefineSkillOptions): Injection {
  return createSkill(opts, SKILL_OPTION_KEYS);
}

/**
 * Internal facade entry, deliberately absent from every public barrel.
 * Validate the original declaration, preserving inherited options and getter
 * receivers. Only this entry consumes the unified factory's discriminant.
 */
export function defineSkillInjection(
  opts: DefineSkillOptions & { readonly type: 'skill' },
): Injection {
  return createSkill(opts, SKILL_INJECTION_OPTION_KEYS);
}

/** One validation/construction path for named and discriminated declarations. */
function createSkill(
  opts: DefineSkillOptions,
  optionKeys: Readonly<Record<string, true>>,
): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineSkill: `id` is required and must be non-empty.');
  }
  if (!opts.description || opts.description.length === 0) {
    throw new Error(
      `defineSkill(${opts.id}): \`description\` is required (LLM uses it to decide when to activate).`,
    );
  }
  if (!opts.body || opts.body.length === 0) {
    throw new Error(`defineSkill(${opts.id}): \`body\` is required.`);
  }
  assertKnownOptions(`defineSkill(${opts.id})`, opts, optionKeys);
  const title = readSkillTitle(opts.id, opts.title);
  // Steps checkup (9.18.0) — all the data is in hand HERE, so every step
  // refusal happens here: unknown tool, empty note/tool, steps:[], steps
  // without tools, onSkip without steps. See skillSteps.ts, the grammar owner.
  validateSkillSteps(opts.id, {
    ...(opts.steps !== undefined && { steps: opts.steps }),
    ...(opts.onSkip !== undefined && { onSkip: opts.onSkip }),
    toolNames: new Set((opts.tools ?? []).map((t) => t.schema.name)),
  });
  // The artifact vocabularies (9.25.0) — same law, same authoring point: a
  // blank kind, an empty list or a repeat is refused HERE, where the
  // declaration is written. Whether a consumed kind is SATISFIABLE needs the
  // whole agent and is checked at build (`skillVocabulary.ts`).
  assertArtifactVocabulary(`defineSkill(${opts.id})`, 'produces', opts.produces);
  assertArtifactVocabulary(`defineSkill(${opts.id})`, 'consumes', opts.consumes);
  return Object.freeze({
    id: opts.id,
    description: opts.description,
    // Top-level, not a `metadata` key: at least one path rebuilds `metadata`
    // wholesale (`toolsFromActiveSkill`), and a top-level field survives every
    // `{ ...injection }` spread (the `templated` precedent).
    ...(title !== undefined && { title }),
    flavor: 'skill' as const,
    trigger: {
      kind: 'llm-activated' as const,
      viaToolName: 'read_skill',
    },
    inject: {
      systemPrompt: opts.body,
      ...(opts.tools && opts.tools.length > 0 && { tools: opts.tools }),
    },
    // Skill-specific options live in metadata. The engine reads them
    // when present; absent metadata = current behavior. `surfaceMode` and
    // `autoActivate` are read at runtime.
    //
    // `cache` also rides this bag when a caller sets it.
    metadata: Object.freeze({
      surfaceMode: opts.surfaceMode ?? 'auto',
      ...(opts.autoActivate && { autoActivate: opts.autoActivate }),
      // The skill's brain (9.19.0) — rides the metadata bag like every other
      // per-skill option. NEVER projected (`projectActiveInjection`'s
      // allow-list does not carry it), so the live provider object stays on
      // the closure-held list and never crosses a scope boundary.
      // `Agent.build()` folds + validates it (`skillBrains.ts`).
      ...(opts.provider !== undefined && { provider: opts.provider }),
      ...(opts.model !== undefined && { model: opts.model }),
      // The procedure, as data (9.18.0). `Agent` folds these into one frozen
      // StepPlan map at build; the engine ignores them everywhere else, so a
      // consumer reading skills off this bag sees exactly what was declared.
      ...(opts.steps &&
        opts.steps.length > 0 && {
          steps: Object.freeze(opts.steps.map((s) => Object.freeze({ ...s }))),
          onSkip: opts.onSkip ?? ('advance' as const),
        }),
      // The artifact vocabularies (9.25.0) — recorded as declared, on the same
      // bag every other per-skill option rides. Build-time checks read them
      // from here, and so will a lens; the engine never does. Absent when not
      // declared, so a skill without them serializes byte-identically.
      ...(opts.produces !== undefined && { produces: Object.freeze([...opts.produces]) }),
      ...(opts.consumes !== undefined && { consumes: Object.freeze([...opts.consumes]) }),
      cache: resolveCachePolicy('skill', opts.cache),
    }),
  }) as unknown as Injection;
}
