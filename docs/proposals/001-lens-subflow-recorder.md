# Proposal: `LensSubflowRecorder` — typed payload tree for lens, composed from existing footprintjs primitives

**Status:** v1 · proposed
**Affects:** `agentfootprint/src/recorders/observability/` (new file), `agentfootprint-lens` (consumer migration)
**Estimated change:** ~150 LOC added in agentfootprint · deletes `lensGroupTranslator` + per-kind translators (~400 LOC) + `runner.getUIGroupWith` reliance in lens · zero footprintjs changes

---

## What this proposal solves

`agentfootprint-lens` currently builds its render graph by **querying** the runner's compiled UI metadata:

```ts
const output = runner.getUIGroupWith(lensGroupTranslator);  // returns LensGroupOutput
```

This breaks the library's own "passive emitter, consumers extract via recorders" principle. It also:
- Couples lens to an internal agentfootprint API (`getUIGroupWith` exists for this single consumer)
- Misses live updates (lazy subflows resolved at runtime, in-progress retries, streaming chunks)
- Duplicates work footprintjs already does (subflow tree shape, boundary payloads)

The proposal replaces the query with an event-driven recorder that **composes existing footprintjs primitives** into the typed payload tree lens wants.

## The footprintjs primitives we compose

footprintjs already exposes everything needed:

| Primitive | What it gives us | Where |
|---|---|---|
| `TopologyRecorder` | Live composition tree (subflow nodes, fork/decision branches, edges) keyed by `runtimeStageId` | `footprintjs/trace` |
| `InOutRecorder` | Entry/exit pairs at every subflow boundary with input/output payloads (root + every subflow) | `footprintjs/trace` |
| `EmitRecorder` | Consumer-defined events from `scope.$emit(...)` — carries agentfootprint's `agent.iteration_*`, `llm.call_*`, `stream.llm_*` etc. | `footprintjs` |

**Together these give:**
- Tree shape (Topology)
- Input/output at every boundary (InOut)
- Domain telemetry (Emit)

The missing piece is the **typed JOIN** that ties these three signals to an agent-domain payload shape.

## Design

A new recorder in agentfootprint:

```ts
// agentfootprint/src/recorders/observability/LensSubflowRecorder.ts

export interface SubflowGroup<P> {
  readonly id: string;                               // matches subflowId
  readonly subflowPath: readonly string[];           // ['__root__', 'sf-agent']
  readonly label: string;                            // from subflowName
  readonly description?: string;                     // taxonomy marker e.g. 'Agent: ReAct loop'
  readonly children: readonly SubflowGroup<P>[];     // nested subflows
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly status: 'running' | 'ok' | 'error' | 'paused';
  readonly payload: P;                               // kind-specific
  readonly runtimeStageId: string;                   // correlation key across channels
}

// Discriminated payload union — one per agentfootprint composition kind
export type LensPayload =
  | AgentPayload
  | LLMCallPayload
  | SequencePayload
  | ParallelPayload
  | LoopPayload
  | ConditionalPayload;

export interface AgentPayload {
  readonly kind: 'Agent';
  readonly slots: { system: string; messages: Message[]; tools: ToolDef[] };
  readonly iterations: number;
  readonly toolCalls: number;
  readonly tokenUsage: { input: number; output: number };
  readonly finalAnswer?: string;
  readonly retries: ReadonlyArray<{ iteration: number; reason: string }>;
}

export interface LLMCallPayload {
  readonly kind: 'LLMCall';
  readonly model: string;
  readonly slots: { system: string; messages: Message[]; tools: ToolDef[] };
  readonly tokenUsage: { input: number; output: number };
  readonly streamChunks?: number;
  readonly retries: ReadonlyArray<{ attempt: number; reason: string }>;
}

export interface SequencePayload  { readonly kind: 'Sequence';  /* ... */ }
export interface ParallelPayload  { readonly kind: 'Parallel';  readonly mergeStrategy: string; }
export interface LoopPayload      { readonly kind: 'Loop';      readonly iterations: number; readonly maxIterations?: number; }
export interface ConditionalPayload { readonly kind: 'Conditional'; readonly chosen: string; }

export class LensSubflowRecorder implements CombinedRecorder {
  readonly id: string;
  private topology: TopologyRecorder;
  private inOut: InOutRecorder;
  // composes footprintjs primitives internally

  constructor() {
    this.topology = topologyRecorder();
    this.inOut = inOutRecorder();
  }

  // Routes events to internal recorders + own bookkeeping
  onSubflowEntry(e) { this.topology.onSubflowEntry(e); this.inOut.onSubflowEntry(e); this.openGroup(e); }
  onSubflowExit(e)  { this.topology.onSubflowExit(e);  this.inOut.onSubflowExit(e);  this.sealGroup(e); }
  onFork(e)         { this.topology.onFork(e); }
  onDecision(e)     { this.topology.onDecision(e); }
  onRunStart(e)     { this.topology.onRunStart(e); this.inOut.onRunStart(e); }
  onRunEnd(e)       { this.topology.onRunEnd(e); this.inOut.onRunEnd(e); }

  // Updates payload from agentfootprint emit events
  onEmit(e) {
    if (e.name.startsWith('agentfootprint.')) {
      this.updateOpenGroupPayload(e);
    }
  }

  /** The tree consumers (Lens) render. Updates live as the run progresses. */
  getGroups(): readonly SubflowGroup<LensPayload>[] { ... }
}

export function createLensSubflowRecorder(): LensSubflowRecorder {
  return new LensSubflowRecorder();
}
```

