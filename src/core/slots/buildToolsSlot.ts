/**
 * Tools slot subflow builder
 *
 * Pattern: Builder (returns a FlowChart mountable via addSubFlowChartNext).
 * Role:    Layer-3 context engineering. Resolves the tools list the LLM
 *          sees on this iteration — one InjectionRecord per exposed tool.
 * Emits:   None directly; ContextRecorder sees the writes.
 *
 * Minimal scope for Phase 3e: static tool registry, all exposed every
 * iteration. Full permission gating / skill activation / context-aware
 * tool filtering arrives in Phase 5.
 */

import { flowChart, isDevMode } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMToolSchema } from '../../adapters/types.js';
import { INJECTION_KEYS } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { COMPOSITION_KEYS } from '../../recorders/core/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';
import { menuOutstanding, type TurnRoute } from '../../lib/injection-engine/routingPolicy.js';
import { invariantViolationsOf } from '../../integrity/invariant-violation/check.js';
import { contextErrorIdentity } from '../../integrity/finding/types.js';
import { buildSkipStepTool } from '../../lib/injection-engine/skillTools.js';
import {
  currentStepOf,
  pointerOf,
  skipStepDescription,
  stepBannerPrefix,
  stepInProgress,
  type StepPlanFor,
  type StepPointerCarrier,
} from '../../lib/injection-engine/skillSteps.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import type { Tool } from '../tools.js';
import type { ToolProvider, ToolDispatchContext } from '../../tool-providers/types.js';
import { composeSlot, fnv1a, formatOverflowWarning, slotOverflow, truncate } from './helpers.js';

/**
 * Mutable cache shared between `buildToolsSlot` (writer) and
 * `buildToolCallsHandler` (reader) within ONE run. The Tools slot
 * resolves the provider's tools each iteration and stashes the
 * Tool[] here; the toolCalls handler reads on dispatch — so async
 * providers pay the discovery cost once, not twice. Scoped to the
 * chart build so concurrent `agent.run()` calls each get their own
 * cache.
 */
export interface ProviderToolCache {
  current: readonly Tool[];
}

