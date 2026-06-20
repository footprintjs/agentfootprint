---
title: defineRAG
---

# Function: defineRAG()

> **defineRAG**(`opts`): [`MemoryDefinition`](/docs/api/interfaces/MemoryDefinition)

Defined in: [src/lib/rag/defineRAG.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/rag/defineRAG.ts#L151)

Build a RAG context-engineering definition. The returned
`MemoryDefinition` is registered on the Agent via `.rag(definition)`
(or, equivalently, `.memory(definition)` — same plumbing).

## Parameters

### opts

[`DefineRAGOptions`](/docs/api/interfaces/DefineRAGOptions)

## Returns

[`MemoryDefinition`](/docs/api/interfaces/MemoryDefinition)

## Throws

when `store` does not implement `search()`. RAG requires a
        vector-capable adapter.
