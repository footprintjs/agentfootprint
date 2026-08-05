[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EnableNamespace

# Interface: EnableNamespace

Defined in: [src/core/runner.ts:52](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L52)

High-level feature-enable methods. Each attaches a pre-built observability
recorder and returns an Unsubscribe function. Additional methods land in
Phase 5 (lens, tracing, cost, guardrails, ...).

## Methods

### cost()

> **cost**(`opts?`): `Unsubscribe`

Defined in: [src/core/runner.ts:92](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L92)

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

> **flowchart**(`opts?`): [`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

Defined in: [src/core/runner.ts:63](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L63)

Live composition graph — subflow / fork-branch / decision-branch
nodes accumulate as execution unfolds. Hook into any graph renderer
(React Flow, Cytoscape, D3) without touching footprintjs internals.

Returns a handle with `getSnapshot()` so the UI can query the graph
at any time (not just via onUpdate). Wires the boundary recorder's
three connections, commit tracking included, so the recording it
leaves behind can be replayed with its step strip intact.

#### Parameters

##### opts?

[`FlowchartOptions`](/agentfootprint/api/generated/interfaces/FlowchartOptions.md)

#### Returns

[`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

***

### liveStatus()

> **liveStatus**(`opts`): `Unsubscribe`

Defined in: [src/core/runner.ts:99](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L99)

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

Defined in: [src/core/runner.ts:79](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L79)

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

> **observability**(`opts?`): `Unsubscribe`

Defined in: [src/core/runner.ts:86](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/runner.ts#L86)

v2.8+ — grouped strategy enabler for observability. Pipes every
typed event into a vendor strategy (Datadog, OTel, AgentCore,
CloudWatch, …) or the default `consoleObservability()`. See
`agentfootprint/strategies` + `docs/inspiration/strategy-everywhere.md`.

#### Parameters

##### opts?

`ObservabilityEnableOptions`

#### Returns

`Unsubscribe`
