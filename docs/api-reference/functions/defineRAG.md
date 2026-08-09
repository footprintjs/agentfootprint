[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineRAG

# Function: defineRAG()

> **defineRAG**(`opts`): `MemoryDefinition`

Defined in: [src/lib/rag/defineRAG.ts:318](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/lib/rag/defineRAG.ts#L318)

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
        store that can retrieve.

## Throws

when `embedder` is missing and the store does not rank text
        server-side — somebody has to turn the question into a vector.

## Throws

when `embedder`/`embedderId` is passed to a store that DOES rank
        text server-side — the option would be read by nothing.

## Throws

when `retrieval` is combined with `topK` or `threshold`.
