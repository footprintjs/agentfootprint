[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineRAG

# Function: defineRAG()

> **defineRAG**(`opts`): [`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

Defined in: [agentfootprint/src/lib/rag/defineRAG.ts:149](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/rag/defineRAG.ts#L149)

Build a RAG context-engineering definition. The returned
`MemoryDefinition` is registered on the Agent via `.rag(definition)`
(or, equivalently, `.memory(definition)` — same plumbing).

## Parameters

### opts

[`DefineRAGOptions`](/agentfootprint/api/generated/interfaces/DefineRAGOptions.md)

## Returns

[`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

## Throws

when `store` does not implement `search()`. RAG requires a
        vector-capable adapter.
