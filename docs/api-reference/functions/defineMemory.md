[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineMemory

# Function: defineMemory()

> **defineMemory**(`options`): [`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

Defined in: [agentfootprint/src/memory/define.ts:87](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.ts#L87)

Build a `MemoryDefinition` from a high-level `{ type, strategy, store }`
config. Internally dispatches to one of the existing pipeline factories
(defaultPipeline / semanticPipeline / factPipeline / narrativePipeline /
autoPipeline / ephemeralPipeline) and wires the compiled flowcharts
into the opaque definition that `Agent.memory()` consumes.

Supported combinations:

| type      | strategy.kind | underlying pipeline      |
| --------- | ------------- | ------------------------ |
| EPISODIC  | WINDOW        | defaultPipeline          |
| EPISODIC  | BUDGET        | defaultPipeline          |
| EPISODIC  | SUMMARIZE     | defaultPipeline + summarize stage |
| SEMANTIC  | TOP_K         | semanticPipeline         |
| SEMANTIC  | EXTRACT       | factPipeline             |
| SEMANTIC  | WINDOW        | factPipeline (recency-load) |
| NARRATIVE | EXTRACT       | narrativePipeline        |
| NARRATIVE | WINDOW        | narrativePipeline (recency-load) |
| (any)     | HYBRID        | autoPipeline (when sub-strategies map cleanly) |

Unsupported combinations throw with a remediation hint pointing to a
working alternative or to the raw `mountMemoryRead`/`mountMemoryWrite`
helpers for power users.

## Parameters

### options

[`DefineMemoryOptions`](/agentfootprint/api/generated/type-aliases/DefineMemoryOptions.md)

## Returns

[`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)
