[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EnableNamespace

# Interface: EnableNamespace

Defined in: [src/core/runner.ts:42](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L42)

High-level feature-enable methods. Each attaches a pre-built observability
recorder and returns an Unsubscribe function. Additional methods land in
Phase 5 (lens, tracing, cost, guardrails, ...).

## Methods

### cost()

> **cost**(`opts?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/core/runner.ts:64](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L64)

v2.8+ — grouped strategy enabler for cost. Subscribes the strategy
to `cost.tick` events; defaults to `inMemorySinkCost()` for
read-back / test inspection.

#### Parameters

##### opts?

`CostEnableOptions`

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### flowchart()

> **flowchart**(`opts?`): [`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

Defined in: [src/core/runner.ts:51](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L51)

Live composition graph — subflow / fork-branch / decision-branch
nodes accumulate as execution unfolds. Hook into any graph renderer
(React Flow, Cytoscape, D3) without touching footprintjs internals.

Returns a handle with `getSnapshot()` so the UI can query the graph
at any time (not just via onUpdate).

#### Parameters

##### opts?

[`FlowchartOptions`](/agentfootprint/api/generated/interfaces/FlowchartOptions.md)

#### Returns

[`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

***

### liveStatus()

> **liveStatus**(`opts`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/core/runner.ts:71](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L71)

v2.8+ — grouped strategy enabler for chat-bubble live status.
Maintains the thinking-state machine; calls strategy.renderStatus
each time the rendered line changes (deduped — not on every token).
Strategy is required (consumer must wire UI).

#### Parameters

##### opts

`LiveStatusEnableOptions`

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### observability()

> **observability**(`opts?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/core/runner.ts:58](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L58)

v2.8+ — grouped strategy enabler for observability. Pipes every
typed event into a vendor strategy (Datadog, OTel, AgentCore,
CloudWatch, …) or the default `consoleObservability()`. See
`agentfootprint/strategies` + `docs/inspiration/strategy-everywhere.md`.

#### Parameters

##### opts?

`ObservabilityEnableOptions`

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