export interface ToolsSlotConfig {
  /** Tool registry exposed to the LLM. Empty → empty slot (LLMCall case). */
  readonly tools: readonly LLMToolSchema[];
  /**
   * Registration-time owner stamps by tool name (9.60.0) — the identity
   * edges `Tool.owner` declared. The record then attributes a registry
   * tool to its OWNING subsystem instead of deriving `source:'registry'`.
   * Absent or unmatched → exactly today's bytes.
   */
  readonly toolOwners?: ReadonlyMap<string, import('../tools.js').ToolOwner>;
  /**
   * The mount kernel's map cards (9.60.0) — id + owned tool names, for the
   * compose-seam integrity backstop below. Present only when `.maps()` is
   * mounted; absent → the backstop never runs, byte-identical.
   */
  /**
   * The per-run disposition ledger, by REFERENCE (9.60.0) — the
   * ProviderToolCache pattern: build-closure plumbing, never scope state.
   * The compose backstop notes one disposition per pass here.
   */
  readonly integrityLedger?: {
    current: import('../../integrity/disposition/ledger.js').DispositionLedger | undefined;
  };
  readonly mountedMaps?: ReadonlyArray<{
    readonly id: string;
    readonly toolNames: readonly string[];
  }>;
  /**
   * Optional `ToolProvider` consulted PER-ITERATION (Block A5 follow-up).
   * When set, the slot calls `provider.list(ctx)` each iteration with
   * the current `{ iteration, activeSkillId, identity, signal }`.
   * Provider-supplied tool schemas are MERGED with the static `tools`
   * registry — both flow to the LLM. This is what makes Dynamic ReAct's
   * tool list reshape per iteration.
   */
  readonly toolProvider?: ToolProvider;
  /**
   * Mutable cache the slot writes to after resolving `toolProvider.list(ctx)`.
   * The same cache reference is passed to `buildToolCallsHandler` so
   * dispatch reads from this iteration's resolved Tool[] instead of
   * calling `list()` a second time. Required when `toolProvider` is set.
   */
  readonly providerToolCache?: ProviderToolCache;
  /**
   * Rebuild `read_skill`'s SCHEMA for this iteration's cursor (8.5.0).
   *
   * Set only for a `.skillGraph()` agent in a per-iteration ReAct mode. The tool's
   * enum is the full catalog and never changes; what varies is the DESCRIPTION —
   * which ids the gate will actually grant from where the cursor stands. Without it
   * the menu advertised every registered skill on every iteration while the gate
   * admitted a subset, so the model was routinely offered ids it would be refused.
   *
   * Substituted by NAME in Compose, so dispatch is untouched: the tool-calls handler
   * resolves executables from `registryByName`, never from the schema list.
   */
  readonly readSkillFor?: (args: {
    readonly currentSkillId?: string;
    readonly hiddenSkillIds?: readonly string[];
    /** The turn-start MENU (SG-C), passed only while the turn's menu verdict
     *  is outstanding — see the Compose stage. */
    readonly menu?: {
      readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
      readonly cursorId?: string;
      readonly stay?: boolean;
    };
  }) => LLMToolSchema;
  /**
   * Which skills the caller's role may NOT see this run (9.11.0).
   *
   * Resolved in the async Discover stage and read by the sync Compose stage —
   * the same shape `providerToolCache` uses, and for the same reason: a
   * `PermissionChecker` may be async (a Redis lookup, a hub call) and Compose
   * is pure. Set only when a checker declares it governs `'skill_read'`; then
   * every hidden skill's row disappears from the `read_skill` menu, and the
   * dispatch loop refuses the activation with the policy's own message.
   *
   * Its errors are NOT swallowed: a visibility resolver that throws leaves the
   * iteration to the same reliability rules a failed `ToolProvider.list` does,
   * because composing a menu from a policy that did not answer is exactly the
   * fail-open this feature exists to prevent.
   */
  readonly hiddenSkillIds?: () => Promise<readonly string[]> | readonly string[];
  /** Budget cap (chars). Default: 2000. Set from the public door as
   *  `contextBudget.tools` on `AgentOptions`. */
  readonly budgetCap?: number;
  /**
   * The frozen step plans, keyed by skill id (9.18.0) — set only when ≥1
   * registered skill declares `steps`. While a stepped tenure is active and
   * unfinished (`scope.stepPointer`, threaded by the mount mappers), Compose
   * narrows the OFFER to the current step: the stepped skill's own tools
   * that are not the current step's tool are held out of the request, the
   * current step's tool description leads with the `[Step k of n — <note>]`
   * banner (a rebuilt schema copy substituted BY NAME — the `read_skill`
   * precedent, so dispatch is untouched), and `skip_step` is appended.
   *
   * The escape hatches STAY OFFERED (house law): `read_skill`,
   * `list_skills`, every OTHER active skill's tools, the baseline `.tool()`
   * registry, provider tools. The hold-out applies only to names whose SOLE
   * active owner is the stepped skill — a name another active source also
   * carries (the same Tool reference shared across skills, a provider) is
   * somebody's escape hatch and is never pulled; a baseline `.tool()` can
   * never even collide (that overlap is refused at Agent build). Absent
   * plan / absent pointer / complete procedure → this path is
   * byte-identical to today.
   */
  readonly stepPlanFor?: StepPlanFor;
}

interface ToolsSubflowState {
  [k: string]: unknown;
}

/** Shared empty hold-out — the no-step iterations never allocate. */
const EMPTY_NAME_SET: ReadonlySet<string> = new Set();

/**
 * Build the Tools slot subflow.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(SUBFLOW_IDS.TOOLS, buildToolsSlot(cfg), 'Tools', {
 *     inputMapper: (parent) => ({ iteration: parent.iteration }),
 *     outputMapper: (sf) => ({ toolsInjections: sf.toolsInjections, toolSchemas: sf.toolSchemas }),
 *   })
 */
