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

import { isDevMode } from 'footprintjs';
import type { Injection } from '../types.js';
import type { Tool } from '../../../core/tools.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';
import { validateSkillSteps, type OnSkipPolicy, type SkillStep } from '../skillSteps.js';

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

/**
 * When (if ever) to re-deliver a Skill's body in long-running runs.
 *
 * Even on providers with strong system-prompt adherence, attention to
 * the system slot decays past long contexts. `refreshPolicy` was declared
 * to re-inject the body via tool result past a token threshold so the LLM
 * sees it fresh again.
 *
 * @deprecated **DEPRECATED-pending-steps (9.16.0) — stored, never read, and
 * it will stay that way.** `defineSkill` records what you pass on
 * `skill.metadata.refreshPolicy` and nothing in the engine has ever read it:
 * no re-injection happens today, on any version. The hook is superseded by a
 * planned steps-as-data feature, which will own re-delivery declaratively —
 * this field will NOT be wired up in the meantime, and will be removed in the
 * next major after steps ship. The field stays accepted (additive-only law)
 * so existing declarations keep compiling; dev mode warns once per process
 * when one is set. If you need a body re-surfaced in a long run today,
 * deliver it yourself (e.g. `surfaceMode: 'both'`, so every `read_skill`
 * call returns the body afresh).
 */
export interface RefreshPolicy {
  /**
   * Re-inject the Skill body once the run has consumed this many input
   * tokens since the Skill was last surfaced. Recommended: 50_000 for
   * 200k-context models; 20_000 for 32k-context models.
   */
  readonly afterTokens: number;
  /**
   * How to re-inject. `'tool-result'` synthesizes a fresh tool result
   * carrying the body text (recency-first). Other modes reserved.
   */
  readonly via: 'tool-result';
}

export interface DefineSkillOptions {
  readonly id: string;
  /** Visible to the LLM via the activation tool's description. */
  readonly description: string;
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
   * Intent to re-deliver the body past a token threshold, to defend
   * against long-context attention decay. Default: undefined.
   *
   * @deprecated DEPRECATED-pending-steps (9.16.0): recorded on the Skill's
   * metadata, never acted on by the engine, and superseded by a planned
   * steps-as-data feature — it will not be wired up. Dev mode warns once per
   * process when set. See `RefreshPolicy` for what to do instead today.
   */
  readonly refreshPolicy?: RefreshPolicy;
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

/**
 * Refuse a `viaToolName` option that no longer exists (9.0.0 grace error).
 *
 * The option was deprecated in 8.7.0 and removed here. `'read_skill'` is the
 * only activation tool this library has ever built: the evaluator activates an
 * `llm-activated` skill by matching `ctx.activatedInjectionIds`, only
 * `read_skill` writes that array, and nothing ever read the field. 8.7.0 made
 * a non-`read_skill` value a mount-time refusal; 9.0.0 deletes the option.
 *
 * Deleting a type member alone would have been a silent DOWNGRADE: an object
 * literal gets an excess-property error, but an options bag arriving through a
 * variable does not — and the value would then be ignored where 8.7.0 refused
 * it. So the field is read at run time exactly once more, to say it is gone.
 *
 * Deleted in 10.0.0.
 */
function assertNoViaToolName(where: string, opts: object): void {
  const legacy = (opts as { readonly viaToolName?: unknown }).viaToolName;
  if (legacy === undefined) return;
  throw new Error(
    `${where}: \`viaToolName\` was removed in 9.0.0 (deprecated since 8.7.0), and this call ` +
      `passes '${String(legacy)}'. It never did anything: 'read_skill' is the only activation ` +
      `tool this library builds, the evaluator matches on ctx.activatedInjectionIds — which ` +
      `only read_skill writes — and no tool was ever created from this name. Drop the option: ` +
      `skills already share ONE activation tool and the model picks WHICH skill by id. If you ` +
      `need the skill gated on something else, use a \`rule\` trigger or a skillGraph() edge.`,
  );
}

/** One warn per process for the deprecated `refreshPolicy` — the field is
 *  accepted (additive-only law) but a declaration that does nothing should
 *  say so ONCE, not on every skill of a 40-skill catalog. */
let warnedRefreshPolicyDeprecated = false;

/**
 * The dev-mode deprecation warn for `refreshPolicy` (9.16.0). Named, not
 * inlined, so the once-flag and the message live beside each other.
 */
function warnRefreshPolicyDeprecated(skillId: string): void {
  if (warnedRefreshPolicyDeprecated || !isDevMode()) return;
  warnedRefreshPolicyDeprecated = true;
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint defineSkill('${skillId}'): \`refreshPolicy\` is DEPRECATED-pending-steps — ` +
      'it is stored on skill.metadata and nothing in the engine reads it, so NO re-injection ' +
      'happens. It is superseded by a planned steps-as-data feature and will not be wired up. ' +
      "To re-surface a body in a long run today, use surfaceMode: 'both' (read_skill returns " +
      'the body afresh) or deliver it yourself. This warning fires once per process.',
  );
}

export function defineSkill(opts: DefineSkillOptions): Injection {
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
  assertNoViaToolName(`defineSkill(${opts.id})`, opts);
  if (opts.refreshPolicy) warnRefreshPolicyDeprecated(opts.id);
  // Steps checkup (9.18.0) — all the data is in hand HERE, so every step
  // refusal happens here: unknown tool, empty note/tool, steps:[], steps
  // without tools, onSkip without steps. See skillSteps.ts, the grammar owner.
  validateSkillSteps(opts.id, {
    ...(opts.steps !== undefined && { steps: opts.steps }),
    ...(opts.onSkip !== undefined && { onSkip: opts.onSkip }),
    toolNames: new Set((opts.tools ?? []).map((t) => t.schema.name)),
  });
  return Object.freeze({
    id: opts.id,
    description: opts.description,
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
    // `autoActivate` are read at runtime; `refreshPolicy` is recorded here
    // and not yet acted on by anything (see its docstring — it is stored,
    // not honoured).
    //
    // `cache` also rides this bag when a caller sets it.
    metadata: Object.freeze({
      surfaceMode: opts.surfaceMode ?? 'auto',
      ...(opts.refreshPolicy && { refreshPolicy: opts.refreshPolicy }),
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
      cache: resolveCachePolicy('skill', opts.cache),
    }),
  }) as unknown as Injection;
}
