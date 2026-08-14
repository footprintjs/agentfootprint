/**
 * buildAgentChart — assemble the agent's full footprintjs FlowChart
 * from stage functions + slot subflows + memory wiring.
 *
 * This is the "chart composition" that used to live inline in
 * `Agent.buildChart()`. Extracted for v2.11.2 so:
 *
 *   1. Agent.ts focuses on Agent class lifecycle (constructor, run,
 *      attach, getSpec) instead of chart wiring details.
 *   2. The reliability gate chart (v2.11.x) wires into ONE focused
 *      file rather than surgically into Agent.ts's 250-line composition
 *      block.
 *   3. The composition is independently readable + reviewable —
 *      consumers building custom agent shapes have a reference.
 *
 * Chart shape:
 *
 *     Initialize
 *       → [memory READ subflows for each .memory()]
 *       → InjectionEngine (subflow)               ← loop target (tool-calls loops here)
 *       → Context (selector, PARALLEL fan-out, failFast)
 *             ⇉ {System Prompt ‖ Messages ‖ Tools}  (slot subflows)
 *             → converge
 *       → UpdateSkillHistory
 *       → Cache (sf-cache subflow: decideCacheMarkers → CacheGate
 *                → ApplyMarkers / SkipCaching)
 *       → CallLLM (also emits the per-iteration iteration_start marker)
 *       → [NormalizeThinking] (subflow, only when a ThinkingHandler resolved)
 *       → Route (decider)
 *             ├─ tool-calls (pausable) → loopTo(InjectionEngine)   ← branch-sourced loop
 *             └─ final (subflow) → terminal leaf
 *                          ┌────── PrepareFinal
 *                          ├──── [memory WRITE subflows]
 *                          └──── BreakFinal ($break)
 *
 * (This chart has no reliability subflow, and never grew one. The plan
 * described here — "the reliability gate chart mounts as a subflow before
 * CallLLM with a TranslateFailFast stage after it. Lands in the next
 * commit." — did not land: `.reliability()` is implemented INLINE in the
 * CallLLM stage by `executeWithReliability`, and
 * `buildReliabilityGateChart` is reachable from no shipped path. Verified
 * 2026-07-28.)
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart, select } from 'footprintjs';
import type { FlowChart, StructureRecorder, TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../adapters/types.js';
import type { CachePolicy } from '../../cache/types.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../conventions.js';
import {
  EMPTY_ACTIVE_BY_SLOT,
  type ActiveBySlot,
} from '../../lib/injection-engine/buildInjectionEngineSubflow.js';
import type { ActiveInjection, Injection } from '../../lib/injection-engine/types.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import { memoryInjectionKey, retrievalEvidenceKey } from '../../memory/define.types.js';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import { mountMemoryRead, mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline.js';
import { withMemoryRecall } from './memoryRecallInjections.js';
import { breakFinalStage } from './stages/breakFinal.js';
import { prepareFinalStage } from './stages/prepareFinal.js';
import { buildCacheSubflow } from './buildCacheSubflow.js';
import type { RouteBranch } from './stages/route.js';
import type { AgentState } from './types.js';

/**
 * Stage handlers + slot subflows the chart composer needs. Mostly
 * passed through verbatim from Agent.buildChart() — the chart shape
 * is identical to what was inline before.
 */
export interface AgentChartDeps {
  /** Memory READ/WRITE pipeline definitions (one per `.memory()`). */
  readonly memories: readonly MemoryDefinition[];

  /** Evidence bridge (#5): `causalEvidenceRecorder().collect`, threaded into
   *  CAUSAL memories' write mounts so snapshots persist real evidence
   *  (decisions/toolCalls/iterations/duration/tokens) instead of zeros.
   *  Set by the Agent when any mounted memory is CAUSAL. */
  readonly causalEvidenceSource?: () => import('../../memory/causal/evidenceRecorder.js').RunEvidence;

  /** Cache policy for the system-prompt slot, threaded into
   *  CacheDecision's inputMapper so its decision rules can match. */
  readonly systemPromptCachePolicy: CachePolicy;

  /** Hard ReAct iteration cap, threaded into CacheDecision's
   *  inputMapper for max-iteration policies. */
  readonly maxIterations: number;

  // ─ Stage handlers ───────────────────────────────────────────────
  readonly seed: (scope: never) => void | Promise<void>;
  readonly callLLM: (scope: never) => Promise<void>;
  readonly routeDecider: (scope: never) => RouteBranch | Promise<RouteBranch>;
  readonly toolCallsHandler: import('footprintjs').PausableHandler<never>;
  /**
   * The schema re-ask branch (7.26). Present ONLY when the agent was built
   * with `.outputSchema(parser, { retries })` — and when present it is a
   * THIRD branch of the Route decider carrying the same `{ loopTo }` the
   * tool branch does, because a re-ask is one more ordinary turn.
   *
   * Conditional mount, for the reason every conditional mount here exists:
   * an agent that did not opt in gets no branch, no stage, no scope key and
   * no event — its chart and its commit log are the ones it always had.
   */
  readonly outputRetryStage?: (scope: never) => void;