export function buildToolsSlot(config: ToolsSlotConfig): FlowChart {
  const budgetCap = config.budgetCap ?? 2000;
  const staticTools = config.tools;
  const readSkillFor = config.readSkillFor;
  const toolProvider = config.toolProvider;
  const providerToolCache = config.providerToolCache;
  const hiddenSkillIdsFor = config.hiddenSkillIds;
  const stepPlanFor = config.stepPlanFor;
  // The skip_step schema template — description is rebuilt per iteration
  // (it names the current step), everything else is static.
  const skipStepSchemaTemplate = stepPlanFor ? buildSkipStepTool().schema : undefined;
  // Written by Discover (async), read by Compose (sync) — see the config note.
  //
  // Chart-scoped, and the chart is built ONCE at Agent construction — so this
  // outlives a run. It is never stale at READ time because Discover always runs
  // before Compose in the same slot and overwrites it every iteration; and it
  // cannot cross callers because one Agent runs one turn at a time (and
  // `standingAgent({ agentFactory })` gives each session its own instance, and
  // therefore its own chart and its own closure).
  let hiddenSkillIds: readonly string[] = [];
  // Dedup latch for the human-facing warning, scoped to THIS built chart:
  // a 20-iteration ReAct loop must not print 20 identical warnings. The
  // typed `context.budget_pressure` event still fires every iteration and
  // carries the per-iteration truth.
  let warnedOverflow = false;
  // Same latch discipline for the provider↔skill tool-name shadow warning (8.7.0):
  // one console line per offending NAME per built chart. The typed event is unlatched.
  const warnedShadow = new Set<string>();

  // Stage 1 — Discover: consult the external ToolProvider (if any) and
  // resolve its Tool[] for this iteration. ALWAYS runs (even when no
  // provider) so the trace shape is consistent across agents — the
  // no-provider path early-returns in microseconds. When a provider IS
  // set, this stage owns the entire async-discovery boundary:
  //
  //   • own runtimeStageId (e.g., `sf-tools/discover#7`) so KeyedStore
  //     and SequenceStore can scope per-discovery latency / errors
  //   • own InOutRecorder boundary (entry/exit pair)
  //   • own narrative entry separating "I called the hub" from "I built
  //     the slot"
  //   • emits `tools.discovery_started`, `tools.discovery_completed` (or
  //     `tools.discovery_failed`) with timing + provider id
  //
  // Sync providers still pay zero microtask overhead — the dynamic
  // `instanceof Promise` check skips await for non-Promise returns.
  const discoverStage = async (scope: TypedScope<ToolsSubflowState>): Promise<void> => {
    // Per-role skill visibility (9.11.0), resolved on the ONE stage in this
    // slot that is allowed to await. Before the provider block so an agent
    // with skills but no `toolProvider` still gets its filter.
    if (hiddenSkillIdsFor) {
      const asked = hiddenSkillIdsFor();
      hiddenSkillIds = asked instanceof Promise ? await asked : asked;
    }
    if (!toolProvider) return; // No-op fast path: keeps trace shape consistent.

    const args = scope.$getArgs<{ iteration?: number }>();
    const iteration = args.iteration ?? 1;
    const env = scope.$getEnv();
    const activatedIds =
      (scope.$getValue('activatedInjectionIds') as readonly string[] | undefined) ?? [];
    const identity = scope.$getValue('runIdentity') as
      | { tenant?: string; principal?: string; conversationId: string }
      | undefined;
    // `activeSkillIds` is the REAL active set (8.7.0) — every skill the injection
    // engine resolved for this iteration, whatever activated it. `activeSkillId`
    // stays what it always was: the tail of `activatedInjectionIds`, which only
    // `read_skill` writes. The two answer different questions and both are needed.
    const activeSkillIds = (
      (scope.$getValue('activeInjections') as readonly ActiveInjection[] | undefined) ?? []
    )
      .filter((inj) => inj.flavor === 'skill')
      .map((inj) => inj.id);
    const ctx: ToolDispatchContext = {
      iteration,
      ...(activatedIds.length > 0 && { activeSkillId: activatedIds[activatedIds.length - 1] }),
      ...(activeSkillIds.length > 0 && { activeSkillIds }),
      ...(identity && { identity }),
      ...(env.signal && { signal: env.signal }),
    };

    typedEmit(scope, 'agentfootprint.tools.discovery_started', {
      providerId: toolProvider.id,
      iteration,
    });

    const startMs = Date.now();
    let visibleTools: readonly Tool[];
    try {
      // Dynamic check — sync providers skip the await microtask.
      const result = toolProvider.list(ctx);
      visibleTools = result instanceof Promise ? await result : result;
    } catch (err) {
      // Discovery failure is loud by design. Emit the typed event
      // with the providerId so consumers can route alerts; then
      // re-throw so a configured `reliability` rule decides whether
      // to retry / fall back / fail-fast. Silently dropping tools
      // mid-conversation creates non-deterministic agent behavior
      // harder to debug than a crash.
      const errMessage = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Error';
      typedEmit(scope, 'agentfootprint.tools.discovery_failed', {
        providerId: toolProvider.id,
        error: errMessage,
        errorName: errName,
        iteration,
        durationMs: Date.now() - startMs,
      });
      throw err;
    }

    typedEmit(scope, 'agentfootprint.tools.discovery_completed', {
      providerId: toolProvider.id,
      iteration,
      durationMs: Date.now() - startMs,
      toolCount: visibleTools.length,
    });

    // Cache the resolved Tool[] in the closure-shared ProviderToolCache.
    // The Compose stage reads providerSchemas from here; the toolCalls
    // handler reads the executable Tool objects on dispatch. Both share
    // ONE list() call per iteration. The cache lives outside scope
    // because Tool objects carry `execute` functions that can't be
    // `structuredClone`d into the transactional memory layer.
    if (providerToolCache) providerToolCache.current = visibleTools;
  };

  // Stage 2 — Compose: merges static + provider + per-skill schemas
  // into the tool slot. Pure compute, sync, fast. Reads provider tools
  // from `providerToolCache.current` populated by the Discover stage.
  const composeStage = (scope: TypedScope<ToolsSubflowState>): void => {
    const args = scope.$getArgs<{
      iteration?: number;
      currentSkillId?: string;
      turnRoute?: TurnRoute;
      stepPointer?: StepPointerCarrier;
    }>();
    const iteration = args.iteration ?? 1;

    // Active Injections — read once, up front: the step hold-out's ownership
    // rule and the per-skill schema readmission below both consume it.
    const activeInjections =
      (scope.$getValue('activeInjections') as readonly ActiveInjection[] | undefined) ?? [];

    // ── Per-step narrowing (9.18.0) ──────────────────────────────────
    // The pointer arriving here is THIS iteration's: the Injection Engine
    // re-keyed it and the mount mappers carry the fresh alias
    // (`nextStepPointer ?? stepPointer` — the nextSkillCursor pattern), so
    // the offer narrows on the very iteration a tenure begins. Absent
    // plan/pointer, or a complete procedure → every variable below is
    // undefined/empty and the compose path is byte-identical to today.
    const stepPointer = stepPlanFor ? pointerOf(args.stepPointer) : undefined;
    const stepPlan = stepPointer !== undefined ? stepPlanFor?.(stepPointer.skillId) : undefined;
    const stepNow =
      stepPlan !== undefined && stepInProgress(stepPointer)
        ? currentStepOf(stepPointer!, stepPlan)
        : undefined;
    // The hold-out: the stepped skill's own tools that are not the current
    // step's tool — MINUS every name another ACTIVE source also carries.
    // A shared name is somebody's escape hatch; the sequence owns only what
    // the stepped skill alone brought (the escape-hatches-stay house law).
    // The two live co-owners are OTHER active skills (the same Tool
    // reference shared across `tools:[]` arrays) and provider tools; a
    // baseline `.tool()` sharing a skill tool's name is REFUSED at Agent
    // build (`validateToolNameUniqueness` — ambiguous dispatch), so it can
    // never reach this rule.
    let stepHoldOut: ReadonlySet<string> = EMPTY_NAME_SET;
    if (stepNow !== undefined && stepPointer !== undefined && stepPlan !== undefined) {
      const ownedByOthers = new Set<string>();
      for (const inj of activeInjections) {
        if (inj.id === stepPointer.skillId) continue;
        for (const t of inj.inject.tools ?? []) ownedByOthers.add(t.schema.name);
      }
      if (toolProvider && providerToolCache) {
        for (const t of providerToolCache.current) ownedByOthers.add(t.schema.name);
      }
      const holdOut = new Set<string>();
      for (const name of stepPlan.toolNames) {
        if (name !== stepNow.tool && !ownedByOthers.has(name)) holdOut.add(name);
      }
      stepHoldOut = holdOut;
    }
    // The banner — a rebuilt schema copy substituted BY NAME (the
    // `read_skill` precedent), so dispatch is untouched and nothing else in
    // the list moves.
    const bannered = (schema: LLMToolSchema): LLMToolSchema =>
      stepNow !== undefined && schema.name === stepNow.tool
        ? {
            ...schema,
            description: `${stepBannerPrefix(stepPointer!, stepNow)}${schema.description}`,
          }
        : schema;

    // The turn-start MENU (SG-C) — composed from the SAME verdict the record
    // carries (`scope.turnRoute`, threaded by the mount mappers), and only
    // while it is OUTSTANDING: once an accepted pick moves the cursor, the
    // description stops offering a menu the turn has already resolved.
    // `menuOutstanding` is the one shared implementation (routingPolicy.ts).
    // Advisory relevance rides beside each candidate when the scorer ranked it.
    const turnRoute = args.turnRoute;
    const menu =
      turnRoute?.offered !== undefined && menuOutstanding(turnRoute, args.currentSkillId)
        ? {
            candidates: turnRoute.offered.map((id) => {
              const rel = turnRoute.relevance?.find((r) => r.id === id)?.relevance;
              return { id, ...(rel !== undefined && { relevance: rel }) };
            }),
            ...(args.currentSkillId !== undefined && { cursorId: args.currentSkillId }),
            ...(turnRoute.stayOffered === true && { stay: true }),
          }
        : undefined;

    // Per-iteration `read_skill` offer. The cursor arriving here is THIS iteration's:
    // the Injection Engine already advanced it and its outputMapper wrote it to the
    // parent before this slot mounts — the same value the read_skill gate will read
    // when the model answers. Substituted by name so nothing else in the list moves.
    const substituted = readSkillFor
      ? staticTools.map((t) =>
          t.name === 'read_skill'
            ? readSkillFor({
                ...(args.currentSkillId !== undefined && { currentSkillId: args.currentSkillId }),
                ...(hiddenSkillIds.length > 0 && { hiddenSkillIds }),
                ...(menu !== undefined && { menu }),
              })
            : t,
        )
      : staticTools;
    // Step narrowing over the STATIC list (9.18.0): hold out the stepped
    // skill's other tools (sole-owner names only — see stepHoldOut), lead the
    // current step's tool with the banner. No step in progress → the exact
    // array from the line above, untouched.
    const steppedTools =
      stepNow !== undefined
        ? substituted.filter((t) => !stepHoldOut.has(t.name)).map(bannered)
        : substituted;

    // ── PARK HOLD-OUT (9.59.0) — the mount kernel's own axis ────────────
    // A parked map's tools come off the wire here, in the STATIC list, which
    // is the only place they can be reached on the default posture.
    //
    // With `scopeTools` false (the default for flat graphs until 10.0.0) a
    // skill's tools are pre-loaded into the static registry and ride from
    // iteration 1 whatever the cursor says. So suppressing the ACTIVE set —
    // which is all parking used to do — stopped the prompt fragment and left
    // all four tool schemas riding: the wire did not merely stay silent about
    // the park, it contradicted it, showing the model tools for a skill whose
    // instructions had just vanished.
    //
    // This is NOT a change to `scopeTools` and does not touch the 10.0.0
    // ledger. The two dials are orthogonal and always were: `scopeTools`
    // answers "do this map's tools follow the CURSOR?", parking answers "is
    // this map talking at all?" — the kernel's whole thesis is that those are
    // different questions. Absent the kernel the set is empty and this line
    // returns the same array it was given.
    const parkedToolNames =
      (scope.$getValue('parkedToolNames') as readonly string[] | undefined) ?? [];
    const parkHoldOut = parkedToolNames.length > 0 ? new Set(parkedToolNames) : undefined;
    const tools =
      parkHoldOut !== undefined
        ? steppedTools.filter((t) => !parkHoldOut.has(t.name))
        : steppedTools;

    const ownerOf = config.toolOwners ?? new Map<string, import('../tools.js').ToolOwner>();
    const injections: InjectionRecord[] = tools.map((t, i) => {
      const summary = `${t.name}: ${t.description}`;
      // `source: 'registry'` — tools configured at build time via
      // `.tool(...)` are baseline API flow (the static tool list sent
      // to the LLM), NOT context engineering. Skills / Instructions
      // that gate tools dynamically tag their injections with their
      // flavor below.
      // A registration-time owner stamp (9.60.0) wins over the derived
      // default: the record then names the OWNING subsystem instead of the
      // tool's own name, which is what lets a checker ask "who owns X"
      // without a slot pass having run.
      const owner = ownerOf.get(t.name);
      return {
        contentSummary: truncate(summary, 80),
        contentHash: fnv1a(`tool:${t.name}:${t.description}`),
        slot: 'tools',
        source: owner?.kind ?? 'registry',
        ...(owner !== undefined ? { sourceId: owner.id } : { sourceId: t.name }),
        reason: owner !== undefined ? `owned by ${owner.kind} '${owner.id}'` : 'tool registry',
        rawContent: summary,
        position: i,
      };
    });

    const providerSchemas: LLMToolSchema[] = [];
    if (toolProvider && providerToolCache) {
      for (const t of providerToolCache.current) {
        // PARK HOLD-OUT, the same rule the registry list above and the
        // dynamic list below already apply. A provider tool sharing a parked
        // map's owned name used to merge here unfiltered and ride the wire,
        // and the compose-seam backstop further down could only REPORT it —
        // so parking, whose whole contract is that a parked map contributes
        // nothing by any route, leaked through exactly one of the three.
        //
        // It has to be filtered here rather than by the provider itself:
        // `ToolDispatchContext` carries the active skill but nothing about
        // engagement standing, so a `ToolProvider` cannot see that a map was
        // parked and this is the only layer that can.
        //
        // Not the same thing as the provider-wins-the-wire law on
        // `reportShadowedTools` below. That governs two ACTIVE sources
        // genuinely disagreeing about which schema should win. A parked map
        // is not competing — it is not talking at all.
        if (parkHoldOut?.has(t.schema.name) === true) continue;
        // Never held out by the STEP narrowing (a provider is an active
        // owner, so its names are excluded from stepHoldOut by construction)
        // — but a provider serving the CURRENT step's tool still gets the
        // banner the model reads.
        const schema = bannered(t.schema);
        providerSchemas.push(schema);
        const summary = `${schema.name}: ${schema.description}`;
        injections.push({
          contentSummary: truncate(summary, 80),
          contentHash: fnv1a(`tool:provider:${schema.name}`),
          slot: 'tools',
          source: 'registry',
          sourceId: schema.name,
          reason: `tool provider${toolProvider.id ? ` '${toolProvider.id}'` : ''}`,
          rawContent: summary,
          position: tools.length + providerSchemas.length - 1,
        });
      }
    }

    // Active Injections targeting the tools slot (Skills with tools=[…]),
    // read up top. An autoActivate STEPPED skill readmits through here, so
    // the step hold-out filters this source too — by the same sole-owner
    // rule (a name in stepHoldOut is provably the stepped skill's alone).
    const dynamicSchemas: LLMToolSchema[] = [];
    for (const inj of activeInjections) {
      const injTools = inj.inject.tools;
      if (!injTools || injTools.length === 0) continue;
      for (const tool of injTools) {
        if (stepNow !== undefined && stepHoldOut.has(tool.schema.name)) continue;
        // A parked map's tools never ride, by whichever route they arrive.
        if (parkHoldOut?.has(tool.schema.name) === true) continue;
        const schema = bannered(tool.schema);
        dynamicSchemas.push(schema);
        const summary = `${schema.name}: ${schema.description}`;
        injections.push({
          contentSummary: truncate(summary, 80),
          contentHash: fnv1a(`tool:${inj.flavor}:${inj.id}:${schema.name}`),
          slot: 'tools',
          source: inj.flavor,
          sourceId: inj.id,
          reason: `${inj.flavor} '${inj.id}' unlocked tool '${schema.name}'`,
          rawContent: summary,
          position: tools.length + providerSchemas.length + dynamicSchemas.length - 1,
        });
      }
    }

    // ── skip_step: offered ONLY while a step is in progress (9.18.0) ──
    // Dispatchable all along (buildToolRegistry auto-attached it), but its
    // schema enters the request here, description naming the current step,
    // the remaining count and the declared onSkip policy. No step → no
    // schema, no record — an agent between procedures offers exactly what
    // it always did.
    const stepSchemas: LLMToolSchema[] = [];
    if (stepNow !== undefined && stepPointer !== undefined && stepPlan !== undefined) {
      const skipSchema: LLMToolSchema = {
        ...skipStepSchemaTemplate!,
        description: skipStepDescription(stepPointer, stepPlan),
      };
      stepSchemas.push(skipSchema);
      const summary = `${skipSchema.name}: ${skipSchema.description}`;
      injections.push({
        contentSummary: truncate(summary, 80),
        contentHash: fnv1a(`tool:skill:${stepPointer.skillId}:${skipSchema.name}`),
        slot: 'tools',
        source: 'skill',
        sourceId: stepPointer.skillId,
        reason:
          `skill '${stepPointer.skillId}' step ${stepPointer.step} of ${stepPointer.total} ` +
          `— skip_step offered (procedure integrity)`,
        rawContent: summary,
        position: tools.length + providerSchemas.length + dynamicSchemas.length,
      });
    }

    scope.$setValue(INJECTION_KEYS.TOOLS, injections);
    // Merge schemas from all three sources, deduping by tool name.
    // Order: static .tool() registry FIRST (auto-attached read_skill /
    // list_skills land here when `.skills(registry)` is wired), then
    // external `.toolProvider()` output, then per-skill inject.tools.
    // First occurrence wins.
    //
    // Why dedupe matters: Neo wires `gatedTools(staticTools([listSkills,
    // readSkill]), policy.isAllowed)` AND calls `.skills(registry)` —
    // the framework auto-attaches its own `read_skill` from the skill
    // registry, AND the consumer's toolProvider emits one too. Without
    // dedupe both reach the LLM and Anthropic rejects the request:
    // "tools: Tool names must be unique."
    const seen = new Set<string>();
    const merged: LLMToolSchema[] = [];
    for (const t of [...tools, ...providerSchemas, ...dynamicSchemas, ...stepSchemas]) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      merged.push(t);
    }
    scope.toolSchemas = merged;
    // ── Compose-seam integrity backstop (9.60.0) ──────────────────────
    // The park hold-out filters the registry and skill lists, but PROVIDER
    // schemas merge unfiltered — a provider tool sharing a parked member's
    // name stays on the wire (the shadowing seam: provider wins the wire,
    // skill wins dispatch). That is the recorded two-channels contradiction
    // still reachable today, so the final merged list is checked against
    // every parked map's owned names. One finding per defect (identity
    // dedup via a scope-held seen list, written only when something fires),
    // filed as a typed event; the composition itself is never altered —
    // detection converts a silent inconsistency into an attributed one.
    if (config.mountedMaps !== undefined && parkHoldOut !== undefined) {
      const servedNames = merged.map((t) => t.name);
      const seenIds =
        (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ?? [];
      const newIds: string[] = [...seenIds];
      let comparedAnyMap = false;
      let firedThisPass = false;
      for (const map of config.mountedMaps) {
        const parkedOwned = map.toolNames.filter((n) => parkHoldOut.has(n));
        if (parkedOwned.length === 0) continue;
        comparedAnyMap = true;
        const findings = invariantViolationsOf(
          {
            mapId: map.id,
            standing: 'parked',
            iteration,
            ownedToolNames: parkedOwned,
          },
          { names: servedNames, provenance: 'tools slot (merged wire list)' },
        );
        if (findings.length > 0) firedThisPass = true;
        for (const f of findings) {
          const id = contextErrorIdentity({ ...f, epoch: undefined });
          if (newIds.includes(id)) continue;
          newIds.push(id);
          typedEmit(scope, 'agentfootprint.integrity.context_error', {
            ...f,
            seam: 'compose',
            iteration,
          });
        }
      }
      if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
      // The disposition (9.60.0): a pass with no parked map had nothing this
      // check could violate — stated as not-applicable, never as silence.
      config.integrityLedger?.current?.note(
        'invariant-violation',
        'compose',
        !comparedAnyMap ? 'not-applicable' : firedThisPass ? 'checked-fail' : 'checked-pass',
        firedThisPass ? Date.now() : undefined,
      );
    } else if (config.mountedMaps !== undefined) {
      // Maps mounted, nothing parked this pass: the registered check had no
      // applicable work — stated, so the liveness theorem never mistakes a
      // run that simply never parked for a dead checker.
      config.integrityLedger?.current?.note('invariant-violation', 'compose', 'not-applicable');
    }
    reportShadowedTools(scope, {
      iteration,
      ...(toolProvider?.id && { providerId: toolProvider.id }),
      providerSchemas,
      activeInjections,
      warnedShadow,
    });
    const composition = composeSlot(
      'tools',
      iteration,
      injections,
      budgetCap,
      toolProvider ? 'registry+provider+injections' : 'registry+injections',
    );
    scope.$setValue(COMPOSITION_KEYS.SLOT_COMPOSED, composition);

    // Overflow is LOUD. Nothing here truncates — the full tool definitions
    // always reach the LLM — so an over-budget slot is otherwise invisible
    // (headroomChars clamps to 0, droppedCount stays 0). Write a FRESH
    // single-record array: ContextRecorder re-dispatches every record in
    // the written value on every write, so appending would re-fire prior
    // iterations.
    const pressure = slotOverflow(composition);
    if (pressure) {
      scope.$setValue(COMPOSITION_KEYS.BUDGET_PRESSURE, [pressure]);
      if (!warnedOverflow) {
        warnedOverflow = true;
        console.warn(
          formatOverflowWarning({
            pressure,
            itemCount: injections.length,
            itemNoun: 'tool definition',
            contentNoun: 'definitions',
            remedy: 'Raise contextBudget.tools on the agent, or trim tool descriptions.',
          }),
        );
      }
    }
  };

  return flowChart<ToolsSubflowState>('Discover', discoverStage, 'discover', {
    description: 'Discover provider tools',
  })
    .addFunction('Compose', composeStage, 'compose', 'Compose tools slot')
    .build();
}

