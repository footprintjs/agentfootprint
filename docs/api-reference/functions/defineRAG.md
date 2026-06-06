[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineRAG

# Function: defineRAG()

> **defineRAG**(`opts`): [`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

Defined in: [src/lib/rag/defineRAG.ts:151](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/rag/defineRAG.ts#L151)

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
