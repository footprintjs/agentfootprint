[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EnableNamespace

# Interface: EnableNamespace

Defined in: [agentfootprint/src/core/runner.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/runner.ts#L43)

High-level feature-enable methods. Each attaches a pre-built observability
recorder and returns an Unsubscribe function. Additional methods land in
Phase 5 (lens, tracing, cost, guardrails, ...).

## Methods

### flowchart()

> **flowchart**(`opts?`): [`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

Defined in: [agentfootprint/src/core/runner.ts:57](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/runner.ts#L57)

Live composition graph — subflow / fork-branch / decision-branch
nodes accumulate as execution unfolds. Hook into any graph renderer
(React Flow, Cytoscape, D3) without touching footprintjs internals.

Unlike thinking/logging which return a plain Unsubscribe, this
returns a handle with `getSnapshot()` so the UI can query the graph
at any time (not just via onUpdate).

#### Parameters

##### opts?

[`FlowchartOptions`](/agentfootprint/api/generated/interfaces/FlowchartOptions.md)

#### Returns

[`FlowchartHandle`](/agentfootprint/api/generated/interfaces/FlowchartHandle.md)

***

### logging()

> **logging**(`opts?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/runner.ts:47](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/runner.ts#L47)

Firehose-style structured logging of every event.

#### Parameters

##### opts?

[`LoggingOptions`](/agentfootprint/api/generated/interfaces/LoggingOptions.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### thinking()

> **thinking**(`opts`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/runner.ts:45](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/runner.ts#L45)

Claude-Code-style live status line.

#### Parameters

##### opts

[`ThinkingOptions`](/agentfootprint/api/generated/interfaces/ThinkingOptions.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