/**
 * Report a tool name a `ToolProvider` and an active SKILL both claim (8.7.0).
 *
 * The two sources disagree in opposite directions, and both directions are laws of
 * this codebase rather than races:
 *
 *   • **The provider wins the LLM's tool list.** The merge above is
 *     `[static, provider, skill]` with first-occurrence-wins, and an
 *     `autoActivate: 'currentSkill'` skill's tools are deliberately kept OUT of the
 *     static registry (`buildToolRegistry`), so the provider's schema — its name, its
 *     description, its `inputSchema` — is the one the model reads.
 *   • **The skill wins dispatch.** `lookupTool` checks `registryByName` first, and
 *     every skill tool is in that map (`buildToolRegistry` adds autoActivate tools
 *     explicitly so dispatch resolves once the skill is active). Provider tools are
 *     not in it. So the skill's `execute` is what runs.
 *
 * The model therefore reads one contract and calls a different implementation, with
 * nothing in the trace saying so. Reported rather than refused: the provider's list
 * is resolved per iteration (`list(ctx)`) and the skill has to be active, so there is
 * no build-time moment at which this is knowable.
 *
 * A static `.tool()` colliding with a skill tool is NOT reported here —
 * `buildToolRegistry` already throws on that pair at build time, which is the better
 * answer when the answer is available that early.
 */