## Wiring

```ts
// in lens
const recorder = createLensSubflowRecorder();
executor.attachCombinedRecorder(recorder);
await executor.run({ input });

const groups = recorder.getGroups();  // tree of SubflowGroup<LensPayload>
// Lens layout + render directly from groups; drill = render-subtree
```

## What replaces what

| Replaced | By |
|---|---|
| `runner.getUIGroupWith(lensGroupTranslator)` | `recorder.getGroups()` |
| `lensGroupTranslator` + 6 per-kind translators (~400 LOC) | Payload updaters inside `LensSubflowRecorder` (~80 LOC) |
| `useLensRenderGraph` calling `runner.getUIGroupWith` | `useLensRenderGraph` subscribing to recorder + reading `getGroups()` |
| `LensGroupOutput`, `LensNode`, `LensEdge` static types | `SubflowGroup<LensPayload>` tree |

`getUIGroupWith` and `lensGroupTranslator` can stay in agentfootprint for backward-compat one release, then deleted in the following major.

## Why this is the right design

1. **No new footprintjs primitive.** TopologyRecorder + InOutRecorder + EmitRecorder are already there. We compose, not extend.
2. **Event-driven**: matches the library-wide pattern. Live updates work naturally (lazy subflows, in-progress payloads, retries).
3. **Subflow ≡ Group**: every "group" lens wants to render IS a footprintjs subflow. No new vocabulary.
4. **Single correlation key**: `runtimeStageId` joins all three channels. Same key Topology uses for nodes, InOut uses for boundaries, Emit uses for events.
5. **Drill-in is automatic**: groups nest as a tree → drill = render subtree. Same mechanism as TracedFlow's `useSubflowDrill`.
6. **Layer separation stays clean**:
   - footprintjs owns: subflow concept, boundary detection, payload transport
   - agentfootprint owns: kind-specific payload shapes + emit event semantics
   - lens owns: rendering + layout

## Drill-in (user clicks a group → sees its flowchart)

Each group's `children` field gives the subtree to render when drilled in. The drill state is just "which subflowPath am I rendering as root." This is the same mechanism explainable-ui's `<TracedFlow>` uses with `useSubflowDrill`.

```ts
const [drillPath, setDrillPath] = useState<string[]>([]);
const renderRoot = drillPath.length === 0
  ? recorder.getGroups()
  : findByPath(recorder.getGroups(), drillPath);
```

## Pause/resume semantics

InOutRecorder documents: "When a stage pauses inside a subflow, the engine re-throws without firing onSubflowExit. The subflow has an entry with no matching exit." This propagates naturally — `LensSubflowRecorder` exposes such groups with `status: 'paused'` and `endedAt: undefined`.