  // ─ Slot subflows ───────────────────────────────────────────────
  readonly injectionEngineSubflow: FlowChart;
  /** Relevance entry router (`entryByRelevance`) — a once-per-turn function stage
   *  mounted before the InjectionEngine (off the ReAct loop). Present only when the
   *  skill graph was built with a relevance scorer. */
  readonly pickEntryStage?: (scope: never) => Promise<void>;
  /**
   * The turn-start routing CASCADE stage (SG-C) — subsumes PickEntry on
   * graphs that run it (`classify` configured, or `continuity:
   * 'conversation'`). Mounted in the SAME slot under the SAME id
   * (`STAGE_IDS.PICK_ENTRY`) so recorded structures stay stable; never
   * present together with `pickEntryStage` (Agent.buildChart picks exactly
   * one). Absent → the chart is byte-identical to 9.16.
   */
  readonly routeTurnStage?: (scope: never) => Promise<void>;
  /**
   * The window-strategy stage (`.window()` / `.compaction()`). Present ONLY
   * when the consumer configured a strategy — and when present it BECOMES the
   * ReAct loop target, mounted immediately before the current one.
   *
   * It has to be the loop target rather than merely sit in the loop body:
   * the loop is branch-sourced (`tool-calls → { loopTo }`), so anything ahead
   * of the target runs once and is never seen again. Being the target also
   * puts the window change BEFORE the injection engine and the slots, which
   * is the point — the triggers, the three slots and the wire then all see
   * the same window, and no component gets a different past than the model
   * does.
   *
   * `strategyName` rides along so the chart itself says which policy is
   * mounted; a reader of the graph should not have to guess.
   */
  readonly windowStage?: {
    readonly strategyName: string;
    readonly run: (scope: never) => Promise<void>;
  };
  /**
   * The messages-slot DELIVERY stage (7.21). Present ONLY when the agent has
   * something that could target the messages slot — a registered injection
   * declaring `inject.messages`, or any `.memory()` whose recall might format
   * as a non-system role. When absent the chart is the one it always was, so
   * an agent with nothing to deliver is byte-identical to 7.20.
   *
   * Mounted between the InjectionEngine and the Context fan-out: after the
   * engine has decided what is active, before anything reads the window. The
   * placement is the design — a delivered message has to be part of the past
   * that the slots project, the cache decision indexes, and the wire sends,
   * or the recording and the request would disagree about the conversation.
   */
  readonly deliverStage?: (scope: never) => void;
  readonly systemPromptSubflow: FlowChart;
  readonly messagesSubflow: FlowChart;
  readonly toolsSubflow: FlowChart;
  /**
   * Optional thinking-normalization sub-subflow (v2.14+). Mounted as a
   * stage AFTER CallLLM, BEFORE Route, only when a `ThinkingHandler`
   * resolved (either auto-wired by `provider.name` or explicitly set
   * via `.thinkingHandler()`). When undefined, the stage is NOT added —
   * zero overhead for non-thinking agents (build-time conditional mount).
   */
  readonly thinkingSubflow?: FlowChart;

  // ─ Cache layer ──────────────────────────────────────────────────
  // The decision + gate now live inside `buildCacheSubflow()` (sf-cache),
  // which imports them directly — so they are NOT threaded through deps.
  // Only UpdateSkillHistory stays a main-loop stage (see buildCacheSubflow.ts).
  readonly updateSkillHistoryStage: (scope: never) => void;

  /**
   * Whether ≥1 Skill is registered. The `UpdateSkillHistory` stage (and
   * therefore the cache's skill-churn rule) is mounted ONLY when true:
   * with no skills the window would record "no skill" every iteration and
   * `detectSkillChurn` could never fire, so the stage would be pure dead
   * weight + a misleading box. Mirrors the `skills.length > 0` gate that
   * auto-attaches `read_skill`, and the `thinkingSubflow` conditional mount.
   */
  readonly hasSkills: boolean;

  /**
   * Whether ≥1 registered skill declares `steps` (9.18.0). Gates the step
   * pointer's mapper threading — engine in/out, the tools-slot arg, and (in
   * the grouped chart) the `sf-llm-call` boundary — so an agent without
   * stepped skills seeds and commits exactly the keys it always did. The
   * threading lives HERE in the builders, not in the subflow (the SG-C
   * blast-radius lesson): the alias discipline is
   * `stepPointer` in (readonly input) → Evaluate writes `nextStepPointer`
   * (the currentSkillId/nextSkillCursor precedent — the pointer changes
   * every iteration, so the turn-constant `turnRoute` pattern would serve
   * the tools slot a stale value) → mappers carry the alias back onto the
   * parent's `stepPointer`.
   */
  readonly hasSteps?: boolean;

