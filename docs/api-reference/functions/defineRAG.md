[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineRAG

# Function: defineRAG()

> **defineRAG**(`opts`): `MemoryDefinition`

Defined in: [src/lib/rag/defineRAG.ts:248](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/lib/rag/defineRAG.ts#L248)

Build a RAG context-engineering definition. The returned
`MemoryDefinition` is registered on the Agent via `.rag(definition)`
(or, equivalently, `.memory(definition)` — same plumbing).

## Parameters

### opts

[`DefineRAGOptions`](/agentfootprint/api/generated/interfaces/DefineRAGOptions.md)

## Returns

`MemoryDefinition`

## Throws

when `store` does not implement `search()`. RAG requires a
        vector-capable adapter.

## Throws

when `retrieval` is combined with `topK` or `threshold`.
