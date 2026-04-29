# `src/recorders/core/` — semantic grouping layer

## What lives here

The library-owned recorders that translate raw footprintjs events into grouped typed domain events. These are ALWAYS attached internally by every runner; consumers can't disable them.

```
recorders/core/
├── types.ts             InjectionRecord, SlotComposition, EvictionRecord, BudgetPressureRecord.
├── typedEmit.ts         Typed facade over scope.$emit(name, payload).
├── EmitBridge.ts        Shared prefix-based emit→dispatcher bridge.
├── StreamRecorder.ts    Factory: forwards agentfootprint.stream.* emits.
├── AgentRecorder.ts     Factory: forwards agentfootprint.agent.* emits.
└── ContextRecorder.ts   Observes slot subflows + scope writes → emits context.*.
```

## The grouping responsibility

Raw footprintjs events are structural (onSubflowEntry, onSubflowExit, onWrite, onNext, onFork, onDecision). They describe execution mechanics, not domain semantics. Core recorders **group** these raw signals into typed domain events consumers understand:

```
Raw footprintjs events                              Grouped events
────────────────────────────────                   ──────────────────────
onSubflowEntry(sf-messages)                 ──►
onWrite(key=messagesInjections, value=...)  ──►    agentfootprint.context.injected × N
onWrite(key=slotCompositions, value=...)    ──►    agentfootprint.context.slot_composed
onSubflowExit(sf-messages)                  ──►

scope.$emit('agentfootprint.stream.llm_start', ...) ──► agentfootprint.stream.llm_start
scope.$emit('agentfootprint.agent.turn_end', ...)   ──► agentfootprint.agent.turn_end
```

## Architectural decisions

### Decision 1: Core recorders are NOT optional

Every runner attaches ContextRecorder + StreamRecorder + AgentRecorder in its internal `run()` setup. Consumers can't turn them off. They ARE the grouping layer — without them, no typed events would flow to `.on()` subscribers.

This contrasts with Tier-3 observability recorders (`recorders/observability/`), which are opt-in via `.enable.*`.

### Decision 2: Two patterns for two sources of truth

| Source of raw signal | Pattern used | Files |
|---|---|---|
| footprintjs scope writes + subflow boundaries | Observation (read + diff) | `ContextRecorder.ts` |
| footprintjs emit channel (scope.$emit) | Bridge (forward + enrich) | `EmitBridge.ts` + `StreamRecorder.ts` + `AgentRecorder.ts` |

**Context events** come from scope-write observation because injection records are WRITTEN to scope by slot subflows. The recorder OBSERVES the writes.

**Stream + agent events** come from direct emit at the stage level (via `typedEmit()`). The bridge observes the emit channel and re-dispatches to the dispatcher with enriched meta.

Both paths end at the same dispatcher — consumers see one unified event stream.

### Decision 3: Typed emit instead of untyped `scope.$emit(...)`

Stage code never calls `scope.$emit('agentfootprint.stream.llm_start', ...)` with a raw string. It calls `typedEmit(scope, 'agentfootprint.stream.llm_start', { iteration, provider, ... })`. The helper is a thin facade but rejects typos + payload shape drift at compile time.

### Decision 4: EmitBridge over one shared factory

StreamRecorder and AgentRecorder are nearly identical — they forward emits matching a prefix to the dispatcher. Factoring the shared logic into `EmitBridge` + thin factories (`streamRecorder`, `agentRecorder`) keeps this DRY. Future domains (e.g. a `CompositionEmitRecorder` when compositions ship in Phase 4) add one line.

### Decision 5: ContextRecorder diffs injections by `contentHash`

When a slot subflow writes `messagesInjections` multiple times (possible during composition), the recorder emits `context.injected` **once per unique contentHash**. Consumer sees each piece injected exactly once, regardless of how many times the slot rewrote the array.

The seen-hash set resets on slot exit — so a new iteration can re-inject the same content if it chooses.

### Decision 6: Enrich with `EventMeta` at emit time

Raw footprintjs events carry structural metadata (runtimeStageId, subflowPath, stageName). The bridge enriches each outbound event with `EventMeta` (wallClockMs, runOffsetMs, compositionPath, runId, optional traceId + correlationId). Consumers get consistent metadata on every event; subscribers don't compute offsets or parse paths themselves.

`buildEventMeta()` is in `../bridge/` to keep recorders focused on translation and meta construction in one place.

## Fast-path invariant

Every recorder checks `dispatcher.hasListenersFor(type)` before constructing the typed event. When nothing subscribes, zero allocations happen. This is critical for production runs where observability is optional.

## When to add a new core recorder

Rarely. New library-owned domain events (e.g. Phase 4's `composition.*` events) would land in a new `CompositionRecorder`. The criteria:

1. The domain has its own raw signal source (subflow boundaries, specific scope writes, or typed emits).
2. The recorder must attach internally to every runner that emits its events.
3. The shape is stable — no consumer configuration changes its output.

Everything else is a `recorders/observability/` candidate (opt-in Tier 3).