  /**
   * The unfinished-steps nudge branch (9.18.0). Present ONLY on an agent
   * with ≥1 stepped skill — and when present it is one more branch of the
   * Route decider carrying the same `{ loopTo }` the tool branch does,
   * because a nudge is one more ordinary turn (the SchemaRetry mechanism
   * verbatim). Absent → no branch, no stage, no scope key, no event.
   */
  readonly stepNudgeStage?: (scope: never) => void;

  /**
   * The evidence recheck branch (9.35.0). Present ONLY on an agent built with
   * `.namesAndNumbersFromEvidence({ posture: 'guard' | 'rails' })` — the
   * `'assist'` posture records and never loops, so it mounts no branch. One
   * more branch of the Route decider carrying the same `{ loopTo }` the tool
   * branch does, because a correction is one more ordinary turn (the
   * SchemaRetry mechanism verbatim). Absent → no branch, no stage, no event.
   */
  readonly evidenceRecheckStage?: (scope: never) => void;

  /**
   * The evidence gate is mounted (9.35.0), at ANY posture. In the GROUPED
   * chart this gates bubbling `systemPromptInjections` out of `sf-llm-call`:
   * the slot writes it INSIDE the subflow and the outer Route decider needs
   * it to exempt values the app's own prompt (base prompt, skill body, a
   * retrieved passage) supplied — without the mapper key the gate would flag
   * the prompt's own identifiers in the default grouped shape (the
   * `hasEscalation` blast-radius lesson, one field down). The flat chart
   * shares one scope and needs no key; the flag is still threaded there so
   * both builders read the same deps object.
   */
  readonly hasEvidenceGate?: boolean;

  /**
   * An escalation brain is declared (9.19.0). In the GROUPED chart this
   * gates threading `skillEscalated` across the `sf-llm-call` boundary —
   * the flip is written by tool-calls on the OUTER scope and read by
   * callLLM INSIDE the subflow, so without the mapper key the escalation
   * would silently never serve a call in the default grouped shape (the
   * SG-C blast-radius lesson: the threading lives in the builders). The
   * flat chart shares one scope and needs no key; the flag is still
   * accepted here so both builders take identical deps.
   */
  readonly hasEscalation?: boolean;

  /**
   * ReAct loop semantics. `'dynamic'` (default) re-runs the InjectionEngine +
   * all 3 slots every iteration (loop → InjectionEngine). `'classic'`
   * engineers context ONCE (InjectionEngine + system-prompt + tools up front)
   * and loops only the Messages slot (loop → Messages). See AgentOptions.reactMode.
   */
  readonly reactMode?: 'classic' | 'dynamic';

  // ─ Build-time recorders (optional) ─────────────────────────────
  /** Structure recorders threaded into both `flowChart()` calls (the
   *  main chart and the PrepareFinal sub-chart). Each recorder
   *  observes per-node build events (`onStageAdded` /
   *  `onSubflowMounted` / etc.) for the Agent's chart. Undefined when
   *  the consumer didn't attach any. */
  readonly structureRecorders?: readonly StructureRecorder[];
}

/**
 * Build the agent's complete FlowChart from the supplied deps.
 */