## Parallel branch semantics

A `<Parallel>` composition mounts N subflows as children. Each child is a separate group; their `parentId` points to the parent Parallel group. The Parallel group's `payload.kind = 'Parallel'` carries the merge strategy. Layout (in lens) decides whether to render parallel children side-by-side or stacked.

## Migration impact

| Component | Action |
|---|---|
| `agentfootprint/src/core/translate/lensGroupTranslator.ts` | Deprecate, delete next major |
| `agentfootprint/src/core/translate/perKind/*` | Deprecate, delete next major |
| `agentfootprint/Runner.getUIGroupWith` | Mark deprecated; keep for back-compat one release |
| `agentfootprint-lens/src/v2/react/hooks/useLensRenderGraph.ts` | Rewrite to consume recorder |
| `agentfootprint-lens/src/v2/core/render/toReactFlow.ts` | Reduces to walking the group tree |
| `agentfootprint-lens/src/v2/core/render/layoutLensGraph.ts` | Stays — agent layout is lens's concern |
| `agentfootprint-lens` `BoundaryRecorder` | Becomes thin or deletes (LensSubflowRecorder covers boundary events) |

## Open questions

1. **Where does `LensSubflowRecorder` live — agentfootprint or lens?**
   - Agentfootprint: closer to the data source, can use internal types, sees `EmitEvent` names directly. Risk: agentfootprint learns about lens-specific payload shapes.
   - Lens: closer to consumer; agentfootprint stays domain-pure. Risk: lens needs to know agentfootprint's emit event vocabulary deeply.
   - Recommend: **agentfootprint** — the payload shapes ARE domain concepts (Agent, LLMCall, etc.), and agentfootprint owns those.

2. **Should this REPLACE BoundaryRecorder + RunStepRecorder, or coexist?**
   - BoundaryRecorder produces a flat DomainEvent stream — still useful for non-render consumers (telemetry export).
   - RunStepRecorder produces a slider-ready step graph — could be derived from the SubflowGroup tree.
   - Recommend: **coexist for one release**, evaluate after lens adoption whether to consolidate.

3. **Live updates / pub-sub interface?**
   - `recorder.subscribe(listener)` + `recorder.version()` (like explainable-ui's recorder handles) for React `useSyncExternalStore`?
   - Recommend: **yes** — lens UIs need live updates as the run progresses.

4. **Group `id` vs `runtimeStageId`?**
   - InOutRecorder keys boundaries by `runtimeStageId`. TopologyRecorder uses its own node ids.
   - Recommend: use `runtimeStageId` as the group id — it's the universal correlation key.

5. **Emit-event vocabulary stability**
   - The payload updater logic depends on knowing emit event names (`agentfootprint.agent.iteration_end`, etc.). If those names change, payloads silently drift.
   - Recommend: **export the event-name constants** from agentfootprint so the recorder + emitters share the source of truth.

## What this DOESN'T do (scoped out)

- ❌ Does NOT add a new recorder primitive to footprintjs. Pure composition of existing primitives.
- ❌ Does NOT replace lens's dagre layout or compound-parent rendering. Those stay.
- ❌ Does NOT touch explainable-ui's `<TraceFlow>` — lens's chart pipeline continues to use it via the prior consolidation.
- ❌ Does NOT support cross-run aggregation. Each run gets a fresh recorder instance.

## Required tests before merge

1. **Unit**: `LensSubflowRecorder` produces a single root group from a chart with no subflows.
2. **Unit**: nested subflows produce nested groups; `subflowPath` matches engine convention.
3. **Unit**: emit events update the open group's payload (e.g., `agent.iteration_end` increments `iterations`).
4. **Functional**: a real Agent run produces a group tree with correct slots / iterations / token counts.
5. **Integration**: parallel composition (`<Parallel>`) produces N sibling groups with shared parent.
6. **Integration**: pause mid-subflow → group has `status: 'paused'`, `endedAt: undefined`; resume completes it.
7. **Property**: every group's `runtimeStageId` matches an entry in the executor's `commitLog` for that stage.
8. **Performance**: 100-iteration agent run, recorder overhead < 5ms total per iteration.
