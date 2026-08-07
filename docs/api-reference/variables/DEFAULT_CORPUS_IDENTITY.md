[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CORPUS\_IDENTITY

# Variable: DEFAULT\_CORPUS\_IDENTITY

> `const` **DEFAULT\_CORPUS\_IDENTITY**: `MemoryIdentity`

Defined in: [src/lib/rag/defineRAG.ts:136](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/lib/rag/defineRAG.ts#L136)

The namespace a corpus lives in unless told otherwise — the same one
`indexDocuments` writes to by default. The two defaults are one value
on purpose: index with no options, retrieve with no options, and the
documents are found.