export function buildAgentChart(deps: AgentChartDeps): FlowChart {
  // ReAct loop semantics. 'classic' caches the static slots (engineer
  // system-prompt + tools only on the first turn); 'dynamic' (default)
  // re-engineers all 3 slots every turn. Drives the Context selector below.
  const reactMode = deps.reactMode ?? 'dynamic';

  // Memory ids whose recall must be bridged into the slot composers (see
  // memoryRecallInjections). Empty → withMemoryRecall is a no-op.
  // Carries the flavor too (8.8.0): a corpus retrieval composes as
  // `source: 'rag'`, conversation recall as `source: 'memory'`.
  const memoryIds = deps.memories.map((m) => ({
    id: m.id,
    ...(m.flavor !== undefined && { flavor: m.flavor }),
  }));

  // ── Final-branch subflow ─────────────────────────────────────
  // Split so memory-write subflows can mount BETWEEN setting
  // finalContent and breaking the ReAct loop. PrepareFinal captures
  // the turn payload; BreakFinal terminates the loop.
  let finalBranchBuilder = flowChart<AgentState>(
    'PrepareFinal',
    prepareFinalStage,
    'prepare-final',
    {
      ...(deps.structureRecorders !== undefined && {
        structureRecorders: [...deps.structureRecorders],
      }),
      description: 'Capture turn payload (finalContent + newMessages)',
    },
  );
  for (const m of deps.memories) {
    if (m.write) {
      finalBranchBuilder = mountMemoryWrite(finalBranchBuilder, {
        pipeline: {
          read: unwrapMemoryFlowChart(m.read) as never,
          write: unwrapMemoryFlowChart(m.write) as never,
        },
        identityKey: 'runIdentity',
        turnNumberKey: 'turnNumber',
        contextTokensKey: 'contextTokensRemaining',
        newMessagesKey: 'newMessages',
        writeSubflowId: `sf-memory-write-${m.id}`,
        ...(m.corpus !== undefined && { identityOverride: m.corpus }),
        // Evidence bridge (#5): only CAUSAL pipelines consume run evidence.
        ...(m.type === 'causal' &&
          deps.causalEvidenceSource && { evidenceSource: deps.causalEvidenceSource }),
      });
    }
  }
  const finalBranchChart = finalBranchBuilder
    .addFunction('BreakFinal', breakFinalStage, 'break-final', 'Terminate the ReAct loop')
    .build();

  // ── Main chart ──────────────────────────────────────────────
  // Description prefix `Agent:` is a taxonomy marker — consumers
  // (Lens + FlowchartRecorder) detect Agent-primitive subflows via
  // this prefix and flag them as true agent boundaries (separate
  // from LLMCall subflows which use `LLMCall:` prefix).
  let builder = flowChart<AgentState>('Initialize', deps.seed as never, STAGE_IDS.SEED, {
    ...(deps.structureRecorders !== undefined && {
      structureRecorders: [...deps.structureRecorders],
    }),
    // Tag the mode so the Lens can label the run. Keep the `Agent:` taxonomy
    // prefix (consumers detect Agent boundaries by it). Dynamic keeps the
    // historical 'Agent: ReAct loop' string for byte-stability.
    description: reactMode === 'classic' ? 'Agent: Classic ReAct loop' : 'Agent: ReAct loop',
  });

  // Memory READ subflows — mounted between Initialize and InjectionEngine
  // for TURN_START timing (default). Each memory writes to its own
  // scope key (`memoryInjection_${id}`) so multiple `.memory()`
  // registrations layer without colliding.
  for (const m of deps.memories) {
    builder = mountMemoryRead(builder, {
      pipeline: {
        read: unwrapMemoryFlowChart(m.read) as never,
        ...(m.write !== undefined && { write: unwrapMemoryFlowChart(m.write) as never }),
      },
      identityKey: 'runIdentity',
      turnNumberKey: 'turnNumber',
      contextTokensKey: 'contextTokensRemaining',
      injectionKey: memoryInjectionKey(m.id),
      // The retrieval record, lifted into ROOT state so a backward slice
      // can reach the passage instead of stopping at this mount.
      evidenceKey: retrievalEvidenceKey(m.id),
      readSubflowId: `sf-memory-read-${m.id}`,
      // A corpus reads under its OWN namespace, not the run's identity.
      ...(m.corpus !== undefined && { identityOverride: m.corpus }),
    });
  }

  // The turn-start slot — ONE stage, two possible occupants, same id
  // (recorded structures stay stable). RouteTurn is the SG-C cascade
  // (rules → classifier/scorer → menu, continuity honored); PickEntry is the
  // 9.x relevance router, byte-identical for graphs without the new options.
  if (deps.routeTurnStage) {
    builder = builder.addFunction(
      'RouteTurn',
      deps.routeTurnStage as never,
      STAGE_IDS.PICK_ENTRY,
      'Route the turn start: declared rules, then the scorer, else offer a menu (cascade)',
    );
  } else if (deps.pickEntryStage) {
    builder = builder.addFunction(
      'PickEntry',
      deps.pickEntryStage as never,
      STAGE_IDS.PICK_ENTRY,
      'Pick the starting skill by relevance to the message (entryByRelevance)',
    );
  }

  // Window strategy — mounted immediately before the current loop target, and
  // it BECOMES the loop target below. That placement is the whole design: the
  // window changes once per iteration boundary, before the injection engine
  // re-evaluates triggers and before the slots compose, so nothing downstream
  // reasons over a window the model will not be sent.
  if (deps.windowStage) {
    builder = builder.addFunction(
      'Compact',
      deps.windowStage.run as never,
      STAGE_IDS.COMPACT,
      `Apply the '${deps.windowStage.strategyName}' window strategy to the live window`,
    );
  }
  // Where `tool-calls` loops back to. With a window strategy the head moves
  // one stage earlier; without it, this is the id it has always been.
  const loopTarget: string = deps.windowStage ? STAGE_IDS.COMPACT : SUBFLOW_IDS.INJECTION_ENGINE;

  builder = builder
    // Injection Engine — evaluates every Injection's trigger once
    // per iteration; writes activeInjections[] to parent scope for
    // the slot subflows to consume. Skipped if no injections were
    // registered (no observable difference, just one more no-op
    // subflow boundary).
    .addSubFlowChartNext(
      SUBFLOW_IDS.INJECTION_ENGINE,
      deps.injectionEngineSubflow,
      'Injection Engine',
      {
        inputMapper: (parent) => ({
          iteration: parent.iteration as number | undefined,
          userMessage: parent.userMessage as string | undefined,
          history: parent.history as readonly LLMMessage[] | undefined,
          lastToolResult: parent.lastToolResult as { toolName: string; result: string } | undefined,
          // The WHOLE batch, in call order (9.16.0) — `lastToolResult` is its
          // last entry. Routes/`on-tool-return` triggers see every parallel call.
          toolResults: parent.toolResults as
            | ReadonlyArray<{ toolName: string; result: string; toolCallId: string }>
            | undefined,
          activatedInjectionIds:
            (parent.activatedInjectionIds as readonly string[] | undefined) ?? [],
          // Last turn's per-slot active set so the engine's Delta stage can
          // diff "what changed per slot". Persists across the ReAct loop in
          // the (flat) parent scope; empty on turn 1.
          priorActiveByslot:
            (parent.activeByslot as ActiveBySlot | undefined) ?? EMPTY_ACTIVE_BY_SLOT,
          // Skill-graph cursor as of the previous iteration — the `from`-gate the
          // route triggers compare against. Undefined on cold start / no graph.
          currentSkillId: parent.currentSkillId as string | undefined,
          // The `read_skill` pick the gate accepted last iteration — the model's
          // own move through the graph (one-shot; the tool-calls stage rewrites it).
          pendingSkillPick: parent.pendingSkillPick as string | undefined,
          // Relevance entry ranking (from an entry scorer) — read by defineRelevanceHint.
          entryScores: parent.entryScores as
            | ReadonlyArray<{ id: string; score: number; relevance: number }>
            | undefined,
          entryScorer: parent.entryScorer as string | undefined,
          // The turn-start verdict (SG-C) — written once by RouteTurn; the
          // resolver consumes it on iteration 1, the menu hint reads `offered`.
          turnRoute: parent.turnRoute as
            | import('../../lib/injection-engine/routingPolicy.js').TurnRoute
            | undefined,
          // The step pointer as of the previous iteration (9.18.0) — a
          // readonly input for the Evaluate re-key. Threaded only for agents
          // with a stepped skill, so every other agent's engine args are the
          // exact bytes they always were.
          ...(deps.hasSteps === true && { stepPointer: parent.stepPointer }),
          // The typed tool-effects carriers (9.19.0) — value-conditional (the
          // `resolvedModel` precedent): the keys exist only after a tool
          // actually granted one, so every other run's engine args are the
          // exact bytes they always were.
          ...(parent.pendingToolTransition !== undefined && {
            pendingToolTransition: parent.pendingToolTransition,
          }),
          ...(parent.instructionLeases !== undefined && {
            instructionLeases: parent.instructionLeases,
          }),
        }),
        // Carry activeByslot back to parent so next turn's inputMapper can
        // feed it as priorActiveByslot (the Delta round-trip). currentSkillId is
        // the advanced cursor for the next iteration (scalar → always replaced).
        outputMapper: (sf) => ({
          activeInjections: sf.activeInjections,
          activeByslot: sf.activeByslot,
          currentSkillId: sf.nextSkillCursor,
          // The re-keyed pointer (9.18.0), back onto the parent's key — a
          // top-level ARRAY, so `arrayMerge: Replace` below sets it wholesale
          // (a bare object here would shallow-merge and APPEND the nested
          // `skipped` array across tenures; see StepPointerCarrier).
          ...(deps.hasSteps === true && { stepPointer: sf.nextStepPointer }),
          // The lease tenure sweep's survivors (9.19.0), back onto the key
          // the tool-calls stage appends to — the sweep is what makes lease
          // death PERMANENT (a cyclic graph must not resurrect a dead lease
          // on re-entry). Value-conditional: Evaluate writes it on every
          // pass the parent key exists, and never before a first grant, so
          // every other agent's mapper output is the exact bytes it was.
          ...(sf.nextInstructionLeases !== undefined && {
            instructionLeases: sf.nextInstructionLeases,
          }),
        }),
        // CRITICAL: footprintjs's default `applyOutputMapping`
        // CONCATENATES arrays from subflow output with the parent's
        // existing array values. Without `Replace`, the parent's
        // `activeInjections` from iter N gets CONCATENATED with the
        // subflow's iter N+1 fresh evaluation — producing
        // 8 → 16 → 24 → 32 cumulative injections per turn.
        arrayMerge: ArrayMergeMode.Replace,
      },
    );

  // ── Messages-slot delivery — conditional mount (7.21) ───────────
  // The one stage that lets declared content INTO the window. It has to sit
  // here: after the engine knows what is active, and before any reader of
  // `history` runs, so the projection, the cache indices and the request all
  // describe one conversation. Omitted entirely when nothing could target the
  // slot (no dead box, no write nobody makes).
  if (deps.deliverStage) {
    builder = builder.addFunction(
      'Deliver',
      deps.deliverStage as never,
      STAGE_IDS.DELIVER,
      'Deliver messages-slot injections into the window (role-checked, sequence-checked)',
    );
  }

  builder = builder
    // ── Context assembly: the 3 slots run in PARALLEL (selector fan-out) ──
    // The slots are genuinely INDEPENDENT — each reads ONLY InjectionEngine's
    // activeInjections + seed state, and each writes a DISJOINT output key
    // (systemPromptInjections / messagesInjections / toolsInjections +
    // dynamicToolSchemas). None reads another slot's output. Running them
    // sequentially was an accident of chaining; the fork makes the execution
    // tree tell the truth (and the Lens merge-tree renders the real shape).
    // The selector picks ALL 3 every iteration (unconditional fan-out).
    // failFast: true — a REQUIRED slot that throws aborts the whole turn,
    // matching the old sequential-throw behavior. WITHOUT it the default
    // Promise.allSettled would SWALLOW a failing slot and call the LLM with a
    // half-built request (the documented request-assembly footgun).
    // ── Context selector — THE one place Classic and Dynamic differ ──────
    // The 3 slots are always selector BRANCHES (so they stay drawn in the
    // chart in both modes); WHICH ones get selected per turn is the whole
    // Classic-vs-Dynamic difference:
    //   • dynamic — pick all 3 EVERY turn (activations can change per turn:
    //     a skill fires, a rule matches, a tool-return steers the next turn).
    //   • classic — pick all 3 on the FIRST turn, then ONLY messages. The
    //     static slots aren't re-selected, so their turn-1 outputs persist in
    //     scope (that IS the cache — the flat builder has no per-turn reset),
    //     and only the message list rebuilds each iteration. The Lens shows
    //     this directly: after turn 1 only the Messages branch lights up.
    .addSelectorFunction(
      'Context',
      ((scope: TypedScope<AgentState>) => {
        const firstTurn = ((scope.iteration as number | undefined) ?? 1) <= 1;
        const includeStatic = reactMode === 'dynamic' || firstTurn;
        return select(scope, [
          {
            when: () => includeStatic,
            then: SUBFLOW_IDS.SYSTEM_PROMPT,
            label: 'engineer system-prompt',
          },
          { when: () => true, then: SUBFLOW_IDS.MESSAGES, label: 'engineer messages' },
          { when: () => includeStatic, then: SUBFLOW_IDS.TOOLS, label: 'engineer tools' },
        ]);
      }) as never,
      STAGE_IDS.CONTEXT,
      reactMode === 'classic'
        ? 'Assemble request context: messages every turn; system-prompt + tools cached after turn 1'
        : 'Assemble request context: system-prompt + messages + tools (parallel)',
      { failFast: true },
    )
    // Each branch keeps its inputMapper + outputMapper + arrayMerge:Replace
    // VERBATIM from the former sequential mounts. Replace (not concat) is
    // load-bearing: the loopTo would otherwise accumulate injections/tools.
    .addSubFlowChartBranch(SUBFLOW_IDS.SYSTEM_PROMPT, deps.systemPromptSubflow, 'System Prompt', {
      inputMapper: (parent) => ({
        userMessage: parent.userMessage as string | undefined,
        iteration: parent.iteration as number | undefined,
        // `.configure()`'s per-run system prompt, as seed committed it. The
        // key is spread in ONLY when a resolver actually produced one, so an
        // unconfigured agent seeds this subflow with the same keys as ever.
        ...(parent.resolvedInstructions !== undefined && {
          instructions: parent.resolvedInstructions as string,
        }),
        activeInjections: withMemoryRecall(
          parent.activeInjections as readonly ActiveInjection[] | undefined,
          parent,
          memoryIds,
        ),
      }),
      outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartBranch(SUBFLOW_IDS.MESSAGES, deps.messagesSubflow, 'Messages', {
      inputMapper: (parent) => ({
        messages: parent.history as readonly LLMMessage[] | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: withMemoryRecall(
          parent.activeInjections as readonly ActiveInjection[] | undefined,
          parent,
          memoryIds,
        ),
      }),
      outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartBranch(SUBFLOW_IDS.TOOLS, deps.toolsSubflow, 'Tools', {
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        // The slot subflow reads these to build the per-iteration
        // ToolDispatchContext when an external `.toolProvider()` is
        // configured. Without them the provider sees activeSkillId
        // = undefined every iteration, breaking skillScopedTools etc.
        activatedInjectionIds: parent.activatedInjectionIds as readonly string[] | undefined,
        runIdentity: parent.runIdentity as
          | { tenant?: string; principal?: string; conversationId: string }
          | undefined,
        // The skill-graph cursor, for the per-iteration `read_skill` offer (8.5.0).
        // ALREADY ADVANCED: the Injection Engine mounts before this branch and its
        // outputMapper writes `currentSkillId = nextSkillCursor`, so this is the
        // cursor the gate will use when the model answers — not last turn's.
        currentSkillId: parent.currentSkillId as string | undefined,
        // The turn-start verdict (SG-C) — the Compose stage leads read_skill's
        // description with the menu while it is outstanding.
        turnRoute: parent.turnRoute as
          | import('../../lib/injection-engine/routingPolicy.js').TurnRoute
          | undefined,
        // The step pointer (9.18.0), ALREADY RE-KEYED — the same freshness
        // rule the cursor line above documents. In this flat chart the
        // engine outputMapper wrote it back onto `stepPointer`; the alias
        // arm is for the grouped chart, where the fresh value lives under
        // `nextStepPointer` beside a stale boundary input (the :336
        // nextSkillCursor pattern) — one expression, correct in both.
        ...(deps.hasSteps === true && {
          stepPointer: parent.nextStepPointer ?? parent.stepPointer,
        }),
      }),
      outputMapper: (sf) => ({
        toolsInjections: sf.toolsInjections,
        // Pass merged tool schemas (registry + injection-supplied)
        // back up so callLLM uses the right list for THIS iteration.
        dynamicToolSchemas: sf.toolSchemas,
      }),
      // Same array-concat hazard as InjectionEngine — replace, don't
      // concatenate. Without Replace the deduped tool list re-acquires
      // duplicates that providers reject.
      arrayMerge: ArrayMergeMode.Replace,
    })
    .end();

  // ── Skill-churn window (cache concern) ──────────────────────────
  // UpdateSkillHistory stays in the MAIN loop (NOT inside sf-cache): the
  // skillHistory rolling window must persist across iterations, so keeping
  // it here lets it live in parent scope without round-tripping through the
  // subflow. It feeds sf-cache's CacheGate churn check, and sits right where
  // the tool-driven skill activation flows into it.
  //
  // CONDITIONAL MOUNT: only when skills are registered. With no skills the
  // window records "no skill" every iteration and CacheGate's churn rule can
  // never fire — so the stage is omitted entirely (no dead weight, no
  // misleading box). Mirrors the read_skill auto-attach + NormalizeThinking.
  if (deps.hasSkills) {
    builder = builder.addFunction(
      'UpdateSkillHistory',
      deps.updateSkillHistoryStage as never,
      STAGE_IDS.UPDATE_SKILL_HISTORY,
      'Update skill-history rolling window for CacheGate churn detection',
    );
  }

  builder = builder
    // sf-cache: decideCacheMarkers → CacheGate → apply/skip, collapsed into
    // ONE box. Pure provider-agnostic DECISION layer — reads the turn's state,
    // outputs only the gated cacheMarkers (Replace, not concat, across the
    // loop). The attached provider's CacheStrategy turns markers into wire
    // format later. See buildCacheSubflow.ts.
    .addSubFlowChartNext(SUBFLOW_IDS.CACHE, buildCacheSubflow(), 'Cache', {
      inputMapper: (parent) => ({
        // decideCacheMarkers inputs
        activeInjections: (parent.activeInjections as readonly Injection[] | undefined) ?? [],
        iteration: (parent.iteration as number | undefined) ?? 1,
        maxIterations: (parent.maxIterations as number | undefined) ?? deps.maxIterations,
        userMessage: (parent.userMessage as string | undefined) ?? '',
        ...(parent.lastToolResult !== undefined && {
          lastToolName: (parent.lastToolResult as { toolName: string } | undefined)?.toolName,
        }),
        cumulativeInputTokens: (parent.totalInputTokens as number | undefined) ?? 0,
        systemPromptCachePolicy: deps.systemPromptCachePolicy,
        cachingDisabled: (parent.cachingDisabled as boolean | undefined) ?? false,
        // The window AS IT WILL BE SENT (7.21). A `CacheMarker{field:'messages'}`
        // names a position in the request's message array, so it has to be
        // computed against that array — post-window, post-delivery — and not
        // against a count of injections, which is what it used to be and why
        // the marker pointed at the wrong message.
        history: (parent.history as readonly LLMMessage[] | undefined) ?? [],
        // CacheGate inputs (read-only: skillHistory is updated in the main
        // loop above, so it is NOT mapped back out)
        recentHitRate: parent.recentHitRate as number | undefined,
        skillHistory: (parent.skillHistory as readonly (string | undefined)[] | undefined) ?? [],
      }),
      outputMapper: (sf) => ({ cacheMarkers: sf.cacheMarkers }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    // CallLLM emits the per-iteration `iteration_start` marker itself (no
    // dedicated IterationStart stage — emitting is passive observability).
    .addFunction('CallLLM', deps.callLLM as never, STAGE_IDS.CALL_LLM, 'LLM invocation');
  // v2.14 — conditional NormalizeThinking sub-subflow. Mounted ONLY
  // when a ThinkingHandler resolved (auto-wired by provider.name OR
  // explicitly set via .thinkingHandler()). When undefined, the stage
  // is NOT added — zero overhead for non-thinking agents
  // (build-time conditional mount; matches the panel's design rule).
  if (deps.thinkingSubflow) {
    builder = builder.addSubFlowChartNext(
      SUBFLOW_IDS.THINKING,
      deps.thinkingSubflow,
      'NormalizeThinking',
      {
        inputMapper: (parent) => ({
          rawThinking: parent.rawThinking as unknown,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sf) => ({
          thinkingBlocks: sf.thinkingBlocks,
        }),
        // Replace not concatenate — fresh thinking per iteration
        arrayMerge: ArrayMergeMode.Replace,
      },
    );
  }
  let decider = builder
    .addDeciderFunction('Route', deps.routeDecider as never, SUBFLOW_IDS.ROUTE, 'ReAct routing')
    .addPausableFunctionBranch(
      'tool-calls',
      'ToolCalls',
      deps.toolCallsHandler as never,
      'Tool execution (pausable via pauseHere)',
      // Branch-sourced loop: tool-calls loops back to the InjectionEngine so
      // EVERY iteration re-evaluates triggers against the freshest context (the
      // just-appended tool result). Sourced from the BRANCH (not the decider) so
      // the chart reads honestly — `ToolCalls → InjectionEngine` loops, `Final`
      // terminates. Survives pause/resume (human-in-the-loop tool approval): the
      // engine resolves the subflow loop target on resume — footprintjs
      // FlowChartExecutor.resume + test/lib/pause/resume-branch-loop-subflow.
      { loopTo: loopTarget },
    );

  // ── The schema re-ask — conditional mount (7.26) ────────────────
  // The second looping branch, and it loops to the SAME target the tool branch
  // does. That is the whole design: a re-ask re-enters the ordinary loop, so
  // the corrective turn is engineered, cached, sent and recorded exactly like
  // any other — its own iteration bracket, its own cost tick. Omitted entirely
  // for an agent that did not ask for retries.
  if (deps.outputRetryStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.OUTPUT_RETRY,
      'SchemaRetry',
      deps.outputRetryStage as never,
      'Answer failed the output schema — put the correction back and ask again',
      { loopTo: loopTarget },
    );
  }

  // ── The unfinished-steps nudge — conditional mount (9.18.0) ─────────
  // The SchemaRetry mechanism verbatim, one branch over: same loop target,
  // same "a re-ask is one more ordinary turn" reasoning, same conditional
  // mount (no stepped skill → no branch, no stage, no event).
  if (deps.stepNudgeStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.STEP_NUDGE,
      'StepNudge',
      deps.stepNudgeStage as never,
      'Answer left declared steps unrun — one teaching nudge goes back (once per turn)',
      { loopTo: loopTarget },
    );
  }

  // ── The evidence recheck — conditional mount (9.35.0) ───────────────
  // The SchemaRetry mechanism a third time: same loop target, same "a re-ask
  // is one more ordinary turn" reasoning, same conditional mount. Absent for
  // `posture: 'assist'` (which records and never loops) and for every agent
  // that did not ask for the check at all.
  if (deps.evidenceRecheckStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.EVIDENCE_RECHECK,
      'EvidenceRecheck',
      deps.evidenceRecheckStage as never,
      'Answer stated values no tool result carried — naming them back for one revision',
      { loopTo: loopTarget },
    );
  }

  builder = decider
    .addSubFlowChartBranch(SUBFLOW_IDS.FINAL, finalBranchChart, 'Final', {
      // Pass through the read-only state the sub-chart needs;
      // OMIT keys the sub-chart writes (finalContent, newMessages)
      // — passing those via inputMapper would freeze them as args.
      inputMapper: (parent) => {
        const { finalContent: _f, newMessages: _nm, ...rest } = parent;
        void _f;
        void _nm;
        return rest;
      },
      outputMapper: (sf) => ({
        finalContent: sf.finalContent as string,
      }),
      // With the branch-sourced loop, `final` is a terminal LEAF — it ends the
      // run on its own (no decider `next` to suppress). propagateBreak is kept
      // so BreakFinal's $break() still surfaces a terminal onBreak signal to the
      // parent (observability) and stays correct if a decider-level `next` is
      // ever reintroduced.
      propagateBreak: true,
    })
    .setDefault(SUBFLOW_IDS.FINAL)
    .end();
  // The ReAct loop is now sourced from the `tool-calls` branch (the
  // `{ loopTo }` above), not the decider — so `Final` is a plain terminal leaf
  // and the chart draws `ToolCalls → InjectionEngine` for the loop edge.

  return builder.build();
}
