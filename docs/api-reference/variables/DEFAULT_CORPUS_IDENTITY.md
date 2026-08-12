[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CORPUS\_IDENTITY

# Variable: DEFAULT\_CORPUS\_IDENTITY

> `const` **DEFAULT\_CORPUS\_IDENTITY**: `MemoryIdentity`

Defined in: [src/lib/rag/defineRAG.ts:137](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/lib/rag/defineRAG.ts#L137)

The namespace a corpus lives in unless told otherwise — the same one
`indexDocuments` writes to by default. The two defaults are one value
on purpose: index with no options, retrieve with no options, and the
documents are found.