function reportShadowedTools(
  scope: TypedScope<ToolsSubflowState>,
  input: {
    iteration: number;
    providerId?: string;
    providerSchemas: readonly LLMToolSchema[];
    activeInjections: readonly ActiveInjection[];
    /** Dedup latch for the console line, scoped to ONE built chart. */
    warnedShadow: Set<string>;
  },
): void {
  const { iteration, providerId, providerSchemas, activeInjections, warnedShadow } = input;
  if (providerSchemas.length === 0) return;
  const providerNames = new Set(providerSchemas.map((s) => s.name));
  for (const inj of activeInjections) {
    for (const tool of inj.inject.tools ?? []) {
      const toolName = tool.schema.name;
      if (!providerNames.has(toolName)) continue;
      // The EVENT fires every iteration — it is the channel that reaches production,
      // where a dynamic provider can start shadowing on iteration 9 of a run nobody
      // is watching. The console line is dev-mode only and latched per tool name, so
      // a 20-iteration loop prints once (same discipline as the overflow warning).
      typedEmit(scope, 'agentfootprint.tools.shadowed', {
        toolName,
        iteration,
        schemaFrom: 'provider',
        ...(providerId && { schemaFromId: providerId }),
        dispatchTo: 'skill',
        dispatchToId: inj.id,
      });
      if (!isDevMode() || warnedShadow.has(toolName)) continue;
      warnedShadow.add(toolName);
      // eslint-disable-next-line no-console
      console.warn(
        `agentfootprint tools: '${toolName}' is declared by BOTH the tool provider` +
          `${providerId ? ` '${providerId}'` : ''} and the active skill '${inj.id}'. The model ` +
          `is shown the PROVIDER's description, but dispatch always resolves the SKILL's ` +
          `implementation — so the model reads one tool's contract and calls another's. Rename ` +
          `one of them, or drop it from the skill's tools:[] if the provider is meant to own it.`,
      );
    }
  }
}
