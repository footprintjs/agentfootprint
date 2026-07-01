---
title: EnableNamespace
---

# Interface: EnableNamespace

Defined in: [src/core/runner.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L46)

High-level feature-enable methods. Each attaches a pre-built observability
recorder and returns an Unsubscribe function. Additional methods land in
Phase 5 (lens, tracing, cost, guardrails, ...).

## Methods

### cost()

> **cost**(`opts?`): `Unsubscribe`

Defined in: [src/core/runner.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L79)

v2.8+ — grouped strategy enabler for cost. Subscribes the strategy
to `cost.tick` events; defaults to `inMemorySinkCost()` for
read-back / test inspection.

#### Parameters

##### opts?

`CostEnableOptions`

#### Returns

`Unsubscribe`

***

### flowchart()

> **flowchart**(`opts?`): [`FlowchartHandle`](/docs/api/interfaces/FlowchartHandle)

Defined in: [src/core/runner.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L55)

Live composition graph — subflow / fork-branch / decision-branch
nodes accumulate as execution unfolds. Hook into any graph renderer
(React Flow, Cytoscape, D3) without touching footprintjs internals.

Returns a handle with `getSnapshot()` so the UI can query the graph
at any time (not just via onUpdate).

#### Parameters

##### opts?

[`FlowchartOptions`](/docs/api/interfaces/FlowchartOptions)

#### Returns

[`FlowchartHandle`](/docs/api/interfaces/FlowchartHandle)

***

### liveStatus()

> **liveStatus**(`opts`): `Unsubscribe`

Defined in: [src/core/runner.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L86)

v2.8+ — grouped strategy enabler for chat-bubble live status.
Maintains the thinking-state machine; calls strategy.renderStatus
each time the rendered line changes (deduped — not on every token).
Strategy is required (consumer must wire UI).

#### Parameters

##### opts

`LiveStatusEnableOptions`

#### Returns

`Unsubscribe`

***

### localObservability()

> **localObservability**(`opts?`): `LocalObservabilityHandle`

Defined in: [src/core/runner.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L66)

Tier-3 / Debug — RETAIN a live run model: render it live via
`<Lens recorder={handle} />` (the handle's `onUpdate` drives the UI) AND
snapshot it for OFFLINE replay via `handle.getTrace()` / `onComplete`.

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

> **observability**(`opts?`): `Unsubscribe`

Defined in: [src/core/runner.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L73)

v2.8+ — grouped strategy enabler for observability. Pipes every
typed event into a vendor strategy (Datadog, OTel, AgentCore,
CloudWatch, …) or the default `consoleObservability()`. See
`agentfootprint/strategies` + `docs/inspiration/strategy-everywhere.md`.

#### Parameters

##### opts?

`ObservabilityEnableOptions`

#### Returns

`Unsubscribe`
