---
title: EnableNamespace
---

# Interface: EnableNamespace

Defined in: [src/core/runner.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L54)

High-level feature-enable methods. Each attaches a pre-built observability
recorder and returns an Unsubscribe function. Additional methods land in
Phase 5 (lens, tracing, cost, guardrails, ...).

## Methods

### cost()

> **cost**(`opts?`): [`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)

Defined in: [src/core/runner.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L94)

v2.8+ — grouped strategy enabler for cost. Subscribes the strategy
to `cost.tick` events; defaults to `inMemorySinkCost()` for
read-back / test inspection.

#### Parameters

##### opts?

`CostEnableOptions`

#### Returns

[`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)

***

### flowchart()

> **flowchart**(`opts?`): [`FlowchartHandle`](/docs/api/interfaces/FlowchartHandle)

Defined in: [src/core/runner.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L65)

Live composition graph — subflow / fork-branch / decision-branch
nodes accumulate as execution unfolds. Hook into any graph renderer
(React Flow, Cytoscape, D3) without touching footprintjs internals.

Returns a handle with `getSnapshot()` so the UI can query the graph
at any time (not just via onUpdate). Wires the boundary recorder's
three connections, commit tracking included, so the recording it
leaves behind can be replayed with its step strip intact.

#### Parameters

##### opts?

[`FlowchartOptions`](/docs/api/interfaces/FlowchartOptions)

#### Returns

[`FlowchartHandle`](/docs/api/interfaces/FlowchartHandle)

***

### liveStatus()

> **liveStatus**(`opts`): [`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)

Defined in: [src/core/runner.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L101)

v2.8+ — grouped strategy enabler for chat-bubble live status.
Maintains the thinking-state machine; calls strategy.renderStatus
each time the rendered line changes (deduped — not on every token).
Strategy is required (consumer must wire UI).

#### Parameters

##### opts

`LiveStatusEnableOptions`

#### Returns

[`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)

***

### localObservability()

> **localObservability**(`opts?`): `LocalObservabilityHandle`

Defined in: [src/core/runner.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L81)

Tier-3 / Debug — RETAIN a live run model: watch it via `onLive` (a
fresh `StepGraph` per event, for your own renderer) AND freeze it for
OFFLINE replay via `handle.getTrace()` / `onRecorded`.

This handle is NOT a Lens recorder — `<Lens recorder={…} />` wants a
`LensRecorder`, a different object with a different surface. To put a
run in front of Lens, record it with `recordRun()` and hand the
recording to lens's `observeRecording()`.

Contrast `observability({ strategy })` below (Tier-4 / Monitor), which
ships each event to a vendor and forgets. `localObservability` keeps the
model so you can look at it — locally, with full content. The serialized
`Trace` is redactable at the serialize boundary (`redact` / `getTrace`).

#### Parameters

##### opts?

`LocalObservabilityOptions`

#### Returns

`LocalObservabilityHandle`

***

### observability()

> **observability**(`opts?`): [`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)

Defined in: [src/core/runner.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L88)

v2.8+ — grouped strategy enabler for observability. Pipes every
typed event into a vendor strategy (Datadog, OTel, AgentCore,
CloudWatch, …) or the default `consoleObservability()`. See
`agentfootprint/observe` + `docs/inspiration/strategy-everywhere.md`.

#### Parameters

##### opts?

`ObservabilityEnableOptions`

#### Returns

[`StrategyHandle`](/docs/api/type-aliases/StrategyHandle)
