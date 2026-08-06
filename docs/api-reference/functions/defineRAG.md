[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineRAG

# Function: defineRAG()

> **defineRAG**(`opts`): `MemoryDefinition`

Defined in: [src/lib/rag/defineRAG.ts:145](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/lib/rag/defineRAG.ts#L145)

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
